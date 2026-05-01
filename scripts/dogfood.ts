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
	evaluateQualityQueries,
	evaluateSearch,
	evaluateThemes,
	// #344 step-1 transition: grader consumes legacy view of new fixture.
	GOLD_STANDARD_QUERIES_LEGACY_VIEW as GOLD_STANDARD_QUERIES,
	GOLD_STANDARD_QUERIES_VERSION,
	InMemoryVectorIndex,
	LlmReranker,
	OpenAIEmbedder,
	type Reranker,
} from "@wtfoc/search";
import { evaluateStorage, createStore } from "@wtfoc/store";
import { formatDogfoodReport } from "./dogfood-formatter.js";
import { buildRunConfig, defaultQualityQueriesRetrieval } from "./lib/build-run-config.js";
import { namespacedCacheDir } from "./lib/cache-namespace.js";
import { CostAggregator } from "./lib/cost-aggregator.js";
import {
	GRADER_PROMPT_VERSION,
	GRADER_SYSTEM_PROMPT,
	SYNTHESIS_PROMPT_VERSION,
	SYNTHESIS_SYSTEM_PROMPT,
} from "./lib/grounding-prompts.js";
import { runGrounding } from "./lib/grounding-runner.js";
import type { LlmUsage } from "./lib/llm-usage.js";
import {
	computeRunConfigFingerprint,
	type ExtendedDogfoodReport,
	FINGERPRINT_VERSION,
} from "./lib/run-config.js";
import { sha256Hex } from "./lib/run-config.js";
import { SubstageTimer } from "./lib/substage-timer.js";
import { TimingVectorIndex } from "./lib/timing-vector-index.js";

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
	const promptHashes: Record<string, string> = groundingEnabled
		? {
				synthesis: `${SYNTHESIS_PROMPT_VERSION}:${sha256Hex(SYNTHESIS_SYSTEM_PROMPT)}`,
				grader: `${GRADER_PROMPT_VERSION}:${sha256Hex(GRADER_SYSTEM_PROMPT)}`,
			}
		: {};

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
						const rawEmbedder = new OpenAIEmbedder({
							apiKey: values["embedder-key"] || process.env.WTFOC_EMBEDDER_KEY || values["extractor-key"] || "no-key",
							baseUrl: values["embedder-url"],
							model: values["embedder-model"],
							usageSink: embedderUsageSink,
						});
						const embedCacheBaseDir =
							values["embedder-cache-dir"] ?? process.env.WTFOC_EMBEDDER_CACHE_DIR;
						const embedder = embedCacheBaseDir
							? new CachingEmbedder(rawEmbedder, {
									cacheDir: namespacedCacheDir(embedCacheBaseDir, runConfigFingerprint),
									provider: "openai-compatible",
									modelVersion: "unknown",
								})
							: rawEmbedder;
						const baseVectorIndex = new InMemoryVectorIndex();
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
								await baseVectorIndex.add(entries);
							}
						}
						const vectorIndex = new TimingVectorIndex(baseVectorIndex, (ms) =>
							timer.record("vector-retrieve", ms),
						);
						const qqManifestDir =
							(store.manifests as { dir?: string }).dir ??
							`${process.env.HOME ?? "."}.wtfoc/projects`;
						const qqOverlayEdges = await loadAllOverlayEdges(qqManifestDir, values.collection!);
						const corpusSourceTypes = new Set<string>();
						for (const segSummary of head.manifest.segments) {
							for (const st of segSummary.sourceTypes ?? []) corpusSourceTypes.add(st);
						}
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

						result = await evaluateQualityQueries(
						embedder,
						vectorIndex,
						segments,
						undefined,
						qqOverlayEdges,
						reranker,
						values["auto-route"] ?? false,
						{
							collectionId: values.collection!,
							corpusSourceTypes,
							perQueryHook: (id, ms) => timer.record("per-query-total", ms),
							checkParaphrases: process.env.WTFOC_CHECK_PARAPHRASES === "1",
							...(Object.keys(retrievalOverrides).length > 0
								? { retrievalOverrides }
								: {}),
						},
						values["diversity-enforce"] ?? false,
					);

					// Phase 0f — citation/grounding on the synthesis tier. Off
					// by default; opt-in via WTFOC_GROUND_CHECK=1 (single
					// pinned grader, no escalation, no rate-limit risk on
					// local vLLM). Synthesis prompts the extractor to emit
					// claims; grader (stronger model than extractor) verdicts
					// each claim against the same retrieved evidence.
					let grounding: Awaited<ReturnType<typeof runGrounding>> | null = null;
					if (groundingEnabled && graderConfig && synthesizerConfig) {
						const synthSink = (u: LlmUsage): void => {
							if (typeof u.durationMs === "number") timer.record("synthesize", u.durationMs);
							costs.record("synthesize", u);
						};
						const graderSink = (u: LlmUsage): void => {
							if (typeof u.durationMs === "number") timer.record("grade", u.durationMs);
							costs.record("grade", u);
						};
						const synthQueries = GOLD_STANDARD_QUERIES.filter(
							(q) =>
								q.category === "synthesis" &&
								(!q.collectionScopePattern ||
									new RegExp(q.collectionScopePattern).test(values.collection!)),
						).map((q) => ({ id: q.id, queryText: q.queryText }));
						console.error(
							`[dogfood] grounding: ${synthQueries.length} synthesis-tier queries (grader=${graderConfig.model})`,
						);
						grounding = await runGrounding({
							queries: synthQueries,
							synthesizer: synthesizerConfig,
							grader: graderConfig,
							embedder,
							vectorIndex,
							reranker,
							topK: 10,
							synthesizerUsageSink: synthSink,
							graderUsageSink: graderSink,
						});
					}

					// Attach timing + cost telemetry (and grounding when run)
					// to the stage's metrics payload — published
					// `EvalStageResult.metrics` is `Record<string, unknown>`
					// so this is additive.
					result.metrics = {
						...result.metrics,
						timing: timer.allStats(),
						cost: costs.allStats(),
						...(grounding ? { grounding } : {}),
					};
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
