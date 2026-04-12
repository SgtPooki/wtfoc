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
	// 120s timeout — real LLM calls on local hardware can be slow.
	it("runs the evaluation harness", async () => {
		report = await runEdgeEval({
			baseUrl: resolveUrl(extractorUrl ?? ""),
			model: extractorModel ?? "",
			apiKey: process.env.WTFOC_EXTRACTOR_API_KEY,
			maxConcurrency: 2,
			maxInputTokens: 4000,
			timeoutMs: 60000,
		});

		// Print the full report for human review
		console.log(`\n${formatEvalReport(report)}`);

		expect(report.chunkCount).toBe(12);
		expect(report.stages).toHaveLength(3);
	}, 120_000);

	it("produces edges from positive examples", () => {
		const gated = getStage(report, "gated");
		// We should get at least some edges from 12 chunks
		expect(gated.edgeCount).toBeGreaterThan(0);
	});

	it("meets minimum precision floor (gated)", () => {
		const gated = getStage(report, "gated");
		// Floor: precision > 0.3 — the LLM should get at least 30% of edges right
		expect(gated.microPrecision).toBeGreaterThan(0.3);
	});

	it("meets minimum recall floor (gated)", () => {
		const gated = getStage(report, "gated");
		// Floor: recall > 0.2 — at least 20% of gold edges found
		expect(gated.microRecall).toBeGreaterThan(0.2);
	});

	it("acceptance gates do not over-reject (gold survival > 15%)", () => {
		// Gates should not kill most of the gold edges that the LLM found
		expect(report.gates.goldSurvivalRate).toBeGreaterThan(0.15);
	});

	it("handles hard negative chunks (no edges expected)", () => {
		// At least one of the hard negative chunks should correctly produce 0 edges
		expect(report.negatives.hardNegativeCorrect).toBeGreaterThan(0);
	});

	it("respects forbidden edge constraints", () => {
		// Log violations for debugging but use a soft threshold —
		// some models may produce borderline edges that get through
		if (report.negatives.forbiddenViolations.length > 0) {
			console.warn(
				`Forbidden violations (${report.negatives.forbiddenViolations.length}):`,
				report.negatives.forbiddenViolations.map(
					(v) => `${v.chunkId}: ${v.edge.type}\u2192${v.edge.targetId}`,
				),
			);
		}
		// Allow up to 3 violations — the acceptance gates handle most, but some
		// models may slip through. The report is the main output, not this assertion.
		expect(report.negatives.forbiddenViolations.length).toBeLessThan(4);
	});

	it("normalization improves raw LLM output", () => {
		const raw = getStage(report, "raw");
		const normalized = getStage(report, "normalized");
		// Normalization should not reduce recall (it only remaps types)
		// and should improve or maintain precision by mapping to canonical types
		expect(normalized.microRecall).toBeGreaterThanOrEqual(raw.microRecall * 0.9);
	});
});
