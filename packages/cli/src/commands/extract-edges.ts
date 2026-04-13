import { createHash } from "node:crypto";
import type { Chunk, CollectionHead, DerivedEdgeLayerSummary, Edge, Segment } from "@wtfoc/common";
import {
	buildDerivedEdgeLayer,
	CodeEdgeExtractor,
	computeContextHash,
	type ExtractionStatusData,
	getContextsToProcess,
	HeuristicEdgeExtractor,
	LlmEdgeExtractor,
	type LlmEdgeExtractorOptions,
	listExtractorOverlayIds,
	mergeOverlayEdges,
	overlayFilePath,
	RegexEdgeExtractor,
	readExtractionStatus,
	readOverlayEdges,
	statusFilePath,
	TreeSitterEdgeExtractor,
	writeExtractionStatus,
	writeOverlayEdges,
} from "@wtfoc/ingest";
import type { Command } from "commander";
import { getFormat, getManifestDir, getStore } from "../helpers.js";

/** Known extractor names (not including preset tokens). */
const KNOWN_EXTRACTOR_NAMES = ["regex", "heuristic", "code", "tree-sitter", "llm"] as const;

/** Default extractor set (fast local extractors). */
const DEFAULT_EXTRACTORS = ["regex", "heuristic", "code"];

/**
 * Map a segment chunk to the Chunk interface for extractors.
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
 */
async function pruneStaleData(
	overlayEdges: Edge[],
	statusData: ExtractionStatusData,
	allChunks: Chunk[],
	contexts: Array<{ contextId: string }>,
	overlayPath: string,
	statusPath: string,
	collectionId: string,
	existingOverlayCreatedAt: string | undefined,
	format: string,
): Promise<Edge[]> {
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
		if (format === "human") {
			if (edgesPruned > 0) console.error(`🧹 Pruned ${edgesPruned} stale overlay edges`);
			if (contextsPruned > 0) console.error(`🧹 Pruned ${contextsPruned} stale status entries`);
		}
	}

	return prunedEdges;
}

interface LlmCliOpts {
	llmUrl?: string;
	llmModel?: string;
	llmApiKey?: string;
	llmJsonMode?: string;
	llmTimeoutMs?: string;
	llmConcurrency?: string;
	llmMaxInputTokens?: string;
}

/**
 * Compute a stable extractorId for an LLM config.
 * Includes baseUrl and model so different LLM configs don't share overlays.
 */
function llmExtractorId(baseUrl: string, model: string): string {
	const hash = createHash("sha256").update(`${baseUrl}:${model}`).digest("hex").slice(0, 12);
	return `llm-${hash}`;
}

interface ExtractorSpec {
	extractorId: string;
	extract: (chunks: Chunk[], signal?: AbortSignal) => Promise<Edge[]>;
}

export function registerExtractEdgesCommand(program: Command): void {
	const URL_SHORTCUTS: Record<string, string> = {
		lmstudio: "http://localhost:1234/v1",
		ollama: "http://localhost:11434/v1",
	};

	program
		.command("extract-edges")
		.description(
			"Run edge extraction on an existing collection. Specify which extractors to run with --extractor.",
		)
		.requiredOption("-c, --collection <name>", "Collection name")
		.option(
			"--extractor <name>",
			"Extractor to run. Repeatable. Names: regex, heuristic, code, tree-sitter, llm. Tokens: default (regex+heuristic+code), all (default+llm if configured)",
			(val: string, prev: string[]) => [...prev, val],
			[] as string[],
		)
		.option("--list-extractors", "List available extractors and exit")
		.option("--tree-sitter-url <url>", "Tree-sitter sidecar URL (enables tree-sitter extractor)")
		.option("--llm-url <url>", "LLM base URL or shortcut (lmstudio, ollama)")
		.option("--llm-model <model>", "LLM model name")
		.option("--llm-api-key <key>", "LLM API key")
		.option("--llm-json-mode <mode>", "LLM JSON mode: auto, on, off (default: auto)")
		.option("--llm-timeout-ms <ms>", "LLM request timeout in ms (default: 60000)")
		.option("--llm-concurrency <n>", "LLM max concurrent requests (default: 4)")
		.option(
			"--llm-max-input-tokens <n>",
			"LLM max input tokens per context (0=unlimited, default: 4000)",
		)
		.option(
			"--context-concurrency <n>",
			"Number of contexts to process in parallel per extractor (default: 4)",
			"4",
		)
		.action(
			async (
				opts: {
					collection: string;
					extractor: string[];
					listExtractors?: boolean;
					treeSitterUrl?: string;
					contextConcurrency: string;
				} & LlmCliOpts,
			) => {
				const format = getFormat(program.opts());

				if (opts.listExtractors) {
					const extractors = [...KNOWN_EXTRACTOR_NAMES];
					if (format === "json") {
						console.log(JSON.stringify({ extractors, presets: ["default", "all"] }));
					} else {
						console.error("Available extractors:");
						for (const name of extractors) {
							console.error(`  ${name}`);
						}
						console.error("\nPresets:");
						console.error(
							"  default   — regex, heuristic, code (+ tree-sitter if --tree-sitter-url set)",
						);
						console.error("  all       — default + llm (if --llm-url and --llm-model set)");
					}
					return;
				}

				// Set up abort handling
				const abortController = new AbortController();
				const { signal } = abortController;
				process.on("SIGINT", () => abortController.abort(new Error("Interrupted")));
				process.on("SIGTERM", () => abortController.abort(new Error("Terminated")));

				// Resolve tree-sitter URL
				const treeSitterUrl = opts.treeSitterUrl ?? process.env.WTFOC_TREE_SITTER_URL ?? null;

				// Resolve LLM config if requested
				const rawLlmUrl = opts.llmUrl ?? process.env.WTFOC_EXTRACTOR_URL;
				const llmBaseUrl = rawLlmUrl ? (URL_SHORTCUTS[rawLlmUrl] ?? rawLlmUrl) : null;
				const llmModel = opts.llmModel ?? process.env.WTFOC_EXTRACTOR_MODEL ?? null;

				// Expand extractor names (handle presets)
				const requestedNames = opts.extractor.length > 0 ? opts.extractor : [];
				if (requestedNames.length === 0) {
					console.error(
						"Error: specify at least one --extractor. Use --list-extractors to see options.",
					);
					console.error("  Example: --extractor default");
					console.error("  Example: --extractor regex --extractor code --extractor llm");
					process.exit(2);
				}

				const resolvedNames = new Set<string>();
				for (const name of requestedNames) {
					if (name === "default") {
						for (const n of DEFAULT_EXTRACTORS) resolvedNames.add(n);
						if (treeSitterUrl) resolvedNames.add("tree-sitter");
					} else if (name === "all") {
						for (const n of DEFAULT_EXTRACTORS) resolvedNames.add(n);
						if (treeSitterUrl) resolvedNames.add("tree-sitter");
						if (llmBaseUrl && llmModel) resolvedNames.add("llm");
					} else if (
						KNOWN_EXTRACTOR_NAMES.includes(name as (typeof KNOWN_EXTRACTOR_NAMES)[number])
					) {
						resolvedNames.add(name);
					} else {
						console.error(
							`Error: unknown extractor "${name}". Run --list-extractors to see valid options.`,
						);
						process.exit(2);
					}
				}

				// Validate config for requested extractors
				if (resolvedNames.has("tree-sitter") && !treeSitterUrl) {
					console.error(
						"Error: --tree-sitter-url is required when using the tree-sitter extractor.",
					);
					process.exit(2);
				}
				if (resolvedNames.has("llm")) {
					if (!llmBaseUrl || !llmBaseUrl.startsWith("http")) {
						console.error(
							"Error: --llm-url is required when using the llm extractor (e.g. http://localhost:1234/v1 or lmstudio).",
						);
						process.exit(2);
					}
					if (!llmModel) {
						console.error("Error: --llm-model is required when using the llm extractor.");
						process.exit(2);
					}
				}

				// Build extractor specs
				const extractorSpecs: ExtractorSpec[] = [];

				// Fast local pattern extractors (can be batched in CompositeEdgeExtractor for efficiency,
				// but each gets its own overlay for independent re-run capability)
				const patternExtractors: Array<{ name: string; id: string }> = [];
				if (resolvedNames.has("regex")) patternExtractors.push({ name: "regex", id: "regex" });
				if (resolvedNames.has("heuristic"))
					patternExtractors.push({ name: "heuristic", id: "heuristic" });
				if (resolvedNames.has("code")) patternExtractors.push({ name: "code", id: "code" });

				// Run each local pattern extractor individually so each gets its own overlay
				for (const { name, id } of patternExtractors) {
					let extractInstance: { extract: (c: Chunk[], s?: AbortSignal) => Promise<Edge[]> };
					if (name === "regex") extractInstance = new RegexEdgeExtractor();
					else if (name === "heuristic") extractInstance = new HeuristicEdgeExtractor();
					else extractInstance = new CodeEdgeExtractor();

					extractorSpecs.push({
						extractorId: id,
						extract: (chunks, sig) => extractInstance.extract(chunks, sig),
					});
				}

				if (resolvedNames.has("tree-sitter")) {
					const ts = new TreeSitterEdgeExtractor({ baseUrl: treeSitterUrl as string });
					extractorSpecs.push({
						extractorId: "tree-sitter",
						extract: (chunks, sig) => ts.extract(chunks, sig),
					});
				}

				if (resolvedNames.has("llm")) {
					function parseMaxTokens(raw: string | undefined): number {
						if (raw == null) return 4000;
						const n = Number.parseInt(raw, 10);
						if (Number.isNaN(n)) return 4000;
						if (n === 0) return Number.POSITIVE_INFINITY;
						return n;
					}
					const llmOpts: LlmEdgeExtractorOptions = {
						baseUrl: llmBaseUrl as string,
						model: llmModel as string,
						apiKey: opts.llmApiKey ?? process.env.WTFOC_EXTRACTOR_API_KEY,
						jsonMode: (["auto", "on", "off"].includes(opts.llmJsonMode ?? "")
							? opts.llmJsonMode
							: "auto") as "auto" | "on" | "off",
						timeoutMs:
							Number.parseInt(
								opts.llmTimeoutMs ?? process.env.WTFOC_EXTRACTOR_TIMEOUT_MS ?? "60000",
								10,
							) || 60000,
						maxConcurrency:
							Number.parseInt(
								opts.llmConcurrency ?? process.env.WTFOC_EXTRACTOR_MAX_CONCURRENCY ?? "4",
								10,
							) || 4,
						maxInputTokens: parseMaxTokens(
							opts.llmMaxInputTokens ?? process.env.WTFOC_EXTRACTOR_MAX_INPUT_TOKENS,
						),
					};
					const llm = new LlmEdgeExtractor(llmOpts);
					extractorSpecs.push({
						extractorId: llmExtractorId(llmBaseUrl as string, llmModel as string),
						extract: (chunks, sig) => llm.extract(chunks, sig),
					});
				}

				// Load collection
				const store = getStore(program);
				const headResult = await store.manifests.getHead(opts.collection);
				if (!headResult) {
					console.error(`Collection "${opts.collection}" not found.`);
					process.exit(1);
				}
				const head = headResult;

				if (format === "human") {
					console.error(`⏳ Loading collection "${opts.collection}"...`);
				}

				const segments = await loadSegments(head.manifest, store.storage, signal);
				const allChunks: Chunk[] = segments.flatMap((seg) => seg.chunks.map(segmentChunkToChunk));

				if (format === "human") {
					console.error(`📦 ${allChunks.length} chunks in ${segments.length} segments`);
					console.error(`🔧 Running extractors: ${[...resolvedNames].join(", ")}`);
				}

				// Build extraction contexts (shared across all extractors)
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

				const chunksByContextId = new Map<string, Chunk[]>();
				for (const ctx of contexts) {
					chunksByContextId.set(ctx.contextId, ctx.chunks);
				}

				const manifestDir = getManifestDir(store);
				const contextConcurrency = Math.max(1, Number.parseInt(opts.contextConcurrency, 10) || 4);

				let totalNewEdgesAllExtractors = 0;

				// Run each extractor sequentially (each manages its own overlay)
				for (const spec of extractorSpecs) {
					signal.throwIfAborted();

					if (format === "human") {
						console.error(`\n▶ Extractor: ${spec.extractorId}`);
					}

					const edgesOverlayPath = overlayFilePath(manifestDir, opts.collection, spec.extractorId);
					const statusPath = statusFilePath(manifestDir, opts.collection, spec.extractorId);

					const existingStatus = await readExtractionStatus(statusPath);
					const existingOverlay = await readOverlayEdges(edgesOverlayPath);
					const existingOverlayCreatedAt = existingOverlay?.createdAt;

					const statusData: ExtractionStatusData = existingStatus
						? {
								...existingStatus,
								extractorId: spec.extractorId,
								contexts: { ...existingStatus.contexts },
							}
						: { extractorId: spec.extractorId, contexts: {} };

					let overlayEdges = await pruneStaleData(
						existingOverlay?.edges ?? [],
						statusData,
						allChunks,
						contexts,
						edgesOverlayPath,
						statusPath,
						head.manifest.collectionId,
						existingOverlayCreatedAt,
						format,
					);

					const toProcess = getContextsToProcess(existingStatus, contexts, spec.extractorId);

					if (toProcess.length === 0) {
						if (format === "human") {
							console.error("  ✅ All contexts already processed. Nothing to do.");
						}
						continue;
					}

					if (format === "human") {
						console.error(
							`  🔍 ${toProcess.length}/${contexts.length} contexts to process (${toProcess.reduce((sum, c) => sum + c.chunkIds.length, 0)} chunks)`,
						);
						if (contextConcurrency > 1) {
							console.error(`  Context concurrency: ${contextConcurrency}`);
						}
					}

					let totalNewEdges = 0;
					let processed = 0;

					// Mutex for shared state writes
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
						if (format === "human") {
							console.error(
								`  [${idx}/${toProcess.length}] ${ctx.contextId} (${chunksForContext.length} chunks)...`,
							);
						}

						try {
							const edges = await spec.extract(chunksForContext, signal);

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
								await writeOverlayEdges(edgesOverlayPath, {
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

					// Process with bounded concurrency
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
					await Promise.all(active);

					totalNewEdgesAllExtractors += totalNewEdges;

					// Store as immutable derived-edge layer artifact
					if (totalNewEdges > 0) {
						const layer = buildDerivedEdgeLayer(
							head.manifest.collectionId,
							spec.extractorId,
							overlayEdges,
							processed,
						);
						const layerBytes = new TextEncoder().encode(JSON.stringify(layer));
						const layerStorageResult = await store.storage.upload(layerBytes);

						const layerSummary: DerivedEdgeLayerSummary = {
							id: layerStorageResult.id,
							extractorId: spec.extractorId,
							edgeCount: overlayEdges.length,
							createdAt: layer.createdAt,
							contextsProcessed: processed,
						};

						// Update manifest with new layer reference
						const currentHead = await store.manifests.getHead(opts.collection);
						if (currentHead) {
							const manifest: CollectionHead = {
								...currentHead.manifest,
								derivedEdgeLayers: [
									...(currentHead.manifest.derivedEdgeLayers ?? []),
									layerSummary,
								],
								updatedAt: new Date().toISOString(),
							};
							await store.manifests.putHead(opts.collection, manifest, currentHead.headId);
						}

						if (format === "human") {
							console.error(
								`  📦 Stored derived edge layer: ${layerStorageResult.id.slice(0, 16)}...`,
							);
						}
					}

					const failed = Object.values(statusData.contexts).filter(
						(c) => c.status === "failed",
					).length;
					const completed = Object.values(statusData.contexts).filter(
						(c) => c.status === "completed",
					).length;

					if (format === "human") {
						console.error(`  ✅ Done. ${totalNewEdges} new edges extracted.`);
						console.error(
							`     Contexts: ${completed} completed, ${failed} failed, ${contexts.length} total`,
						);
						console.error(`     Overlay: ${overlayEdges.length} total edges`);
					}
				}

				if (signal.aborted && format === "human") {
					console.error(`\n⚠️  Cancelled.`);
				}

				if (format === "json") {
					const existingOverlayIds = await listExtractorOverlayIds(manifestDir, opts.collection);
					console.log(
						JSON.stringify({
							collection: opts.collection,
							extractors: extractorSpecs.map((s) => s.extractorId),
							totalNewEdges: totalNewEdgesAllExtractors,
							overlayIds: existingOverlayIds,
						}),
					);
				}

				if (signal.aborted) process.exit(130);
			},
		);
}
