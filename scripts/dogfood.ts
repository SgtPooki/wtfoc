#!/usr/bin/env tsx
/**
 * Developer-only dogfood evaluation script.
 * Run: pnpm dogfood --collection <name> [options]
 *
 * NOT a public CLI command — this is for wtfoc developers only.
 */

import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type EvalStageResult,
	type Segment,
	aggregateVerdict,
} from "@wtfoc/common";
import { evaluateIngest, evaluateEdgeExtraction, evaluateSignals, readCatalog, catalogFilePath, loadAllOverlayEdges } from "@wtfoc/ingest";
import {
	BgeReranker,
	CachingEmbedder,
	evaluateEdgeResolution,
	evaluateSearch,
	evaluateThemes,
	GOLD_STANDARD_QUERIES_VERSION,
	GOLD_STANDARD_QUERIES,
	InMemoryVectorIndex,
	LlmReranker,
	OpenAIEmbedder,
	type Reranker,
} from "@wtfoc/search";
import { evaluateStorage, createStore } from "@wtfoc/store";
import { formatDogfoodReport } from "./dogfood-formatter.js";
import { buildRunConfig, defaultQualityQueriesRetrieval } from "./lib/build-run-config.js";
import { CostAggregator } from "./lib/cost-aggregator.js";
import {
	buildRetrievalContext,
	groundingPromptHashes,
	loadSearchPhaseCache,
	runEmbedPhase,
	runQualityQueriesPipeline,
	runScorePhase,
	runSearchPhase,
} from "./lib/dogfood-pipeline.js";
import type { LlmUsage } from "./lib/llm-usage.js";
import {
	computeRunConfigFingerprint,
	type ExtendedDogfoodReport,
	FINGERPRINT_VERSION,
} from "./lib/run-config.js";
import { SubstageTimer } from "./lib/substage-timer.js";

const VALID_STAGES = [
	"ingest",
	"edges",
	"resolution",
	"storage",
	"themes",
	"signals",
	"search",
	"quality-queries",
] as const;
type StageName = (typeof VALID_STAGES)[number];

/** Map CLI stage names to canonical report stage IDs */
const STAGE_ID: Record<StageName, string> = {
	ingest: "ingest",
	edges: "edge-extraction",
	resolution: "edge-resolution",
	storage: "storage",
	themes: "themes",
	signals: "signals",
	search: "search",
	"quality-queries": "quality-queries",
};

const { values } = parseArgs({
	options: {
		collection: { type: "string", short: "c" },
		stage: { type: "string" },
		json: { type: "boolean", default: false },
		output: { type: "string" },
		"skip-llm": { type: "boolean", default: false },
		"extractor-url": { type: "string" },
		"extractor-model": { type: "string" },
		"extractor-key": { type: "string" },
		"embedder-url": { type: "string" },
		"embedder-model": { type: "string" },
		"embedder-key": { type: "string" },
		"embedder-cache-dir": { type: "string" },
		"reranker-type": { type: "string" }, // "llm" | "bge" (bge not yet implemented)
		"reranker-url": { type: "string" },  // base URL for llm or bge reranker
		"reranker-model": { type: "string" }, // model name for llm reranker
		"auto-route": { type: "boolean", default: false }, // enable persona-based boost routing (#265)
		"diversity-enforce": { type: "boolean", default: false }, // enforce source-type diversity in top-K / seeds (#161)
		// Numeric retrieval knobs — set by sweep harness for the autonomous
		// loop (#334). When omitted, defaults match defaultQualityQueriesRetrieval.
		"top-k": { type: "string" },
		"trace-max-per-source": { type: "string" },
		"trace-max-total": { type: "string" },
		"trace-min-score": { type: "string" },
		// 3-phase sweep (single-GPU mode-switch) — split the
		// quality-queries pipeline into embed → search → score so the sweep
		// driver can swap GPU modes between phases without forcing the full
		// matrix to share one mode.
		phase: { type: "string", default: "all" },
		"cache-base": { type: "string" },
		"sweep-id": { type: "string" },
		"variant-id": { type: "string" },
		help: { type: "boolean", short: "h", default: false },
	},
	strict: true,
});

if (values.help) {
	console.log(`
Usage: pnpm dogfood --collection <name> [options]

Options:
  -c, --collection <name>    Collection to evaluate (required)
  --stage <name>             Run single stage: ${VALID_STAGES.join("|")}
  --json                     Output JSON to stdout
  --output <path>            Write JSON report to file or directory
  --skip-llm                 Skip LLM-dependent stages (edges, themes labeling, search)
  --extractor-url <url>      LLM endpoint (e.g. lmstudio, http://localhost:1234/v1)
  --extractor-model <model>  LLM model name
  --embedder-url <url>       Embedder endpoint
  --embedder-model <model>   Embedder model name
  --embedder-key <key>       Embedder API key
  --phase <name>             quality-queries phase: all|embed|search|score (default: all)
  --cache-base <path>        Phase cache root (or env WTFOC_DOGFOOD_CACHE_DIR)
  --sweep-id <id>            Sweep id for phase cache path
  --variant-id <id>          Variant id for phase cache path
  -h, --help                 Show this help
`);
	process.exit(0);
}

if (!values.collection) {
	console.error("Error: --collection is required");
	process.exit(1);
}

// Validate stage
if (values.stage && !VALID_STAGES.includes(values.stage as StageName)) {
	console.error(
		`Error: --stage must be one of: ${VALID_STAGES.join(", ")}`,
	);
	process.exit(1);
}

const VALID_PHASES = ["all", "embed", "search", "score"] as const;
type PhaseName = (typeof VALID_PHASES)[number];
const phase = (values.phase ?? "all") as string;
if (!VALID_PHASES.includes(phase as PhaseName)) {
	console.error(`Error: --phase must be one of: ${VALID_PHASES.join(", ")}`);
	process.exit(1);
}
if (phase !== "all") {
	const cacheBase = values["cache-base"] ?? process.env.WTFOC_DOGFOOD_CACHE_DIR;
	if (!cacheBase) {
		console.error(
			"Error: --phase != all requires --cache-base or WTFOC_DOGFOOD_CACHE_DIR",
		);
		process.exit(1);
	}
	if (!values["sweep-id"] || !values["variant-id"]) {
		console.error(
			"Error: --phase != all requires --sweep-id and --variant-id",
		);
		process.exit(1);
	}
}

// Validate edge stage requires extractor options
if (
	values.stage === "edges" &&
	(!values["extractor-url"] || !values["extractor-model"])
) {
	console.error(
		"Error: --stage edges requires --extractor-url and --extractor-model",
	);
	process.exit(1);
}

const stagesToRun: StageName[] = values.stage
	? [values.stage as StageName]
	: [...VALID_STAGES];

const skipLlm = values["skip-llm"];

async function main() {
	const t0 = performance.now();

	// Load collection
	const store = createStore({ storage: "local" });
	const head = await store.manifests.getHead(values.collection!);
	if (!head) {
		console.error(`Error: Collection "${values.collection}" not found`);
		process.exit(1);
	}

	// Load segments
	const segments: Segment[] = [];
	for (const segSummary of head.manifest.segments) {
		const raw = await store.storage.download(segSummary.id);
		const text = new TextDecoder().decode(raw);
		segments.push(JSON.parse(text) as Segment);
	}

	// Citation/grounding configuration. Off by default; opt-in with
	// WTFOC_GROUND_CHECK=1. Grader and synthesizer prompts are pinned
	// and hashed into the run fingerprint so any prompt edit produces
	// a fresh fingerprint + namespaced cache.
	const groundingEnabled = process.env.WTFOC_GROUND_CHECK === "1";
	if (groundingEnabled && !process.env.WTFOC_GRADER_URL) {
		throw new Error(
			"WTFOC_GROUND_CHECK=1 requires WTFOC_GRADER_URL (OpenAI-compatible /v1 endpoint) and WTFOC_GRADER_MODEL",
		);
	}
	const graderConfig = groundingEnabled
		? {
				url: process.env.WTFOC_GRADER_URL!,
				model: process.env.WTFOC_GRADER_MODEL ?? "",
				apiKey: process.env.WTFOC_GRADER_KEY,
			}
		: null;
	if (graderConfig && !graderConfig.model) {
		throw new Error("WTFOC_GROUND_CHECK=1 requires WTFOC_GRADER_MODEL");
	}
	const synthesizerConfig =
		groundingEnabled && values["extractor-url"] && values["extractor-model"]
			? {
					url: values["extractor-url"],
					model: values["extractor-model"],
					apiKey: values["extractor-key"],
				}
			: null;
	const promptHashes = groundingPromptHashes(groundingEnabled);

	// Build the run identity record + fingerprint up front so cache
	// namespacing can use it before any stage runs. Variants with
	// different fingerprints share no on-disk caches.
	const runConfig = buildRunConfig({
		collectionId: values.collection!,
		manifest: head.manifest,
		goldFixtureVersion: GOLD_STANDARD_QUERIES_VERSION,
		goldFixture: GOLD_STANDARD_QUERIES,
		embedder: {
			url: values["embedder-url"] ?? "",
			model: values["embedder-model"] ?? "",
		},
		extractor:
			values["extractor-url"] && values["extractor-model"]
				? { url: values["extractor-url"], model: values["extractor-model"] }
				: null,
		reranker:
			values["reranker-type"] && values["reranker-url"]
				? {
						type: values["reranker-type"],
						url: values["reranker-url"],
						model: values["reranker-model"] ?? values["extractor-model"],
					}
				: null,
		grader: graderConfig ? { url: graderConfig.url, model: graderConfig.model } : null,
		retrieval: defaultQualityQueriesRetrieval({
			autoRoute: values["auto-route"] ?? false,
			diversityEnforce: values["diversity-enforce"] ?? false,
			...(values["top-k"] !== undefined
				? { topK: Number.parseInt(values["top-k"], 10) }
				: {}),
			...(values["trace-max-per-source"] !== undefined
				? { traceMaxPerSource: Number.parseInt(values["trace-max-per-source"], 10) }
				: {}),
			...(values["trace-max-total"] !== undefined
				? { traceMaxTotal: Number.parseInt(values["trace-max-total"], 10) }
				: {}),
			...(values["trace-min-score"] !== undefined
				? { traceMinScore: Number.parseFloat(values["trace-min-score"]) }
				: {}),
		}),
		evaluation: {
			checkParaphrases: process.env.WTFOC_CHECK_PARAPHRASES === "1",
			groundCheck: groundingEnabled,
		},
		promptHashes,
	});
	const runConfigFingerprint = computeRunConfigFingerprint(runConfig);

	// Per-substage telemetry — maintainer-only. Captures wall-clock + token
	// usage across the quality-queries stage. Sinks pipe into the timer +
	// aggregator, which become metrics in the resulting report.
	const timer = new SubstageTimer();
	const costs = new CostAggregator();
	const embedderUsageSink = (u: LlmUsage): void => {
		if (typeof u.durationMs === "number") timer.record("embed-call", u.durationMs);
		costs.record("embed-call", u);
	};
	const rerankerUsageSink = (u: LlmUsage): void => {
		if (typeof u.durationMs === "number") timer.record("rerank", u.durationMs);
		costs.record("rerank", u);
	};

	// Build optional reranker
	let reranker: Reranker | undefined;
	const rerankerType = values["reranker-type"];
	const rerankerUrl = values["reranker-url"];
	if (rerankerType === "bge" && rerankerUrl) {
		reranker = new BgeReranker({ url: rerankerUrl });
		console.error(`[dogfood] Reranker: bge (${rerankerUrl})`);
	} else if (rerankerType === "llm" && rerankerUrl && values["extractor-model"]) {
		reranker = new LlmReranker({
			baseUrl: rerankerUrl,
			model: values["reranker-model"] ?? values["extractor-model"],
			apiKey: values["extractor-key"],
			usageSink: rerankerUsageSink,
		});
		console.error(`[dogfood] Reranker: llm (${rerankerUrl}, model=${values["reranker-model"] ?? values["extractor-model"]})`);
	}

	const stageResults: EvalStageResult[] = [];

	for (const stage of stagesToRun) {
		if (skipLlm && (stage === "edges" || stage === "search" || stage === "quality-queries")) {
			stageResults.push({
				stage: STAGE_ID[stage],
				startedAt: new Date().toISOString(),
				durationMs: 0,
				verdict: "skipped",
				summary: "skipped: --skip-llm flag set",
				metrics: {},
				checks: [],
			});
			continue;
		}

		try {
			let result: EvalStageResult;

			switch (stage) {
				case "ingest":
					result = await evaluateIngest(segments, head.manifest);
					break;

				case "edges": {
					if (!values["extractor-url"] || !values["extractor-model"]) {
						result = {
							stage: STAGE_ID[stage],
							startedAt: new Date().toISOString(),
							durationMs: 0,
							verdict: "pass",
							summary: "skipped: no extractor configured",
							metrics: {},
							checks: [],
						};
					} else {
						result = await evaluateEdgeExtraction({
							baseUrl: values["extractor-url"],
							model: values["extractor-model"],
							apiKey: values["extractor-key"],
						});
					}
					break;
				}

				case "resolution": {
					const manifestDir =
						(store.manifests as { dir?: string }).dir ??
						`${process.env.HOME ?? "."}.wtfoc/projects`;
					const overlayEdges = await loadAllOverlayEdges(manifestDir, values.collection!);
					result = await evaluateEdgeResolution(segments, overlayEdges);
					break;
				}

				case "storage": {
					// Load document catalog for AC-US6-04 orphan check
					// Derive manifest dir from store to avoid hardcoding paths
					const manifestDir = (store.manifests as { dir?: string }).dir ?? `${process.env.HOME ?? "."}/.wtfoc/projects`;
					const catPath = catalogFilePath(manifestDir, values.collection!);
					const catalog = await readCatalog(catPath);
					result = await evaluateStorage({
						head: head.manifest,
						storage: store.storage,
						catalog,
					});
					break;
				}

				case "themes":
					result = await evaluateThemes(segments, undefined, head.manifest);
					break;

				case "signals":
					result = await evaluateSignals(segments);
					break;

				case "search": {
					if (!values["embedder-url"] || !values["embedder-model"]) {
						result = {
							stage: STAGE_ID[stage],
							startedAt: new Date().toISOString(),
							durationMs: 0,
							verdict: "pass",
							summary: "skipped: no embedder configured (requires --embedder-url and --embedder-model)",
							metrics: {},
							checks: [],
						};
					} else {
						const rawEmbedder = new OpenAIEmbedder({
							apiKey: values["embedder-key"] || process.env.WTFOC_EMBEDDER_KEY || values["extractor-key"] || "no-key",
							baseUrl: values["embedder-url"],
							model: values["embedder-model"],
						});
						const embedCacheDir =
							values["embedder-cache-dir"] ?? process.env.WTFOC_EMBEDDER_CACHE_DIR;
						const embedder = embedCacheDir
							? new CachingEmbedder(rawEmbedder, {
									cacheDir: embedCacheDir,
									provider: "openai-compatible",
									modelVersion: "unknown",
								})
							: rawEmbedder;
						const vectorIndex = new InMemoryVectorIndex();
						// Populate vector index from segment chunks — must include full metadata
						// so query()/trace() can read sourceType, source, content from results
						for (const seg of segments) {
							const entries = seg.chunks
								.filter((c: { embedding?: number[] }) => c.embedding && c.embedding.length > 0)
								.map((c: { id: string; storageId: string; content: string; sourceType: string; source: string; sourceUrl?: string; embedding: number[]; metadata?: Record<string, string>; signalScores?: Record<string, number> }) => ({
									id: c.id,
									vector: new Float32Array(c.embedding),
									storageId: c.storageId || c.id,
									metadata: {
										sourceType: c.sourceType,
										source: c.source,
										sourceUrl: c.sourceUrl ?? "",
										content: c.content,
										...(c.metadata ?? {}),
										...(c.signalScores && Object.keys(c.signalScores).length > 0
											? { signalScores: JSON.stringify(c.signalScores) }
											: {}),
									},
								}));
							if (entries.length > 0) {
								await vectorIndex.add(entries);
							}
						}
						// Load overlay edges for search — same pattern as resolution stage
					const searchManifestDir =
						(store.manifests as { dir?: string }).dir ??
						`${process.env.HOME ?? "."}.wtfoc/projects`;
					const searchOverlayEdges = await loadAllOverlayEdges(searchManifestDir, values.collection!);
					result = await evaluateSearch(
						embedder,
						vectorIndex,
						segments,
						undefined,
						searchOverlayEdges,
						values["auto-route"] ?? false,
					);
					}
					break;
				}

				case "quality-queries": {
					if (!values["embedder-url"] || !values["embedder-model"]) {
						result = {
							stage: STAGE_ID[stage],
							startedAt: new Date().toISOString(),
							durationMs: 0,
							verdict: "pass",
							summary: "skipped: no embedder configured (requires --embedder-url and --embedder-model)",
							metrics: {},
							checks: [],
						};
					} else {
						const collectionId = values.collection;
						if (!collectionId) {
							throw new Error("--collection is required for the quality-queries stage");
						}
						const qqManifestDir =
							(store.manifests as { dir?: string }).dir ??
							`${process.env.HOME ?? "."}.wtfoc/projects`;
						const retrievalOverrides: {
							topK?: number;
							traceMaxPerSource?: number;
							traceMaxTotal?: number;
							traceMinScore?: number;
						} = {};
						if (values["top-k"] !== undefined) retrievalOverrides.topK = Number.parseInt(values["top-k"], 10);
						if (values["trace-max-per-source"] !== undefined)
							retrievalOverrides.traceMaxPerSource = Number.parseInt(values["trace-max-per-source"], 10);
						if (values["trace-max-total"] !== undefined)
							retrievalOverrides.traceMaxTotal = Number.parseInt(values["trace-max-total"], 10);
						if (values["trace-min-score"] !== undefined)
							retrievalOverrides.traceMinScore = Number.parseFloat(values["trace-min-score"]);

						const ctx = await buildRetrievalContext({
							collectionId,
							manifestDir: qqManifestDir,
							manifest: head.manifest,
							segments,
							runConfigFingerprint,
							embedderUrl: values["embedder-url"],
							embedderModel: values["embedder-model"],
							embedderApiKey:
								values["embedder-key"] ||
								process.env.WTFOC_EMBEDDER_KEY ||
								values["extractor-key"],
							embedderCacheDir:
								values["embedder-cache-dir"] ?? process.env.WTFOC_EMBEDDER_CACHE_DIR,
							retrievalOverrides,
							timer,
							embedderUsageSink,
						});

						const cacheBaseDir =
							values["cache-base"] ?? process.env.WTFOC_DOGFOOD_CACHE_DIR;
						const cachePath = cacheBaseDir
							? {
									cacheBase: cacheBaseDir,
									sweepId: values["sweep-id"] ?? "default",
									variantId: values["variant-id"] ?? "default",
								}
							: null;
						const rerankerIdentity = values["reranker-type"] && values["reranker-url"]
							? {
									type: values["reranker-type"],
									url: values["reranker-url"],
									...(values["reranker-model"]
										? { model: values["reranker-model"] }
										: {}),
								}
							: null;
						const manifestId = head.manifest.currentRevisionId ?? collectionId;
						const segmentIds = head.manifest.segments.map((s) => s.id);

						if (phase === "all") {
							result = await runQualityQueriesPipeline(ctx, {
								reranker,
								autoRoute: values["auto-route"] ?? false,
								diversityEnforce: values["diversity-enforce"] ?? false,
								checkParaphrases: process.env.WTFOC_CHECK_PARAPHRASES === "1",
								timer,
								costs,
								groundingEnabled,
								graderConfig,
								synthesizerConfig,
							});
						} else if (phase === "embed") {
							if (!cachePath) throw new Error("phase=embed requires cache path");
							const embedderUrl = values["embedder-url"];
							const embedderModel = values["embedder-model"];
							if (!embedderUrl || !embedderModel) {
								throw new Error(
									"phase=embed requires --embedder-url and --embedder-model",
								);
							}
							await runEmbedPhase(ctx, cachePath, {
								runConfigFingerprint,
								embedderUrl,
								embedderModel,
								embedderCacheDir:
									values["embedder-cache-dir"] ??
									process.env.WTFOC_EMBEDDER_CACHE_DIR ??
									null,
							});
							result = {
								stage: STAGE_ID[stage],
								startedAt: new Date().toISOString(),
								durationMs: 0,
								verdict: "pass",
								summary: "phase=embed: query embeddings warmed",
								metrics: {},
								checks: [],
							};
						} else if (phase === "search") {
							if (!cachePath) throw new Error("phase=search requires cache path");
							const { stageResult } = await runSearchPhase(ctx, cachePath, {
								reranker,
								autoRoute: values["auto-route"] ?? false,
								diversityEnforce: values["diversity-enforce"] ?? false,
								checkParaphrases: process.env.WTFOC_CHECK_PARAPHRASES === "1",
								timer,
								costs,
								manifestId,
								segmentIds,
								rerankerIdentity,
								documentCatalogId: ctx.documentCatalog ? "present" : null,
								runConfigFingerprint,
							});
							result = stageResult;
						} else {
							// phase === "score"
							if (!cachePath) throw new Error("phase=score requires cache path");
							const searchCache = loadSearchPhaseCache(
								cachePath,
								collectionId,
								runConfigFingerprint,
							);
							if (!searchCache) {
								throw new Error(
									`phase=score: no search-phase cache at ${cachePath.cacheBase} for sweep=${cachePath.sweepId} variant=${cachePath.variantId} corpus=${collectionId} fingerprint=${runConfigFingerprint.slice(0, 12)}`,
								);
							}
							result = await runScorePhase(ctx, searchCache, {
								reranker,
								timer,
								costs,
								groundingEnabled,
								graderConfig,
								synthesizerConfig,
							});
						}
					}
					break;
				}

				default:
					throw new Error(`Unknown stage: ${stage}`);
			}

			stageResults.push(result);
		} catch (err) {
			stageResults.push({
				stage: STAGE_ID[stage],
				startedAt: new Date().toISOString(),
				durationMs: 0,
				verdict: "fail",
				summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
				metrics: {},
				checks: [],
			});
		}
	}

	const report: ExtendedDogfoodReport = {
		reportSchemaVersion: "1.0.0",
		timestamp: new Date().toISOString(),
		collectionId: head.manifest.collectionId,
		collectionName: head.manifest.name,
		stages: stageResults,
		verdict: aggregateVerdict(stageResults),
		durationMs: Math.round(performance.now() - t0),
		runConfig,
		runConfigFingerprint,
		fingerprintVersion: FINGERPRINT_VERSION,
		costComparable: costs.comparability(),
	};

	// Output
	if (values.json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(formatDogfoodReport(report));
	}

	// Write to file if requested
	if (values.output) {
		const outputPath = values.output;
		let filePath: string;

		const ts = report.timestamp.replace(/[:.]/g, "-");
		const defaultFilename = `dogfood-${report.collectionName}-${ts}.json`;

		try {
			const stat = statSync(outputPath);
			if (stat.isDirectory()) {
				filePath = join(outputPath, defaultFilename);
			} else {
				filePath = outputPath;
			}
		} catch {
			// Path doesn't exist — if it ends with / or has no extension, treat as directory
			if (outputPath.endsWith("/") || outputPath.endsWith("\\")) {
				mkdirSync(outputPath, { recursive: true });
				filePath = join(outputPath, defaultFilename);
			} else {
				filePath = outputPath;
			}
		}

		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, JSON.stringify(report, null, 2));
		console.error(`Report written to: ${filePath}`);
	}

	// Exit code
	const hasFailed = stageResults.some((s) => s.verdict === "fail");
	process.exit(hasFailed ? 1 : 0);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
