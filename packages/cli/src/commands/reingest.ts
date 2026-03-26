import type { Segment } from "@wtfoc/common";
import { type Chunk, type CollectionHead, CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { createIgnoreFilter } from "@wtfoc/config";
import {
	buildSegment,
	CodeEdgeExtractor,
	CompositeEdgeExtractor,
	DEFAULT_MAX_CHUNK_CHARS,
	extractSegmentMetadata,
	HeuristicChunkScorer,
	HeuristicEdgeExtractor,
	mergeEdges,
	RegexEdgeExtractor,
	rechunkOversized,
} from "@wtfoc/ingest";
import { generateCollectionId } from "@wtfoc/store";
import type { Command } from "commander";
import { getProjectConfig } from "../cli.js";
import {
	createEmbedder,
	type EmbedderOpts,
	getFormat,
	getStore,
	withEmbedderOptions,
} from "../helpers.js";

/**
 * Reingest: rebuild a collection from its stored segments.
 *
 * Reads all chunks from existing segments, applies current ignore patterns,
 * optionally rechunks, re-extracts edges, re-embeds, and writes new segments.
 * Operates on already-stored segments — no source re-fetch from GitHub/web/etc.
 * Note: embedding may still make network calls if using an API-based embedder.
 */
export function registerReingestCommand(program: Command): void {
	withEmbedderOptions(
		program
			.command("reingest")
			.description(
				"Rebuild a collection from stored segments with current ignore patterns (no source re-fetch)",
			)
			.requiredOption("-c, --collection <name>", "Source collection to read from")
			.option("--target <name>", "Target collection name (default: overwrite source)")
			.option("--batch-size <number>", "Chunks per batch", "500")
			.option("--rechunk", "Re-chunk content with current chunk size limits")
			.option(
				"--max-chunk-chars <number>",
				`Max chars per chunk when rechunking (default: ${DEFAULT_MAX_CHUNK_CHARS})`,
			)
			.option("--ignore <pattern...>", "Additional gitignore-style patterns to exclude"),
	).action(
		async (
			opts: {
				collection: string;
				target?: string;
				batchSize: string;
				rechunk?: boolean;
				maxChunkChars?: string;
				ignore?: string[];
			} & EmbedderOpts,
		) => {
			const store = getStore(program);
			const format = getFormat(program.opts());
			const { embedder, modelName } = createEmbedder(opts, getProjectConfig()?.embedder);
			const targetName = opts.target ?? opts.collection;
			const batchSize = Number.parseInt(opts.batchSize, 10) || 500;

			// Load source collection
			const head = await store.manifests.getHead(opts.collection);
			if (!head) {
				console.error(`Error: collection "${opts.collection}" not found`);
				process.exit(1);
			}

			// Build ignore filter from project config + CLI flags
			const projectCfg = getProjectConfig();
			const ignoreFilter = createIgnoreFilter(projectCfg?.ignore, opts.ignore);

			// Probe embedder dimensions
			if (format !== "quiet") console.error("⏳ Detecting embedding dimensions...");
			await embedder.embed("dimension probe");

			if (format !== "quiet") {
				console.error(
					`🔄 Reingesting "${opts.collection}"${targetName !== opts.collection ? ` → "${targetName}"` : ""}`,
				);
				console.error(
					`   ${head.manifest.segments.length} segments, ${head.manifest.totalChunks} chunks`,
				);
				console.error(`   Model: ${modelName} (${embedder.dimensions}d)`);
			}

			// Phase 1: Read all chunks from existing segments, apply ignore filter
			const allChunks: Chunk[] = [];
			let filteredCount = 0;

			for (const segSummary of head.manifest.segments) {
				const segBytes = await store.storage.download(segSummary.id);
				const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;

				for (const c of segment.chunks) {
					// Apply ignore filter to chunks that have file paths
					const filePath = c.metadata.filePath;
					if (filePath && !ignoreFilter(filePath)) {
						filteredCount++;
						continue;
					}

					allChunks.push({
						id: c.id,
						content: c.content,
						sourceType: c.sourceType,
						source: c.source,
						sourceUrl: c.sourceUrl,
						timestamp: c.timestamp,
						chunkIndex: 0,
						totalChunks: 0,
						metadata: c.metadata,
					});
				}
			}

			if (format !== "quiet") {
				console.error(
					`   Loaded ${allChunks.length} chunks (${filteredCount} filtered by ignore patterns)`,
				);
			}

			if (allChunks.length === 0) {
				console.error("⚠️  No chunks remain after filtering. Nothing to write.");
				return;
			}

			// Phase 2: Optional rechunk
			let chunksToProcess = allChunks;
			if (opts.rechunk) {
				const maxChars = opts.maxChunkChars
					? Number.parseInt(opts.maxChunkChars, 10)
					: (embedder.maxInputChars ?? DEFAULT_MAX_CHUNK_CHARS);

				const withinLimit = chunksToProcess.filter((c) => c.content.length <= maxChars);
				const oversized = chunksToProcess.filter((c) => c.content.length > maxChars);
				const rechunked = rechunkOversized(oversized, maxChars);
				chunksToProcess = [...withinLimit, ...rechunked];

				if (format !== "quiet" && oversized.length > 0) {
					console.error(
						`   Rechunked ${oversized.length} oversized → ${rechunked.length} new chunks`,
					);
				}
			}

			// Phase 3: Process in batches — extract edges, embed, store
			const scorer = new HeuristicChunkScorer();
			let totalProcessed = 0;

			// Clear target if overwriting
			if (targetName === opts.collection) {
				// We'll write fresh segments, overwriting the manifest
			}

			for (let i = 0; i < chunksToProcess.length; i += batchSize) {
				const batchChunks = chunksToProcess.slice(i, i + batchSize);
				const batchNum = Math.floor(i / batchSize) + 1;
				const totalBatches = Math.ceil(chunksToProcess.length / batchSize);

				// Extract edges
				const compositeExtractor = new CompositeEdgeExtractor();
				compositeExtractor.register({ name: "regex", extractor: new RegexEdgeExtractor() });
				compositeExtractor.register({
					name: "heuristic",
					extractor: new HeuristicEdgeExtractor(),
				});
				compositeExtractor.register({ name: "code", extractor: new CodeEdgeExtractor() });

				const edges = mergeEdges([
					{ extractorName: "composite", edges: await compositeExtractor.extract(batchChunks) },
				]);

				// Embed
				if (format !== "quiet") {
					console.error(
						`⏳ Batch ${batchNum}/${totalBatches}: embedding ${batchChunks.length} chunks...`,
					);
				}
				const embeddings = await embedder.embedBatch(batchChunks.map((c) => c.content));

				const signalScoresBatch = scorer.scoreBatch(
					batchChunks.map((c) => ({ content: c.content, sourceType: c.sourceType })),
				);

				const segmentChunks = batchChunks.map((chunk, j) => {
					const emb = embeddings[j];
					if (!emb) {
						throw new Error(`Missing embedding for chunk ${j}`);
					}
					return {
						chunk,
						embedding: Array.from(emb),
						signalScores: signalScoresBatch[j],
					};
				});

				const segment = buildSegment(segmentChunks, edges, {
					embeddingModel: modelName,
					embeddingDimensions: embedder.dimensions,
				});

				const segmentBytes = new TextEncoder().encode(JSON.stringify(segment));
				const result = await store.storage.upload(segmentBytes);

				// Update manifest after each batch
				const currentHead = await store.manifests.getHead(targetName);
				const prevHeadId = currentHead ? currentHead.headId : null;

				totalProcessed += batchChunks.length;

				const manifest: CollectionHead = {
					schemaVersion: CURRENT_SCHEMA_VERSION,
					collectionId: currentHead?.manifest.collectionId ?? generateCollectionId(targetName),
					name: targetName,
					currentRevisionId: currentHead?.manifest.currentRevisionId ?? null,
					prevHeadId,
					segments: [
						// On first batch, start fresh (don't carry old segments)
						...(batchNum === 1 ? [] : (currentHead?.manifest.segments ?? [])),
						{
							id: result.id,
							sourceTypes: [...new Set(batchChunks.map((c) => c.sourceType))],
							chunkCount: batchChunks.length,
							...extractSegmentMetadata(batchChunks),
						},
					],
					totalChunks: totalProcessed,
					embeddingModel: modelName,
					embeddingDimensions: embedder.dimensions,
					createdAt: currentHead?.manifest.createdAt ?? head.manifest.createdAt,
					updatedAt: new Date().toISOString(),
				};

				await store.manifests.putHead(targetName, manifest, prevHeadId);

				if (format !== "quiet") {
					console.error(`   Segment stored: ${result.id.slice(0, 16)}...`);
				}
			}

			if (format === "json") {
				console.log(
					JSON.stringify({
						source: opts.collection,
						target: targetName,
						model: modelName,
						chunksProcessed: totalProcessed,
						chunksFiltered: filteredCount,
					}),
				);
			} else if (format !== "quiet") {
				console.error(
					`\n✅ Reingested "${opts.collection}"${targetName !== opts.collection ? ` → "${targetName}"` : ""}`,
				);
				console.error(`   ${totalProcessed} chunks processed, ${filteredCount} filtered out`);
				console.error(`   Embedded with ${modelName} (${embedder.dimensions}d)`);
				if (filteredCount > 0) {
					console.error("   Run extract-edges to add LLM-based semantic edges");
				}
			}
		},
	);
}
