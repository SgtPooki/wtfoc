import type { Chunk, Segment } from "@wtfoc/common";
import {
	computeContextHash,
	type ExtractionStatusData,
	getContextsToProcess,
	LlmEdgeExtractor,
	mergeOverlayEdges,
	overlayFilePath,
	readExtractionStatus,
	readOverlayEdges,
	statusFilePath,
	writeExtractionStatus,
	writeOverlayEdges,
} from "@wtfoc/ingest";
import type { Command } from "commander";
import { type ExtractorCliOpts, resolveExtractorConfig } from "../extractor-config.js";
import { getFormat, getManifestDir, getStore, withExtractorOptions } from "../helpers.js";

/**
 * Map a segment chunk to the Chunk interface for extractors.
 * Segment chunks have extra fields (embedding, terms, storageId) that extractors don't need.
 */
function segmentChunkToChunk(chunk: Segment["chunks"][number]): Chunk {
	return {
		id: chunk.id,
		content: chunk.content,
		sourceType: chunk.sourceType,
		source: chunk.source,
		sourceUrl: chunk.sourceUrl,
		timestamp: chunk.timestamp,
		chunkIndex: "chunkIndex" in chunk ? (chunk as { chunkIndex: number }).chunkIndex : 0,
		totalChunks: "totalChunks" in chunk ? (chunk as { totalChunks: number }).totalChunks : 1,
		metadata: chunk.metadata,
	};
}

/**
 * Load segments from storage without building a vector index.
 * Avoids the memory overhead of storing all embeddings in InMemoryVectorIndex.
 */
async function loadSegments(
	manifest: { segments: Array<{ id: string }> },
	storage: { download: (id: string, signal?: AbortSignal) => Promise<Uint8Array> },
	signal?: AbortSignal,
): Promise<Segment[]> {
	const segments: Segment[] = [];
	for (const segRef of manifest.segments) {
		signal?.throwIfAborted();
		const data = await storage.download(segRef.id, signal);
		const text = new TextDecoder().decode(data);
		segments.push(JSON.parse(text) as Segment);
	}
	return segments;
}

/**
 * Prune stale overlay edges and status entries.
 * Returns true if anything was pruned.
 */
async function pruneStaleData(
	overlayEdges: import("@wtfoc/common").Edge[],
	statusData: ExtractionStatusData,
	allChunks: Chunk[],
	contexts: Array<{ contextId: string }>,
	overlayPath: string,
	statusPath: string,
	collectionId: string,
	existingOverlayCreatedAt: string | undefined,
	format: string,
): Promise<import("@wtfoc/common").Edge[]> {
	const validChunkIds = new Set(allChunks.map((c) => c.id));
	const prunedEdges = overlayEdges.filter((e) => validChunkIds.has(e.sourceId));
	const edgesPruned = overlayEdges.length - prunedEdges.length;

	const validContextIds = new Set(contexts.map((c) => c.contextId));
	let contextsPruned = 0;
	for (const key of Object.keys(statusData.contexts)) {
		if (!validContextIds.has(key)) {
			delete statusData.contexts[key];
			contextsPruned++;
		}
	}

	if (edgesPruned > 0 || contextsPruned > 0) {
		await writeOverlayEdges(overlayPath, {
			collectionId,
			edges: prunedEdges,
			createdAt: existingOverlayCreatedAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});
		await writeExtractionStatus(statusPath, statusData);
		if (format !== "quiet") {
			if (edgesPruned > 0) console.error(`🧹 Pruned ${edgesPruned} stale overlay edges`);
			if (contextsPruned > 0) console.error(`🧹 Pruned ${contextsPruned} stale status entries`);
		}
	}

	return prunedEdges;
}

export function registerExtractEdgesCommand(program: Command): void {
	withExtractorOptions(
		program
			.command("extract-edges")
			.description("Run LLM edge extraction on an existing collection (incremental)")
			.requiredOption("-c, --collection <name>", "Collection name")
			.option(
				"--context-concurrency <n>",
				"Number of contexts to process in parallel (default: 4)",
				"4",
			),
	).action(async (opts: { collection: string; contextConcurrency: string } & ExtractorCliOpts) => {
		const store = getStore(program);
		const format = getFormat(program.opts());

		// Set up abort handling early so even loading can be cancelled
		const abortController = new AbortController();
		const { signal } = abortController;
		process.on("SIGINT", () => abortController.abort(new Error("Interrupted")));
		process.on("SIGTERM", () => abortController.abort(new Error("Terminated")));

		// Resolve extractor config (fail fast)
		const config = resolveExtractorConfig({ ...opts, extractorEnabled: true });
		if (!config.enabled) {
			// Unreachable with extractorEnabled: true, but satisfies type narrowing
			process.exit(2);
		}

		// Load collection
		const headResult = await store.manifests.getHead(opts.collection);
		if (!headResult) {
			console.error(`Collection "${opts.collection}" not found.`);
			process.exit(1);
		}
		const head = headResult;

		if (format !== "quiet") {
			console.error(`⏳ Loading collection "${opts.collection}"...`);
		}

		// Load segments directly — no vector index needed, saves memory
		const segments = await loadSegments(head.manifest, store.storage, signal);

		// Map to Chunk interface
		const allChunks: Chunk[] = segments.flatMap((seg) => seg.chunks.map(segmentChunkToChunk));

		if (format !== "quiet") {
			console.error(`📦 ${allChunks.length} chunks in ${segments.length} segments`);
		}

		// Build extraction contexts grouped by source
		const contextMap = new Map<string, Chunk[]>();
		for (const chunk of allChunks) {
			signal.throwIfAborted();
			const key = chunk.source || chunk.id;
			const group = contextMap.get(key);
			if (group) {
				group.push(chunk);
			} else {
				contextMap.set(key, [chunk]);
			}
		}

		const contexts: Array<{
			contextId: string;
			contextHash: string;
			chunkIds: string[];
			chunks: Chunk[];
		}> = [];
		for (const [contextId, chunks] of contextMap) {
			signal.throwIfAborted();
			const contextHash = await computeContextHash(chunks);
			contexts.push({
				contextId,
				contextHash,
				chunkIds: chunks.map((c) => c.id),
				chunks,
			});
		}

		// Build O(1) lookup for context chunks
		const chunksByContextId = new Map<string, Chunk[]>();
		for (const ctx of contexts) {
			chunksByContextId.set(ctx.contextId, ctx.chunks);
		}

		// Derive paths from store's manifest directory
		const manifestDir = getManifestDir(store);
		const statusPath = statusFilePath(manifestDir, opts.collection);
		const overlayPath = overlayFilePath(manifestDir, opts.collection);

		const existingStatus = await readExtractionStatus(statusPath);
		const existingOverlay = await readOverlayEdges(overlayPath);
		const existingOverlayCreatedAt = existingOverlay?.createdAt;

		// Always prune stale data, even if nothing new to extract
		const statusData: ExtractionStatusData = existingStatus
			? {
					...existingStatus,
					extractorModel: config.model,
					contexts: { ...existingStatus.contexts },
				}
			: { extractorModel: config.model, contexts: {} };

		let overlayEdges = await pruneStaleData(
			existingOverlay?.edges ?? [],
			statusData,
			allChunks,
			contexts,
			overlayPath,
			statusPath,
			head.manifest.collectionId,
			existingOverlayCreatedAt,
			format,
		);

		const toProcess = getContextsToProcess(existingStatus, contexts, config.model);

		if (toProcess.length === 0) {
			if (format !== "quiet") {
				console.error("✅ All contexts already processed. Nothing to do.");
			}
			return;
		}

		if (format !== "quiet") {
			console.error(
				`🔍 ${toProcess.length}/${contexts.length} contexts to process (${toProcess.reduce((sum, c) => sum + c.chunkIds.length, 0)} chunks)`,
			);
		}

		const extractor = new LlmEdgeExtractor({
			baseUrl: config.baseUrl,
			model: config.model,
			apiKey: config.apiKey,
			jsonMode: config.jsonMode,
			timeoutMs: config.timeoutMs,
			maxConcurrency: config.maxConcurrency,
			maxInputTokens: config.maxInputTokens,
		});

		let totalNewEdges = 0;
		let processed = 0;
		const contextConcurrency = Math.max(1, Number.parseInt(opts.contextConcurrency, 10) || 4);

		if (format !== "quiet" && contextConcurrency > 1) {
			console.error(`   Context concurrency: ${contextConcurrency}`);
		}

		// Mutex for shared state writes (overlayEdges, statusData, disk writes)
		let writeLock: Promise<void> = Promise.resolve();
		async function withWriteLock(fn: () => Promise<void>): Promise<void> {
			const prev = writeLock;
			let resolve: (() => void) | undefined;
			writeLock = new Promise<void>((r) => {
				resolve = r;
			});
			await prev;
			try {
				await fn();
			} finally {
				resolve?.();
			}
		}

		async function processContext(ctx: (typeof toProcess)[number]): Promise<void> {
			if (signal.aborted) return;

			const chunksForContext = chunksByContextId.get(ctx.contextId);
			if (!chunksForContext || chunksForContext.length === 0) return;

			const idx = ++processed;
			if (format !== "quiet") {
				console.error(
					`  [${idx}/${toProcess.length}] Extracting: ${ctx.contextId} (${chunksForContext.length} chunks)...`,
				);
			}

			try {
				const edges = await extractor.extract(chunksForContext, signal);

				await withWriteLock(async () => {
					overlayEdges = mergeOverlayEdges(overlayEdges, edges);
					totalNewEdges += edges.length;

					statusData.contexts[ctx.contextId] = {
						contextId: ctx.contextId,
						contextHash: ctx.contextHash,
						chunkIds: ctx.chunkIds,
						status: "completed",
						edgeCount: edges.length,
						timestamp: new Date().toISOString(),
					};

					await writeExtractionStatus(statusPath, statusData);
					await writeOverlayEdges(overlayPath, {
						collectionId: head.manifest.collectionId,
						edges: overlayEdges,
						createdAt: existingOverlayCreatedAt ?? new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					});
				});
			} catch (err) {
				if (signal.aborted) return;

				await withWriteLock(async () => {
					statusData.contexts[ctx.contextId] = {
						contextId: ctx.contextId,
						contextHash: ctx.contextHash,
						chunkIds: ctx.chunkIds,
						status: "failed",
						error: err instanceof Error ? err.message : String(err),
						timestamp: new Date().toISOString(),
					};

					await writeExtractionStatus(statusPath, statusData);
				});
			}
		}

		// Process contexts with bounded concurrency
		const active: Promise<void>[] = [];
		for (const ctx of toProcess) {
			if (signal.aborted) break;

			const p = processContext(ctx).then(() => {
				active.splice(active.indexOf(p), 1);
			});
			active.push(p);

			if (active.length >= contextConcurrency) {
				await Promise.race(active);
			}
		}
		// Wait for remaining
		await Promise.all(active);

		if (signal.aborted && format !== "quiet") {
			console.error(`\n⚠️  Cancelled. ${processed} contexts processed before abort.`);
		}

		// Summary
		const failed = Object.values(statusData.contexts).filter((c) => c.status === "failed").length;
		const completed = Object.values(statusData.contexts).filter(
			(c) => c.status === "completed",
		).length;

		if (format !== "quiet") {
			console.error(`\n✅ Done. ${totalNewEdges} new edges extracted.`);
			console.error(
				`   Contexts: ${completed} completed, ${failed} failed, ${contexts.length} total`,
			);
			console.error(`   Overlay: ${overlayEdges.length} total edges in ${overlayPath}`);
		}

		if (format === "json") {
			console.log(
				JSON.stringify({
					collection: opts.collection,
					newEdges: totalNewEdges,
					totalOverlayEdges: overlayEdges.length,
					contextsProcessed: processed,
					contextsFailed: failed,
					contextsTotal: contexts.length,
				}),
			);
		}

		// Exit with non-zero if cancelled
		if (signal.aborted) process.exit(130);
	});
}
