import type { ChunkerDocument, Segment } from "@wtfoc/common";
import { type Chunk, type CollectionHead, CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { createIgnoreFilter } from "@wtfoc/config";
import {
	archiveIndexPath,
	buildSegment,
	CodeEdgeExtractor,
	CompositeEdgeExtractor,
	DEFAULT_MAX_CHUNK_CHARS,
	extractSegmentMetadata,
	HeuristicChunkScorer,
	HeuristicEdgeExtractor,
	mergeEdges,
	RegexEdgeExtractor,
	readArchiveIndex,
	rechunkOversized,
	replayRawDocuments,
	selectChunker,
	storedChunkToSegmentChunk,
	TreeSitterEdgeExtractor,
	writeArchiveIndex,
} from "@wtfoc/ingest";
import { generateCollectionId } from "@wtfoc/store";
import type { Command } from "commander";
import { getProjectConfig } from "../cli.js";
import {
	createEmbedder,
	type EmbedderOpts,
	getFormat,
	getManifestDir,
	getStore,
	registerAstChunkerIfAvailable,
	resolveTreeSitterUrl,
	withEmbedderOptions,
	withTreeSitterOptions,
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
	withTreeSitterOptions(
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
				.option(
					"--replay-raw",
					"Replay archived raw source through current chunkers (applies new chunker logic like GithubIssueChunker identity headers and AstHeuristicChunker structural overlap). Falls back to scanning source segments to backfill missing adapter metadata (labels/author/state).",
				)
				.option(
					"--skip-missing-raw",
					"When --replay-raw: warn and skip docs that lack a raw archive entry instead of erroring",
				)
				.option("--ignore <pattern...>", "Additional gitignore-style patterns to exclude"),
		),
	).action(
		async (
			opts: {
				collection: string;
				target?: string;
				batchSize: string;
				rechunk?: boolean;
				replayRaw?: boolean;
				skipMissingRaw?: boolean;
				maxChunkChars?: string;
				ignore?: string[];
				treeSitterUrl?: string;
			} & EmbedderOpts,
		) => {
			const store = getStore(program);
			const format = getFormat(program.opts());
			const { embedder, modelName } = createEmbedder(opts, getProjectConfig()?.embedder);
			const targetName = opts.target ?? opts.collection;
			const batchSize = Number.parseInt(opts.batchSize, 10) || 500;

			// #220 Session 2 — install AST chunker when a sidecar is configured.
			// selectChunker() will then pick "ast" over "ast-heuristic" for
			// supported code files during --replay-raw or initial chunking.
			const astChunkerInstalled = registerAstChunkerIfAvailable(opts);

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
			if (format === "human") console.error("⏳ Detecting embedding dimensions...");
			await embedder.embed("dimension probe");

			if (format === "human") {
				console.error(
					`🔄 Reingesting "${opts.collection}"${targetName !== opts.collection ? ` → "${targetName}"` : ""}`,
				);
				console.error(
					`   ${head.manifest.segments.length} segments, ${head.manifest.totalChunks} chunks`,
				);
				console.error(`   Model: ${modelName} (${embedder.dimensions}d)`);
				if (astChunkerInstalled) {
					console.error(`   Chunker: ast (tree-sitter sidecar enabled)`);
				}
			}

			// Phase 1: Build chunk stream. Two modes:
			//   Default: read already-chunked segments from storage.
			//   --replay-raw: replay archived raw source through current chunkers
			//     (applies new chunker logic like GithubIssueChunker identity headers).
			const allChunks: Chunk[] = [];
			let filteredCount = 0;
			const maxCharsForChunking = opts.maxChunkChars
				? Number.parseInt(opts.maxChunkChars, 10)
				: (embedder.maxInputChars ?? DEFAULT_MAX_CHUNK_CHARS);

			if (opts.replayRaw) {
				// Load archive index — raw source is required for replay
				const manifestDir = getManifestDir(store);
				const archivePath = archiveIndexPath(manifestDir, opts.collection);
				const archiveIndex = await readArchiveIndex(archivePath);
				if (!archiveIndex) {
					console.error(
						`Error: no raw source archive found at ${archivePath} — cannot --replay-raw. Re-ingest from source first.`,
					);
					process.exit(1);
				}

				// Backfill: scan source segments once to (1) collect all known documentIds
				// and (2) build a documentId → metadata map so entries archived before
				// the metadata schema existed can still carry full adapter metadata
				// (labels, author, state) into the replayed ChunkerDocument.
				const metadataBackfill = new Map<string, Record<string, string>>();
				const docIdsInSegments = new Set<string>();
				for (const segSummary of head.manifest.segments) {
					const segBytes = await store.storage.download(segSummary.id);
					const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
					for (const c of segment.chunks) {
						if (!c.documentId) continue;
						docIdsInSegments.add(c.documentId);
						if (metadataBackfill.has(c.documentId)) continue;
						const pruned: Record<string, string> = {};
						for (const [k, v] of Object.entries(c.metadata)) {
							if (k === "filePath" || k === "language" || k === "repo") continue;
							if (v === undefined || v === null) continue;
							pruned[k] = String(v);
						}
						if (Object.keys(pruned).length > 0) metadataBackfill.set(c.documentId, pruned);
					}
				}

				const allEntries = Object.values(archiveIndex.entries);
				if (format === "human") {
					console.error(
						`   --replay-raw: ${allEntries.length} raw source entries, ${metadataBackfill.size} documents with metadata backfill available`,
					);
				}

				let indexDirty = false;
				let replayedCount = 0;

				for await (const { entry, content } of replayRawDocuments(allEntries, store.storage)) {
					// Apply ignore filter based on archived filePath, if any.
					const filePath = deriveFilePath(entry.documentId, entry.sourceType);
					if (filePath && !ignoreFilter(filePath)) {
						filteredCount++;
						continue;
					}

					// Resolve metadata: entry.metadata (fresh ingests) → segment backfill (older collections)
					let metadata = entry.metadata;
					if (!metadata) {
						const backfilled = metadataBackfill.get(entry.documentId);
						if (backfilled) {
							metadata = backfilled;
							// Write-through: persist recovered metadata so future --replay-raw runs are faster.
							entry.metadata = backfilled;
							indexDirty = true;
						}
					}

					const doc: ChunkerDocument = {
						documentId: entry.documentId,
						documentVersionId: entry.documentVersionId,
						content,
						sourceType: entry.sourceType,
						source: entry.documentId,
						sourceUrl: entry.sourceUrl,
						metadata: metadata ?? {},
						// AST-aware chunkers key off filePath for language detection
						// (#220) — without it, AstChunker silently falls back.
						filePath,
					};

					const chunker = selectChunker(entry.sourceType, filePath);
					const chunkOutputs = await chunker.chunk(doc, {
						maxChunkChars: maxCharsForChunking,
					});
					for (const co of chunkOutputs) {
						allChunks.push(co as Chunk);
					}
					replayedCount++;
				}

				// Detect docs that exist in segments but have no raw archive entry.
				const archivedDocIds = new Set(allEntries.map((e) => e.documentId));
				const missingFromArchive = [...docIdsInSegments].filter((d) => !archivedDocIds.has(d));
				const missingRawDocs = missingFromArchive.length;

				if (missingRawDocs > 0) {
					if (!opts.skipMissingRaw) {
						console.error(
							`Error: ${missingRawDocs} document(s) have no raw archive entry (can't --replay-raw). ` +
								`Re-ingest from source, or pass --skip-missing-raw to warn and skip.`,
						);
						console.error(`   First missing: ${missingFromArchive.slice(0, 3).join(", ")}`);
						process.exit(1);
					}
					console.error(
						`⚠️  ${missingRawDocs} document(s) lack raw archive entries — skipped (--skip-missing-raw).`,
					);
				}

				// Write-through: persist any backfilled metadata we recovered.
				if (indexDirty) {
					await writeArchiveIndex(archivePath, archiveIndex);
					if (format === "human") {
						console.error("   ✍️  backfilled adapter metadata written to archive index");
					}
				}

				if (format === "human") {
					console.error(
						`   Replayed ${replayedCount} raw documents → ${allChunks.length} chunks (${filteredCount} filtered by ignore)`,
					);
				}
			} else {
				// Default path: read stored chunks from segments
				for (const segSummary of head.manifest.segments) {
					const segBytes = await store.storage.download(segSummary.id);
					const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;

					for (const c of segment.chunks) {
						const filePath = c.metadata.filePath;
						if (filePath && !ignoreFilter(filePath)) {
							filteredCount++;
							continue;
						}

						allChunks.push(storedChunkToSegmentChunk(c).chunk);
					}
				}

				if (format === "human") {
					console.error(
						`   Loaded ${allChunks.length} chunks (${filteredCount} filtered by ignore patterns)`,
					);
				}
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

				if (format === "human" && oversized.length > 0) {
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

				const treeSitterUrl = resolveTreeSitterUrl(opts);
				if (treeSitterUrl) {
					compositeExtractor.register({
						name: "tree-sitter",
						extractor: new TreeSitterEdgeExtractor({ baseUrl: treeSitterUrl }),
					});
				}

				const edges = mergeEdges([
					{ extractorName: "composite", edges: await compositeExtractor.extract(batchChunks) },
				]);

				// Embed
				if (format === "human") {
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
					description: currentHead?.manifest.description,
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

				if (format === "human") {
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
			} else if (format === "human") {
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

/**
 * Derive a filePath from a raw source documentId for ignore-filter and
 * chunker-selection purposes. Repo docs use `owner/repo/path/to/file.ts`,
 * so we strip the first two segments. GitHub issue/PR/discussion ids
 * (`owner/repo#N`, `owner/repo/discussions/N`) don't have a file path.
 */
function deriveFilePath(documentId: string, sourceType: string): string | undefined {
	if (
		sourceType === "github-issue" ||
		sourceType === "github-pr" ||
		sourceType === "github-discussion" ||
		sourceType === "github-pr-comment"
	) {
		return undefined;
	}
	const parts = documentId.split("/");
	if (parts.length <= 2) return undefined;
	return parts.slice(2).join("/");
}
