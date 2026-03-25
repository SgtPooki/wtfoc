import type { Segment } from "@wtfoc/common";
import { type Chunk, type CollectionHead, CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { createIgnoreFilter } from "@wtfoc/config";
import {
	buildSegment,
	buildSourceKey,
	CodeEdgeExtractor,
	CompositeEdgeExtractor,
	cursorFilePath,
	DEFAULT_MAX_CHUNK_CHARS,
	getAdapter,
	getAvailableSourceTypes,
	getCursorSince,
	HeuristicChunkScorer,
	HeuristicEdgeExtractor,
	LlmEdgeExtractor,
	mergeEdges,
	RegexEdgeExtractor,
	readCursors,
	rechunkOversized,
	segmentId,
	writeCursors,
} from "@wtfoc/ingest";
import { bundleAndUpload, generateCollectionId } from "@wtfoc/store";
import type { Command } from "commander";
import { getProjectConfig } from "../cli.js";
import { type ExtractorCliOpts, resolveExtractorConfig } from "../extractor-config.js";
import {
	createEmbedder,
	type EmbedderOpts,
	getFormat,
	getManifestDir,
	getStore,
	parseSinceDuration,
	withEmbedderOptions,
	withExtractorOptions,
} from "../helpers.js";

export function registerIngestCommand(program: Command): void {
	withExtractorOptions(
		withEmbedderOptions(
			program
				.command("ingest <sourceType> [args...]")
				.description("Ingest from a source (repo, slack, github, website)")
				.requiredOption("-c, --collection <name>", "Collection name")
				.option("--since <duration>", "Only fetch items newer than duration (e.g. 90d)")
				.option(
					"--batch-size <number>",
					"Chunks per batch (default: 500, reduces memory for large sources)",
					"500",
				)
				.option(
					"--max-chunk-chars <number>",
					`Max characters per chunk — oversized chunks are split (default: ${DEFAULT_MAX_CHUNK_CHARS})`,
				),
		),
	).action(
		async (
			sourceType: string,
			args: string[],
			opts: {
				collection: string;
				since?: string;
				batchSize: string;
				maxChunkChars?: string;
			} & EmbedderOpts &
				ExtractorCliOpts,
		) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			// Get or create manifest
			const head = await store.manifests.getHead(opts.collection);

			// Resolve extractor config early (fail fast on bad config)
			const extractorConfig = resolveExtractorConfig(opts);

			// Initialize embedder
			if (format !== "quiet") console.error("⏳ Loading embedder...");
			const { embedder, modelName } = createEmbedder(opts, getProjectConfig()?.embedder);

			// Detect model mismatch
			if (
				head &&
				head.manifest.embeddingModel !== "pending" &&
				head.manifest.embeddingModel !== modelName
			) {
				console.error(
					`⚠️  Model mismatch: collection uses "${head.manifest.embeddingModel}" but you're using "${modelName}".`,
				);
				console.error(
					"   Mixed embeddings will produce poor search results. Use --embedder to match, or re-index the collection.",
				);
				process.exit(1);
			}

			// Look up adapter from registry
			const maybeAdapter = getAdapter(sourceType);
			if (!maybeAdapter) {
				console.error(`Unknown source type: ${sourceType}`);
				console.error(`Available: ${getAvailableSourceTypes().join(", ")}`);
				process.exit(2);
			}
			const adapter = maybeAdapter;

			// Build raw config from CLI args
			const sourceArg = args[0];
			if (!sourceArg) {
				console.error(`Error: ${sourceType} source required`);
				process.exit(2);
			}

			const rawConfig: Record<string, unknown> = { source: sourceArg };

			// Cursor-based incremental ingest: read stored cursor, use as since if no explicit --since
			const sourceKey = buildSourceKey(sourceType, sourceArg);
			const manifestDir = getManifestDir(store);
			const cursorPath = cursorFilePath(manifestDir, opts.collection);
			const cursorData = await readCursors(cursorPath);

			if (opts.since) {
				rawConfig.since = parseSinceDuration(opts.since);
			} else {
				const storedSince = getCursorSince(cursorData, sourceKey);
				if (storedSince) {
					rawConfig.since = storedSince;
					if (format !== "quiet") {
						console.error(`   Resuming from cursor: ${storedSince}`);
					}
				}
			}

			if (format !== "quiet") console.error(`⏳ Ingesting ${sourceType}: ${sourceArg}...`);

			const config = adapter.parseConfig(rawConfig);
			// Apply .wtfoc.json ignore patterns to repo adapter
			const projectCfg = getProjectConfig();
			if (sourceType === "repo" && projectCfg) {
				const ignoreFilter = createIgnoreFilter(projectCfg.ignore);
				(config as Record<string, unknown>).ignoreFilter = ignoreFilter;
			}
			const maxBatch = Number.parseInt(opts.batchSize, 10) || 500;
			const maxChunkChars = opts.maxChunkChars
				? Number.parseInt(opts.maxChunkChars, 10)
				: (embedder.maxInputChars ?? DEFAULT_MAX_CHUNK_CHARS);
			const storageType = (program.opts().storage ?? "local") as string;

			// Build dedup set from existing segments for resumability
			const knownChunkIds = new Set<string>();
			if (head) {
				for (const segSummary of head.manifest.segments) {
					try {
						const segBytes = await store.storage.download(segSummary.id);
						const seg = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
						for (const c of seg.chunks) {
							knownChunkIds.add(c.id);
						}
					} catch {
						// Segment may not be downloadable (e.g. FOC-only), skip
					}
				}
				if (knownChunkIds.size > 0 && format !== "quiet") {
					console.error(`   ${knownChunkIds.size} existing chunks found (will skip duplicates)`);
				}
			}

			// Process chunks in batches to limit memory usage
			const scorer = new HeuristicChunkScorer();

			let batch: Chunk[] = [];
			let totalChunksIngested = 0;
			let totalChunksSkipped = 0;
			let batchNumber = 0;

			async function flushBatch(batchChunks: Chunk[]): Promise<void> {
				if (batchChunks.length === 0) return;
				batchNumber++;

				// Extract edges for this batch
				const compositeExtractor = new CompositeEdgeExtractor();
				compositeExtractor.register({ name: "regex", extractor: new RegexEdgeExtractor() });
				compositeExtractor.register({ name: "heuristic", extractor: new HeuristicEdgeExtractor() });
				compositeExtractor.register({ name: "code", extractor: new CodeEdgeExtractor() });

				if (extractorConfig.enabled) {
					compositeExtractor.register({
						name: "llm",
						extractor: new LlmEdgeExtractor({
							baseUrl: extractorConfig.baseUrl,
							model: extractorConfig.model,
							apiKey: extractorConfig.apiKey,
							jsonMode: extractorConfig.jsonMode,
							timeoutMs: extractorConfig.timeoutMs,
							maxConcurrency: extractorConfig.maxConcurrency,
							maxInputTokens: extractorConfig.maxInputTokens,
						}),
					});
				}

				const edges = mergeEdges([
					{ extractorName: "adapter", edges: await adapter.extractEdges(batchChunks) },
					{ extractorName: "composite", edges: await compositeExtractor.extract(batchChunks) },
				]);

				// Embed this batch
				if (format !== "quiet")
					console.error(`⏳ Embedding batch ${batchNumber} (${batchChunks.length} chunks)...`);
				const embeddings = await embedder.embedBatch(batchChunks.map((c) => c.content));

				const signalScoresBatch = scorer.scoreBatch(
					batchChunks.map((c) => ({ content: c.content, sourceType: c.sourceType })),
				);

				const segmentChunks = batchChunks.map((chunk, i) => {
					const emb = embeddings[i];
					if (!emb)
						throw new Error(
							`Missing embedding for chunk ${i} — expected ${batchChunks.length} embeddings`,
						);
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

				let resultId: string;
				let batchForManifest: import("@wtfoc/common").BatchRecord | undefined;

				if (storageType === "foc") {
					if (format !== "quiet") console.error("⏳ Bundling into CAR...");
					const bundleResult = await bundleAndUpload(
						[{ id: segId, data: segmentBytes }],
						store.storage,
					);
					resultId = bundleResult.segmentCids.get(segId) ?? segId;
					batchForManifest = bundleResult.batch;
					if (format !== "quiet")
						console.error(
							`   Segment bundled: ${resultId.slice(0, 16)}... (PieceCID: ${bundleResult.batch.pieceCid.slice(0, 16)}...)`,
						);
				} else {
					const segmentResult = await store.storage.upload(segmentBytes);
					resultId = segmentResult.id;
					if (format !== "quiet") console.error(`   Segment stored: ${resultId.slice(0, 16)}...`);
				}

				// Re-read head for each batch to avoid manifest conflicts
				const currentHead = await store.manifests.getHead(opts.collection);
				const currentPrevHeadId = currentHead ? currentHead.headId : null;

				const manifest: CollectionHead = {
					schemaVersion: CURRENT_SCHEMA_VERSION,
					collectionId: currentHead?.manifest.collectionId ?? generateCollectionId(opts.collection),
					name: opts.collection,
					currentRevisionId: currentHead?.manifest.currentRevisionId ?? null,
					prevHeadId: currentPrevHeadId,
					segments: [
						...(currentHead?.manifest.segments ?? []),
						{
							id: resultId,
							sourceTypes: [...new Set(batchChunks.map((c) => c.sourceType))],
							chunkCount: batchChunks.length,
						},
					],
					totalChunks: (currentHead?.manifest.totalChunks ?? 0) + batchChunks.length,
					embeddingModel: modelName,
					embeddingDimensions: embedder.dimensions,
					createdAt: currentHead?.manifest.createdAt ?? new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				};

				if (batchForManifest || currentHead?.manifest.batches) {
					manifest.batches = [
						...(currentHead?.manifest.batches ?? []),
						...(batchForManifest ? [batchForManifest] : []),
					];
				}

				await store.manifests.putHead(opts.collection, manifest, currentPrevHeadId);
				totalChunksIngested += batchChunks.length;
			}

			// Stream chunks from adapter, rechunk oversized ones, then dedup
			let rechunkedCount = 0;
			let maxTimestamp = "";
			for await (const rawChunk of adapter.ingest(config)) {
				// Track max timestamp from source-provided data for cursor persistence (FR-009)
				const chunkTs =
					rawChunk.timestamp ?? rawChunk.metadata.updatedAt ?? rawChunk.metadata.createdAt ?? "";
				if (chunkTs > maxTimestamp) maxTimestamp = chunkTs;
				const chunks = rechunkOversized([rawChunk], maxChunkChars);
				if (chunks.length > 1) rechunkedCount += chunks.length;

				for (const chunk of chunks) {
					if (knownChunkIds.has(chunk.id)) {
						totalChunksSkipped++;
						continue;
					}
					batch.push(chunk);
					if (batch.length >= maxBatch) {
						if (format !== "quiet")
							console.error(`   ${totalChunksIngested + batch.length} chunks so far...`);
						await flushBatch(batch);
						batch = [];
					}
				}
			}
			// Flush remaining chunks
			await flushBatch(batch);
			batch = [];

			if (totalChunksIngested === 0 && totalChunksSkipped === 0) {
				if (format !== "quiet") console.error("⚠️  No chunks produced — skipping upload");
				return;
			}

			if (format !== "quiet") {
				const parts = [`${totalChunksIngested} chunks`];
				if (batchNumber > 1) parts[0] += ` (${batchNumber} batches)`;
				if (rechunkedCount > 0) parts.push(`${rechunkedCount} from oversized splits`);
				if (totalChunksSkipped > 0) parts.push(`${totalChunksSkipped} skipped as duplicates`);
				console.error(
					`✅ Ingested ${parts.join(", ")} from ${sourceArg} into "${opts.collection}"`,
				);
			}

			// Persist cursor after successful ingest (FR-001, FR-004: only on success)
			// Use max(existing, computed) to prevent cursor regression from explicit --since or out-of-order timestamps
			if (maxTimestamp) {
				const existingCursorValue = cursorData?.cursors?.[sourceKey]?.cursorValue;
				const nextCursorValue =
					existingCursorValue && existingCursorValue > maxTimestamp
						? existingCursorValue
						: maxTimestamp;
				const updatedCursors = cursorData ?? { schemaVersion: 1 as const, cursors: {} };
				updatedCursors.cursors[sourceKey] = {
					sourceKey,
					adapterType: sourceType,
					cursorValue: nextCursorValue,
					lastRunAt: new Date().toISOString(),
					chunksIngested: totalChunksIngested,
				};
				await writeCursors(cursorPath, updatedCursors);
				if (format !== "quiet") {
					console.error(`   Saved cursor for next run: ${nextCursorValue}`);
				}
			}

			// synapse-sdk keeps HTTP connections alive with no cleanup method
			if (storageType === "foc") process.exit(0);
		},
	);
}
