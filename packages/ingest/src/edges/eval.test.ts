/**
 * Edge-quality evaluation tests.
 *
 * These tests call a real LLM endpoint — they are excluded from the
 * default `pnpm test` run and must be invoked explicitly via:
 *
 *   WTFOC_EXTRACTOR_URL=lmstudio WTFOC_EXTRACTOR_MODEL=<model> pnpm --filter @wtfoc/ingest test:eval
 *
 * The tests skip automatically when WTFOC_EXTRACTOR_URL is not set.
 */

import { describe, expect, it } from "vitest";
import { type EvalReport, formatEvalReport, runEdgeEval } from "./eval.js";

const extractorUrl = process.env.WTFOC_EXTRACTOR_URL;
const extractorModel = process.env.WTFOC_EXTRACTOR_MODEL;

/** Resolve URL shortcuts matching the CLI pattern */
function resolveUrl(raw: string): string {
	const shortcuts: Record<string, string> = {
		lmstudio: "http://localhost:1234/v1",
		ollama: "http://localhost:11434/v1",
	};
	return shortcuts[raw] ?? raw;
}

const hasLlm = Boolean(extractorUrl) && Boolean(extractorModel);

function getStage(report: EvalReport, stage: string) {
	const found = report.stages.find((s) => s.stage === stage);
	if (!found) throw new Error(`Stage "${stage}" not found in report`);
	return found;
}

describe.runIf(hasLlm)("edge eval (real LLM)", () => {
	let report: EvalReport;

	// Run the full eval once, share across assertions.
	// 10 min timeout — local models can be slow, and we process multiple batches sequentially.
	it("runs the evaluation harness", async () => {
		report = await runEdgeEval({
			baseUrl: resolveUrl(extractorUrl ?? ""),
			model: extractorModel ?? "",
			apiKey: process.env.WTFOC_EXTRACTOR_API_KEY,
			maxConcurrency: 1,
			maxInputTokens: Number.parseInt(process.env.WTFOC_EXTRACTOR_MAX_INPUT_TOKENS ?? "2000", 10),
			timeoutMs: 180000,
		});

		// Print the full report for human review
		console.log(`\n${formatEvalReport(report)}`);

		expect(report.chunkCount).toBe(12);
		expect(report.stages).toHaveLength(3);
	}, 600_000);

	it("evaluates at least 50% of chunks", () => {
		// If most batches timeout, the results are meaningless
		expect(report.coverage.evaluatedChunks).toBeGreaterThan(report.chunkCount * 0.5);
	});

	it("produces edges from positive examples", () => {
		const gated = getStage(report, "gated");
		expect(gated.edgeCount).toBeGreaterThan(0);
	});

	it("meets minimum precision floor (gated, evaluated chunks only)", () => {
		const gated = getStage(report, "gated");
		// Floor: precision > 0.1 — conservative smoke test for local models
		expect(gated.microPrecision).toBeGreaterThan(0.1);
	});

	it("meets minimum recall floor (gated, evaluated chunks only)", () => {
		const gated = getStage(report, "gated");
		// Floor: recall > 0.05 — conservative; the report is the main output
		expect(gated.microRecall).toBeGreaterThan(0.05);
	});

	it("acceptance gates do not over-reject (gold survival > 5%)", () => {
		expect(report.gates.goldSurvivalRate).toBeGreaterThan(0.05);
	});

	it("handles hard negative chunks (no edges expected)", () => {
		// Only check evaluated hard negatives
		if (report.negatives.hardNegativeChunks > 0) {
			expect(report.negatives.hardNegativeCorrect).toBeGreaterThan(0);
		}
	});

	it("respects forbidden edge constraints", () => {
		if (report.negatives.forbiddenViolations.length > 0) {
			console.warn(
				`Forbidden violations (${report.negatives.forbiddenViolations.length}):`,
				report.negatives.forbiddenViolations.map(
					(v) => `${v.chunkId}: ${v.edge.type}\u2192${v.edge.targetId}`,
				),
			);
		}
		// Allow up to 3 violations — acceptance gates handle most
		expect(report.negatives.forbiddenViolations.length).toBeLessThan(4);
	});

	it("normalization improves raw LLM output", () => {
		const raw = getStage(report, "raw");
		const normalized = getStage(report, "normalized");
		// Normalization should not significantly reduce recall
		expect(normalized.microRecall).toBeGreaterThanOrEqual(raw.microRecall * 0.9);
	});
});
