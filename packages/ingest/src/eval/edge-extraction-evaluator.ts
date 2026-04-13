import type { EvalCheck, EvalStageResult } from "@wtfoc/common";
import { type EvalOptions, type EvalReport, runEdgeEval } from "../edges/eval.js";

/**
 * Wrap the existing edge eval harness (runEdgeEval) as a dogfood stage.
 * Maps EvalReport → EvalStageResult without modifying eval.ts.
 */
export async function evaluateEdgeExtraction(
	options: EvalOptions,
	signal?: AbortSignal,
): Promise<EvalStageResult> {
	const startedAt = new Date().toISOString();
	const t0 = performance.now();

	const report: EvalReport = await runEdgeEval(options, signal);

	const gatedStage = report.stages.find((s) => s.stage === "gated");
	const gatedF1 = gatedStage?.microF1 ?? 0;
	const coverageRate =
		report.coverage.totalChunks > 0
			? report.coverage.evaluatedChunks / report.coverage.totalChunks
			: 0;

	const checks: EvalCheck[] = report.stages.map((s) => ({
		name: `f1:${s.stage}`,
		passed: s.microF1 >= 0.3,
		actual: Math.round(s.microF1 * 1000) / 1000,
		expected: 0.3,
		detail: s.microF1 < 0.3 ? `${s.stage} F1 below threshold` : undefined,
	}));

	let verdict: "pass" | "warn" | "fail" = "pass";
	if (gatedF1 < 0.3) verdict = "fail";
	else if (gatedF1 < 0.5) verdict = "warn";

	const durationMs = Math.round(performance.now() - t0);

	return {
		stage: "edge-extraction",
		startedAt,
		durationMs,
		verdict,
		summary: `gated F1=${gatedF1.toFixed(2)}, gold survival=${report.gates.goldSurvivalRate.toFixed(2)}, coverage=${(coverageRate * 100).toFixed(0)}%`,
		metrics: {
			stages: report.stages,
			gates: report.gates,
			coverage: report.coverage,
			negatives: report.negatives,
			gatedF1,
			goldSurvivalRate: report.gates.goldSurvivalRate,
			coverageRate,
			model: report.model,
			tokenUsage: report.tokenUsage,
		},
		checks,
	};
}
