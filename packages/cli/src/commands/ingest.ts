import type { DocumentCatalog, Segment } from "@wtfoc/common";
import { type Chunk, type CollectionHead, CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import {
	archiveDocument,
	archiveIndexPath,
	archiveRawSource,
	buildSegment,
	buildSourceKey,
	CodeEdgeExtractor,
	CompositeEdgeExtractor,
	catalogFilePath,
	createEmptyArchiveIndex,
	createEmptyCatalog,
	cursorFilePath,
	DEFAULT_MAX_CHUNK_CHARS,
	extractSegmentMetadata,
	getAdapter,
	getAvailableSourceTypes,
	getCursorSince,
	HeuristicChunkScorer,
	HeuristicEdgeExtractor,
	isArchived,
	LlmEdgeExtractor,
	mergeEdges,
	RegexEdgeExtractor,
	readArchiveIndex,
	readCatalog,
	readCursors,
	rechunkOversized,
	renameDocument,
	segmentId,
	TreeSitterEdgeExtractor,
	updateDocument,
	writeArchiveIndex,
	writeCatalog,
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
	resolveTreeSitterUrl,
	withEmbedderOptions,
	withExtractorOptions,
	withTreeSitterOptions,
} from "../helpers.js";

export function registerIngestCommand(program: Command): void {
	withTreeSitterOptions(
		withExtractorOptions(
			withEmbedderOptions(
				program
					.command("ingest <sourceType> [args...]")
					.description("Ingest from a source (repo, slack, github, website)")
					.requiredOption("-c, --collection <name>", "Collection name")
					.option("--since <duration>", "Only fetch items newer than duration (e.g. 90d)")
					.option(
						"--description <text>",
						"Set collection description — topics, sources, and what queries it answers (applied on first ingest, use `describe` to update later)",
					)
					.option(
						"--batch-size <number>",
						"Chunks per batch (default: 500, reduces memory for large sources)",
						"500",
					)
					.option(
						"--max-chunk-chars <number>",
						`Max characters per chunk — oversized chunks are split (default: ${DEFAULT_MAX_CHUNK_CHARS})`,
					)
					.option(
						"--ignore <pattern...>",
						"Exclude files matching gitignore-style pattern (repeatable)",
					)
					.option(
						"--max-pages <number>",
						"[website] Limit number of pages to crawl (default: 100, -1 = unlimited)",
					)
					.option("--depth <number>", "[website] Limit link-following depth from start URL")
					.option(
						"--url-pattern <glob>",
						"[website] Glob pattern to restrict which URLs are crawled (default: same origin)",
					)
					.option(
						"--document-ids <ids...>",
						"Only re-process these document IDs (from document catalog)",
					)
					.option(
						"--source-paths <paths...>",
						"[repo] Only process files matching these paths (relative to repo root)",
					)
					.option(
						"--changed-since <iso>",
						"Only process documents updated after this ISO timestamp",
					),
			),
		),
	).action(
		async (
			sourceType: string,
			args: string[],
			opts: {
				collection: string;
				since?: string;
				description?: string;
				batchSize: string;
				maxChunkChars?: string;
				ignore?: string[];
				maxPages?: string;
				depth?: string;
				urlPattern?: string;
				treeSitterUrl?: string;
				documentIds?: string[];
				sourcePaths?: string[];
				changedSince?: string;
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
			if (format === "human") console.error("⏳ Loading embedder...");
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

			// Pass website-specific options (scoped to website adapter only)
			if (sourceType === "website") {
				if (opts.maxPages != null) {
					const maxPages = Number(opts.maxPages);
					if (!Number.isInteger(maxPages) || maxPages < -1) {
						console.error(
							`Error: --max-pages must be a positive integer or -1 for unlimited, got "${opts.maxPages}".`,
						);
						process.exit(2);
					}
					rawConfig.maxPages = maxPages;
				}
				if (opts.depth != null) {
					const depth = Number(opts.depth);
					if (!Number.isInteger(depth) || depth < 0) {
						console.error(`Error: --depth must be a non-negative integer, got "${opts.depth}".`);
						process.exit(2);
					}
					rawConfig.depth = depth;
				}
				if (opts.urlPattern) rawConfig.urlPattern = opts.urlPattern;
				if (format === "quiet") rawConfig.quiet = true;
			}

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
					if (format === "human") {
						console.error(`   Resuming from cursor: ${storedSince}`);
					}
				}
			}

			if (format === "human") console.error(`⏳ Ingesting ${sourceType}: ${sourceArg}...`);

			const config = adapter.parseConfig(rawConfig);
			// Pass raw ignore pattern sources to repo adapter for unified filter construction
			// (adapter loads .wtfocignore after acquireRepo, then merges all sources in order)
			if (sourceType === "repo") {
				const projectCfg = getProjectConfig();
				const adapterConfig = config as Record<string, unknown>;
				adapterConfig.ignorePatternSources = [projectCfg?.ignore, opts.ignore];
				adapterConfig.quiet = format === "quiet";
				// Pass previous commit SHA for git-diff incremental ingest
				const storedCursor = getCursorSince(cursorData, sourceKey);
				if (storedCursor?.match(/^[0-9a-f]{40}$/)) {
					adapterConfig.lastCommitSha = storedCursor;
				}
			}
			const maxBatch = Number.parseInt(opts.batchSize, 10) || 500;
			const maxChunkChars = opts.maxChunkChars
				? Number.parseInt(opts.maxChunkChars, 10)
				: (embedder.maxInputChars ?? DEFAULT_MAX_CHUNK_CHARS);
			const storageType = (program.opts().storage ?? "local") as string;

			// Build dedup set: prefer catalog (fast, no downloads) with segment fallback
			const knownFingerprints = new Set<string>();
			const knownChunkIds = new Set<string>();

			// Load or create document catalog for lifecycle management
			const collectionId = head?.manifest.collectionId ?? generateCollectionId(opts.collection);
			const catPath = catalogFilePath(manifestDir, opts.collection);
			const catalog: DocumentCatalog =
				(await readCatalog(catPath)) ?? createEmptyCatalog(collectionId);

			// Try catalog-based dedup first (O(1) — no segment downloads)
			const catalogHasEntries = Object.keys(catalog.documents).length > 0;
			if (catalogHasEntries) {
				for (const entry of Object.values(catalog.documents)) {
					for (const chunkId of entry.chunkIds) {
						knownChunkIds.add(chunkId);
					}
					for (const chunkId of entry.supersededChunkIds ?? []) {
						knownChunkIds.add(chunkId);
					}
					// Collect content fingerprints for cross-version dedup
					for (const fp of entry.contentFingerprints ?? []) {
						knownFingerprints.add(fp);
					}
				}
				if (knownChunkIds.size > 0 && format === "human") {
					console.error(
						`   ${knownChunkIds.size} existing chunks from catalog (fast dedup, ${knownFingerprints.size} fingerprints)`,
					);
				}
			} else if (head) {
				// Fallback: scan segments for legacy collections without a catalog
				for (const segSummary of head.manifest.segments) {
					try {
						const segBytes = await store.storage.download(segSummary.id);
						const seg = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
						for (const c of seg.chunks) {
							knownChunkIds.add(c.id);
							if ("contentFingerprint" in c && typeof c.contentFingerprint === "string") {
								knownFingerprints.add(c.contentFingerprint);
							}
						}
					} catch {
						// Segment may not be downloadable (e.g. FOC-only), skip
					}
				}
				if (knownChunkIds.size > 0 && format === "human") {
					console.error(`   ${knownChunkIds.size} existing chunks from segments (legacy dedup)`);
				}
			}

			// Load or create raw source archive index
			const arcPath = archiveIndexPath(manifestDir, opts.collection);
			const archiveIndex =
				(await readArchiveIndex(arcPath)) ?? createEmptyArchiveIndex(collectionId);
			let totalArchived = 0;

			// Build document-level filters from CLI flags
			const filterDocIds = opts.documentIds ? new Set(opts.documentIds) : null;
			const filterPaths = opts.sourcePaths ?? null;
			const filterChangedSince = opts.changedSince ? new Date(opts.changedSince).getTime() : null;
			let totalFiltered = 0;

			function shouldIncludeChunk(chunk: Chunk): boolean {
				// --document-ids: only include chunks matching these document IDs
				if (filterDocIds && chunk.documentId && !filterDocIds.has(chunk.documentId)) {
					return false;
				}
				// --source-paths: only include chunks whose filePath metadata matches
				if (filterPaths) {
					const filePath = chunk.metadata.filePath;
					if (!filePath) return false;
					const matches = filterPaths.some((p) => filePath === p || filePath.startsWith(`${p}/`));
					if (!matches) return false;
				}
				// --changed-since: only include chunks with timestamps after the threshold
				if (filterChangedSince) {
					const ts = chunk.timestamp ?? chunk.metadata.updatedAt ?? chunk.metadata.createdAt;
					if (!ts) return false;
					const chunkTime = new Date(ts).getTime();
					if (Number.isNaN(chunkTime) || chunkTime < filterChangedSince) return false;
				}
				return true;
			}

			if (filterDocIds && format === "human") {
				console.error(`   Filtering to ${filterDocIds.size} document ID(s)`);
			}
			if (filterPaths && format === "human") {
				console.error(`   Filtering to ${filterPaths.length} source path(s)`);
			}
			if (filterChangedSince && format === "human") {
				console.error(`   Filtering to documents changed since ${opts.changedSince}`);
			}

			// Detect partial run — filter flags mean we're selectively reprocessing
			const isPartialRun = !!(opts.documentIds || opts.sourcePaths || opts.changedSince);

			// Process chunks in batches to limit memory usage
			const scorer = new HeuristicChunkScorer();

			let batch: Chunk[] = [];
			let totalChunksIngested = 0;
			let totalChunksSkipped = 0;
			let totalDocsSuperseded = 0;
			let batchNumber = 0;
			// Track all chunks per document for catalog updates (even dedup-skipped ones)
			const catalogPendingChunks = new Map<string, Chunk[]>();

			async function flushBatch(batchChunks: Chunk[]): Promise<void> {
				if (batchChunks.length === 0) return;
				batchNumber++;

				// Extract edges for this batch
				const compositeExtractor = new CompositeEdgeExtractor();
				compositeExtractor.register({ name: "regex", extractor: new RegexEdgeExtractor() });
				compositeExtractor.register({ name: "heuristic", extractor: new HeuristicEdgeExtractor() });
				compositeExtractor.register({ name: "code", extractor: new CodeEdgeExtractor() });

				const treeSitterUrl = resolveTreeSitterUrl(opts);
				if (treeSitterUrl) {
					compositeExtractor.register({
						name: "tree-sitter",
						extractor: new TreeSitterEdgeExtractor({ baseUrl: treeSitterUrl }),
					});
				}

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
				if (format === "human")
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
					if (format === "human") console.error("⏳ Bundling into CAR...");
					const bundleResult = await bundleAndUpload(
						[{ id: segId, data: segmentBytes }],
						store.storage,
					);
					resultId = bundleResult.segmentCids.get(segId) ?? segId;
					batchForManifest = bundleResult.batch;
					if (format === "human")
						console.error(
							`   Segment bundled: ${resultId.slice(0, 16)}... (PieceCID: ${bundleResult.batch.pieceCid.slice(0, 16)}...)`,
						);
				} else {
					const segmentResult = await store.storage.upload(segmentBytes);
					resultId = segmentResult.id;
					if (format === "human") console.error(`   Segment stored: ${resultId.slice(0, 16)}...`);
				}

				// Re-read head for each batch to avoid manifest conflicts
				const currentHead = await store.manifests.getHead(opts.collection);
				const currentPrevHeadId = currentHead ? currentHead.headId : null;

				const manifest: CollectionHead = {
					schemaVersion: CURRENT_SCHEMA_VERSION,
					collectionId: currentHead?.manifest.collectionId ?? generateCollectionId(opts.collection),
					name: opts.collection,
					description: currentHead?.manifest.description ?? opts.description,
					currentRevisionId: currentHead?.manifest.currentRevisionId ?? null,
					prevHeadId: currentPrevHeadId,
					segments: [
						...(currentHead?.manifest.segments ?? []),
						{
							id: resultId,
							sourceTypes: [...new Set(batchChunks.map((c) => c.sourceType))],
							chunkCount: batchChunks.length,
							...extractSegmentMetadata(batchChunks),
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

				// Archive raw source content before chunking (P2-1)
				if (
					rawChunk.rawContent &&
					rawChunk.documentId &&
					rawChunk.documentVersionId &&
					!isArchived(archiveIndex, rawChunk.documentId, rawChunk.documentVersionId)
				) {
					await archiveRawSource(
						archiveIndex,
						rawChunk.documentId,
						rawChunk.documentVersionId,
						rawChunk.rawContent,
						{
							sourceType: rawChunk.sourceType,
							sourceUrl: rawChunk.sourceUrl,
							filePath: rawChunk.metadata.filePath,
							upload: async (data) => {
								const result = await store.storage.upload(data);
								return result.id;
							},
						},
					);
					totalArchived++;
				}
				// Strip rawContent before further processing (not persisted in segments)
				delete rawChunk.rawContent;

				// Apply document-level filters (--document-ids, --source-paths, --changed-since)
				if (!shouldIncludeChunk(rawChunk)) {
					totalFiltered++;
					continue;
				}

				const chunks = rechunkOversized([rawChunk], maxChunkChars);
				if (chunks.length > 1) rechunkedCount += chunks.length;

				for (const chunk of chunks) {
					// Always track document identity in catalog even if content is unchanged.
					// This ensures renames, re-ingests, and lifecycle transitions are recorded.
					if (chunk.documentId && chunk.documentVersionId) {
						const key = chunk.documentId;
						if (!catalogPendingChunks.has(key)) {
							catalogPendingChunks.set(key, []);
						}
						(catalogPendingChunks.get(key) as Chunk[]).push(chunk);
					}

					// Dedup: skip re-embedding when content is unchanged
					const dedupKey = chunk.contentFingerprint ?? chunk.id;
					if (knownFingerprints.has(dedupKey) || knownChunkIds.has(chunk.id)) {
						totalChunksSkipped++;
						continue;
					}
					batch.push(chunk);
					if (batch.length >= maxBatch) {
						if (format === "human")
							console.error(`   ${totalChunksIngested + batch.length} chunks so far...`);
						await flushBatch(batch);
						batch = [];
					}
				}
			}
			// Flush remaining chunks
			await flushBatch(batch);
			batch = [];

			// Update document catalog from ALL seen chunks (including dedup-skipped).
			// This ensures renames, unchanged files, and lifecycle transitions are tracked.
			if (catalogPendingChunks.size > 0) {
				// Determine source-specific mutability
				const appendOnlyTypes = new Set(["hn-story", "hn-comment"]);

				for (const [docId, docChunks] of catalogPendingChunks) {
					const firstChunk = docChunks[0];
					if (!firstChunk?.documentVersionId) continue;

					// Tombstone chunks signal deletion
					if (firstChunk.sourceType === "tombstone") {
						archiveDocument(catalog, docId);
						continue;
					}

					// Source-specific mutability:
					// - HN stories/comments are append-only (content doesn't change)
					// - Everything else is mutable-state (files, issues, PRs, Slack/Discord groups, docs)
					const mutability = appendOnlyTypes.has(firstChunk.sourceType)
						? ("append-only" as const)
						: ("mutable-state" as const);

					const fingerprints = docChunks
						.map((c) => c.contentFingerprint)
						.filter((fp): fp is string => fp !== undefined);

					const result = updateDocument(catalog, {
						documentId: docId,
						versionId: firstChunk.documentVersionId,
						chunkIds: docChunks.map((c) => c.id),
						contentFingerprints: fingerprints,
						sourceType: firstChunk.sourceType,
						mutability,
					});

					if (result.previousVersionId && result.supersededChunkIds.length > 0) {
						totalDocsSuperseded++;
					}
				}

				// Handle renames: archive old document IDs from git-diff renames
				// Only apply on full runs — partial runs should not modify catalog for unprocessed docs
				if (
					!isPartialRun &&
					sourceType === "repo" &&
					"lastIngestMetadata" in adapter &&
					(
						adapter as {
							lastIngestMetadata: {
								renamedFiles: Array<{ oldPath: string; newPath: string }>;
							} | null;
						}
					).lastIngestMetadata?.renamedFiles.length
				) {
					const repo = args[0] ?? "";
					const renames = (
						adapter as {
							lastIngestMetadata: { renamedFiles: Array<{ oldPath: string; newPath: string }> };
						}
					).lastIngestMetadata.renamedFiles;
					for (const { oldPath } of renames) {
						const oldDocId = `${repo}/${oldPath}`;
						renameDocument(catalog, oldDocId);
					}
					if (format === "human" && renames.length > 0) {
						console.error(`   📋 ${renames.length} renamed file(s) archived in catalog`);
					}
				}

				await writeCatalog(catPath, catalog);
				if (totalArchived > 0) {
					await writeArchiveIndex(arcPath, archiveIndex);
				}
				if (format === "human" && (totalDocsSuperseded > 0 || totalArchived > 0)) {
					const parts: string[] = [];
					if (catalogPendingChunks.size > 0)
						parts.push(`${catalogPendingChunks.size} documents tracked`);
					if (totalArchived > 0) parts.push(`${totalArchived} raw sources archived`);
					if (totalDocsSuperseded > 0) parts.push(`${totalDocsSuperseded} superseded`);
					console.error(`   📋 ${parts.join(", ")}`);
				}
			}

			if (totalChunksIngested === 0 && totalChunksSkipped === 0) {
				if (format === "human") console.error("⚠️  No chunks produced — skipping upload");
				return;
			}

			if (format === "human") {
				const parts = [`${totalChunksIngested} chunks`];
				if (batchNumber > 1) parts[0] += ` (${batchNumber} batches)`;
				if (rechunkedCount > 0) parts.push(`${rechunkedCount} from oversized splits`);
				if (totalChunksSkipped > 0) parts.push(`${totalChunksSkipped} skipped as duplicates`);
				if (totalFiltered > 0) parts.push(`${totalFiltered} filtered out`);
				if (totalDocsSuperseded > 0) parts.push(`${totalDocsSuperseded} documents superseded`);
				console.error(
					`✅ Ingested ${parts.join(", ")} from ${sourceArg} into "${opts.collection}"`,
				);
			}

			// Persist cursor after successful ingest (FR-001, FR-004: only on success)
			// IMPORTANT: Don't advance cursor when filter flags are active — partial runs
			// should not skip unprocessed changes on the next full ingest
			if (isPartialRun && format === "human") {
				console.error("   ⚠️  Partial run (filter flags active) — cursor not advanced");
			}

			// For repo adapters: use git HEAD SHA as cursor (enables git-diff next run)
			// For other adapters: use max timestamp from chunk data
			const repoHeadSha =
				!isPartialRun && sourceType === "repo" && "lastIngestMetadata" in adapter
					? (adapter as { lastIngestMetadata: { headCommitSha: string | null } | null })
							.lastIngestMetadata?.headCommitSha
					: null;
			const cursorValue = isPartialRun ? null : (repoHeadSha ?? (maxTimestamp || null));

			if (cursorValue) {
				const existingCursorValue = cursorData?.cursors?.[sourceKey]?.cursorValue;
				// For repo adapter with SHA cursor, always use the latest head SHA
				// For timestamp cursors, use max(existing, computed) to prevent regression
				const nextCursorValue =
					repoHeadSha ??
					(existingCursorValue && existingCursorValue > cursorValue
						? existingCursorValue
						: cursorValue);
				const updatedCursors = cursorData ?? { schemaVersion: 1 as const, cursors: {} };
				updatedCursors.cursors[sourceKey] = {
					sourceKey,
					adapterType: sourceType,
					cursorValue: nextCursorValue,
					lastRunAt: new Date().toISOString(),
					chunksIngested: totalChunksIngested,
				};
				await writeCursors(cursorPath, updatedCursors);
				if (format === "human") {
					console.error(`   Saved cursor for next run: ${nextCursorValue}`);
				}
			}

			// synapse-sdk keeps HTTP connections alive with no cleanup method
			if (storageType === "foc") process.exit(0);
		},
	);
}
