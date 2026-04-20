/**
 * Async ingestion worker (#168): processes sources for a collection in the
 * background. The exported `runIngestJob` is the JobQueue handler; previous
 * in-memory slot-semaphore retired in favor of pg-boss concurrency + the
 * per-collection invariant enforced at the DB.
 *
 * Progress is reported through the `JobContext` so the /api/jobs endpoints
 * can surface phase/current/total to callers polling from the web UI.
 */
import type { Chunk, CollectionHead } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import type { Repository, Source } from "../db/index.js";
import type { JobQueue } from "../jobs/queue.js";
import type { IngestPayload, JobContext } from "../jobs/types.js";

export interface IngestJobParams {
	collectionId: string;
	collectionName: string;
	sources: Source[];
	repo: Repository;
	ctx: JobContext;
}

/**
 * Wire the `ingest` job handler into the queue. Call once at server startup
 * before `queue.start()`. The handler re-reads the collection + sources
 * from the repo at run time so retries / restarts pick up the latest
 * source list (covers the case where new sources were added between
 * enqueue and the worker picking up the job).
 */
export function registerIngestHandler(queue: JobQueue, repo: Repository): void {
	queue.register<IngestPayload>("ingest", async (payload, ctx) => {
		const target = await repo.getCollection(payload.collectionId);
		if (!target) {
			throw new Error(`collection not found: ${payload.collectionId}`);
		}
		const pending = target.sources.filter(
			(s) => s.status === "pending" || s.status === "failed",
		);
		const sourcesToRun = pending.length > 0 ? pending : target.sources;
		await runIngestJob({
			collectionId: target.id,
			collectionName: target.name,
			sources: sourcesToRun,
			repo,
			ctx,
		});
	});
}

/**
 * Handler body for the `ingest` job type. Called by the JobQueue worker;
 * should not be invoked directly from route handlers — routes enqueue
 * instead so cancellation + durability + progress all live on one path.
 */
export async function runIngestJob({
	collectionId,
	collectionName,
	sources,
	repo,
	ctx,
}: IngestJobParams): Promise<void> {
	const signal = ctx.signal;
	try {
		await ctx.reportProgress({
			phase: "fetching sources",
			current: 0,
			total: sources.length,
		});
		await repo.updateCollectionStatus(collectionId, "ingesting");

		const allChunks: Chunk[] = [];
		let anySucceeded = false;

		for (let i = 0; i < sources.length; i++) {
			signal.throwIfAborted();
			const source = sources[i];
			if (!source) continue;
			await ctx.reportProgress({
				phase: `fetching ${source.sourceType}`,
				current: i,
				total: sources.length,
				message: source.identifier,
			});

			try {
				await repo.updateSourceStatus(source.id, "ingesting");
				const chunks = await ingestSource(source, signal);
				await repo.updateSourceStatus(source.id, "complete", { chunkCount: chunks.length });
				allChunks.push(...chunks);
				anySucceeded = true;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				await repo.updateSourceStatus(source.id, "failed", { errorMessage: message });
			}
		}

		if (!anySucceeded) {
			await repo.updateCollectionStatus(collectionId, "ingestion_failed");
			return;
		}

		await ctx.reportProgress({
			phase: "embedding + persisting",
			current: sources.length,
			total: sources.length,
			message: `${allChunks.length} chunks`,
		});

		// Build segments and persist manifest using the existing pipeline
		await buildAndPersist(collectionName, allChunks, repo, collectionId, signal);
		await repo.updateCollectionStatus(collectionId, "ready");
	} catch (err) {
		// Honor cooperative cancel: don't mark ingestion_failed when the user
		// asked us to stop.
		if (signal.aborted) {
			throw err;
		}
		console.error(`[ingest-worker] Collection ${collectionId} failed:`, err);
		try {
			await repo.updateCollectionStatus(collectionId, "ingestion_failed");
		} catch {
			// Best effort
		}
		throw err;
	}
}

async function buildAndPersist(
	collectionName: string,
	chunks: Chunk[],
	repo: Repository,
	collectionId: string,
	signal?: AbortSignal,
): Promise<void> {
	const { buildSegment, segmentId, mergeEdges, CompositeEdgeExtractor, CodeEdgeExtractor, HeuristicEdgeExtractor, HeuristicChunkScorer } =
		await import("@wtfoc/ingest");
	const { createStore, generateCollectionId } = await import("@wtfoc/store");

	const store = createStore({ storage: "local" });

	// Get embedder
	const { getDefaultEmbedder } = await import("./embedder-helper.js");
	const { embedder, modelName } = await getDefaultEmbedder();

	// Extract edges
	const compositeExtractor = new CompositeEdgeExtractor();
	compositeExtractor.register({ name: "code", extractor: new CodeEdgeExtractor() });
	compositeExtractor.register({ name: "heuristic", extractor: new HeuristicEdgeExtractor() });
	const edges = mergeEdges([
		{ extractorName: "composite", edges: await compositeExtractor.extract(chunks) },
	]);

	// Embed all chunks
	signal?.throwIfAborted();
	const embeddings = await embedder.embedBatch(chunks.map((c) => c.content));
	const scorer = new HeuristicChunkScorer();
	const signalScoresBatch = scorer.scoreBatch(
		chunks.map((c) => ({ content: c.content, sourceType: c.sourceType })),
	);

	const segmentChunks = chunks.map((chunk, i) => {
		const emb = embeddings[i];
		if (!emb) throw new Error(`Missing embedding for chunk ${i}`);
		return {
			chunk,
			embedding: Array.from(emb),
			signalScores: signalScoresBatch[i],
		};
	});

	const segment = buildSegment(segmentChunks, edges, {
		embeddingModel: modelName,
		embeddingDimensions: embedder.dimensions,
	});

	const segmentBytes = new TextEncoder().encode(JSON.stringify(segment));
	const segId = segmentId(segment);

	// Upload segment to local storage
	const segmentResult = await store.storage.upload(segmentBytes);
	const resultId = segmentResult.id;

	// Build and persist manifest
	const currentHead = await store.manifests.getHead(collectionName).catch(() => null);
	const currentPrevHeadId = currentHead ? currentHead.headId : null;

	const manifest: CollectionHead = {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		collectionId: currentHead?.manifest.collectionId ?? generateCollectionId(collectionName),
		name: collectionName,
		currentRevisionId: currentHead?.manifest.currentRevisionId ?? null,
		prevHeadId: currentPrevHeadId,
		segments: [
			...(currentHead?.manifest.segments ?? []),
			{
				id: resultId,
				sourceTypes: [...new Set(chunks.map((c) => c.sourceType))],
				chunkCount: chunks.length,
			},
		],
		totalChunks: (currentHead?.manifest.totalChunks ?? 0) + chunks.length,
		embeddingModel: modelName,
		embeddingDimensions: embedder.dimensions,
		createdAt: currentHead?.manifest.createdAt ?? new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	await store.manifests.putHead(collectionName, manifest, currentPrevHeadId);

	// Update collection metadata
	await repo.updateCollectionPromotion(collectionId, {
		segmentCount: manifest.segments.length,
	});

	console.error(`[ingest-worker] Collection "${collectionName}" persisted: ${chunks.length} chunks, ${manifest.segments.length} segment(s)`);
}

async function ingestSource(source: Source, signal?: AbortSignal): Promise<Chunk[]> {
	const chunks: Chunk[] = [];

	switch (source.sourceType) {
		case "github": {
			const { GitHubAdapter, resolveGitHubExecFn } = await import("@wtfoc/ingest");
			const execFn = resolveGitHubExecFn();
			const adapter = new GitHubAdapter(execFn);
			const [owner, repo] = source.identifier.split("/");
			if (!owner || !repo) throw new Error(`Invalid GitHub identifier: ${source.identifier}`);

			for await (const chunk of adapter.ingest({ owner, repo }, signal)) {
				chunks.push(chunk);
			}
			break;
		}

		case "website": {
			const { validateUrl } = await import("../security/ssrf.js");
			const ssrfCheck = await validateUrl(source.identifier);
			if (!ssrfCheck.safe) {
				throw new Error(`URL blocked by SSRF check: ${ssrfCheck.reason}`);
			}

			const { getAdapter } = await import("@wtfoc/ingest");
			const adapter = getAdapter("website");
			if (!adapter) throw new Error("Website adapter not available");

			for await (const chunk of adapter.ingest({ source: source.identifier, maxPages: 50 }, signal)) {
				chunks.push(chunk);
			}
			break;
		}

		case "hackernews": {
			const { getAdapter } = await import("@wtfoc/ingest");
			const adapter = getAdapter("hackernews");
			if (!adapter) throw new Error("HackerNews adapter not available");

			for await (const chunk of adapter.ingest({ threadId: source.identifier }, signal)) {
				chunks.push(chunk);
			}
			break;
		}

		default:
			throw new Error(`Unsupported source type: ${source.sourceType}`);
	}

	return chunks;
}
