/**
 * Async ingestion worker (#168, extended by #288 Phase 2 Slice C).
 *
 * `ingest` is now the first stage of a two-step pipeline:
 *  1. `ingest`: fetch sources → chunk → embed → extract edges → build
 *     segment → upload segment blob. Produces an immutable segment artifact
 *     but does NOT touch the manifest head.
 *  2. `materialize` (child job): append the segment to the manifest head
 *     with CAS, flip the collection row to `ready`. See
 *     `materialize-worker.ts`.
 *
 * The split keeps the ingest stage long-running-but-restartable — if
 * materialize fails we can retry it without re-fetching sources. Parent
 * retries of ingest dedupe the child via an idempotency key keyed on the
 * collection + segment id.
 */
import type { Chunk } from "@wtfoc/common";
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
			phase: "embedding + building segment",
			current: sources.length,
			total: sources.length,
			message: `${allChunks.length} chunks`,
		});

		// Build segment artifact, upload to content-addressed storage. Does NOT
		// write the manifest head — that's materialize's job.
		const artifact = await buildSegmentArtifact(allChunks, signal);

		// Enqueue the materialize child to append this segment to the head.
		// Idempotency key is derived from the segment id so a parent retry
		// that re-produces the same content won't fan out duplicate children.
		await ctx.reportProgress({
			phase: "enqueueing materialize",
			current: sources.length,
			total: sources.length,
		});
		await ctx.enqueueChild(
			"materialize",
			{
				collectionId,
				collectionName,
				segmentId: artifact.segmentId,
				chunkCount: artifact.chunkCount,
				sourceCount: sources.length,
				sourceTypes: artifact.sourceTypes,
				embeddingModel: artifact.embeddingModel,
				embeddingDimensions: artifact.embeddingDimensions,
			},
			{
				idempotencyKey: `collection:${collectionId}:materialize:${artifact.segmentId}`,
			},
		);
		// The collection stays in `ingesting` until materialize lands — avoids
		// a window where the UI claims ready before the head is written.
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

interface SegmentArtifact {
	segmentId: string;
	chunkCount: number;
	sourceTypes: string[];
	embeddingModel: string;
	embeddingDimensions: number;
}

/**
 * Build a segment from chunks and upload it to content-addressed storage.
 * Returns the artifact descriptor that the `materialize` child needs to
 * append it to the manifest head. Does NOT touch the manifest.
 */
async function buildSegmentArtifact(
	chunks: Chunk[],
	signal?: AbortSignal,
): Promise<SegmentArtifact> {
	const { buildSegment, segmentId, mergeEdges, CompositeEdgeExtractor, CodeEdgeExtractor, HeuristicEdgeExtractor, HeuristicChunkScorer } =
		await import("@wtfoc/ingest");
	const { createStore } = await import("@wtfoc/store");

	const store = createStore({ storage: "local" });

	// Embedder
	const { getDefaultEmbedder } = await import("./embedder-helper.js");
	const { embedder, modelName } = await getDefaultEmbedder();

	// Extract edges
	const compositeExtractor = new CompositeEdgeExtractor();
	compositeExtractor.register({ name: "code", extractor: new CodeEdgeExtractor() });
	compositeExtractor.register({ name: "heuristic", extractor: new HeuristicEdgeExtractor() });
	const edges = mergeEdges([
		{ extractorName: "composite", edges: await compositeExtractor.extract(chunks) },
	]);

	// Embed
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
	const expectedId = segmentId(segment);

	const uploaded = await store.storage.upload(segmentBytes);
	if (uploaded.id !== expectedId) {
		throw new Error(
			`segment id mismatch: computed ${expectedId}, stored as ${uploaded.id}`,
		);
	}

	console.error(
		`[ingest-worker] segment artifact ${uploaded.id.slice(0, 16)}… (${chunks.length} chunks)`,
	);

	return {
		segmentId: uploaded.id,
		chunkCount: chunks.length,
		sourceTypes: [...new Set(chunks.map((c) => c.sourceType))],
		embeddingModel: modelName,
		embeddingDimensions: embedder.dimensions,
	};
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
