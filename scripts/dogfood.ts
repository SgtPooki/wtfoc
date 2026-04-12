#!/usr/bin/env tsx
/**
 * Developer-only dogfood evaluation script.
 * Run: pnpm dogfood --collection <name> [options]
 *
 * NOT a public CLI command — this is for wtfoc developers only.
 */

import { parseArgs } from "node:util";
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	type DogfoodReport,
	type EvalStageResult,
	aggregateVerdict,
} from "@wtfoc/common";
import { evaluateIngest, evaluateEdgeExtraction, evaluateSignals, readCatalog, catalogFilePath } from "@wtfoc/ingest";
import {
	evaluateEdgeResolution,
	evaluateThemes,
	evaluateSearch,
	OpenAIEmbedder,
	InMemoryVectorIndex,
} from "@wtfoc/search";
import { evaluateStorage, createStore } from "@wtfoc/store";
import { formatDogfoodReport } from "./dogfood-formatter.js";

const VALID_STAGES = [
	"ingest",
	"edges",
	"resolution",
	"storage",
	"themes",
	"signals",
	"search",
] as const;
type StageName = (typeof VALID_STAGES)[number];

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
	const segments = [];
	for (const segSummary of head.manifest.segments) {
		const raw = await store.storage.download(segSummary.id);
		const text =
			typeof raw === "string"
				? raw
				: new TextDecoder().decode(raw as Uint8Array);
		segments.push(JSON.parse(text));
	}

	const stageResults: EvalStageResult[] = [];

	for (const stage of stagesToRun) {
		if (skipLlm && (stage === "edges" || stage === "search" || stage === "themes")) {
			stageResults.push({
				stage,
				startedAt: new Date().toISOString(),
				durationMs: 0,
				verdict: "pass",
				summary: `skipped: --skip-llm flag set`,
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
							stage,
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

				case "resolution":
					result = await evaluateEdgeResolution(segments);
					break;

				case "storage": {
					// Load document catalog for AC-US6-04 orphan check
					const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
					const manifestDir = `${homeDir}/.wtfoc/projects`;
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
					result = await evaluateThemes(segments);
					break;

				case "signals":
					result = await evaluateSignals(segments);
					break;

				case "search": {
					if (!values["embedder-url"] || !values["embedder-model"]) {
						result = {
							stage,
							startedAt: new Date().toISOString(),
							durationMs: 0,
							verdict: "pass",
							summary: "skipped: no embedder configured (requires --embedder-url and --embedder-model)",
							metrics: {},
							checks: [],
						};
					} else {
						const embedder = new OpenAIEmbedder({
							apiKey: values["embedder-key"] || values["extractor-key"] || "no-key",
							baseUrl: values["embedder-url"],
							model: values["embedder-model"],
						});
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
						result = await evaluateSearch(embedder, vectorIndex, segments);
					}
					break;
				}

				default:
					throw new Error(`Unknown stage: ${stage}`);
			}

			stageResults.push(result);
		} catch (err) {
			stageResults.push({
				stage,
				startedAt: new Date().toISOString(),
				durationMs: 0,
				verdict: "fail",
				summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
				metrics: {},
				checks: [],
			});
		}
	}

	const report: DogfoodReport = {
		reportSchemaVersion: "1.0.0",
		timestamp: new Date().toISOString(),
		collectionId: head.manifest.collectionId,
		collectionName: head.manifest.name,
		stages: stageResults,
		verdict: aggregateVerdict(stageResults),
		durationMs: Math.round(performance.now() - t0),
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

		try {
			const stat = statSync(outputPath);
			if (stat.isDirectory()) {
				const ts = report.timestamp.replace(/[:.]/g, "-");
				filePath = join(outputPath, `dogfood-${report.collectionName}-${ts}.json`);
			} else {
				filePath = outputPath;
			}
		} catch {
			// Path doesn't exist — treat as file path
			filePath = outputPath;
		}

		mkdirSync(join(filePath, ".."), { recursive: true });
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
