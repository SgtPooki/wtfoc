import { describe, expect, it, vi } from "vitest";
import type { EvalReport, StageMetrics } from "../edges/eval.js";

const mockRunEdgeEval = vi.hoisted(() => vi.fn<() => Promise<EvalReport>>());

vi.mock("../edges/eval.js", () => ({
	runEdgeEval: mockRunEdgeEval,
}));

// Import after mock setup
const { evaluateEdgeExtraction } = await import("./edge-extraction-evaluator.js");

function makeStageMetrics(stage: string, microF1: number): StageMetrics {
	return {
		stage,
		edgeCount: 10,
		perType: [],
		microPrecision: microF1,
		microRecall: microF1,
		microF1,
		macroF1: microF1,
	};
}

function makeEvalReport(gatedF1: number): EvalReport {
	return {
		timestamp: "2026-04-12T00:00:00Z",
		goldSetVersion: "1.0",
		model: "test-model",
		baseUrl: "http://localhost:1234/v1",
		stages: [
			makeStageMetrics("raw", 0.8),
			makeStageMetrics("normalized", 0.7),
			makeStageMetrics("gated", gatedF1),
		],
		gates: {
			accepted: 8,
			rejected: 1,
			downgraded: 1,
			acceptanceRate: 0.8,
			downgradeRate: 0.125,
			rejectionRate: 0.1,
			goldSurvivalRate: 0.9,
		},
		coverage: {
			totalBatches: 3,
			succeededBatches: 3,
			failedBatches: 0,
			totalChunks: 12,
			evaluatedChunks: 12,
			skippedChunks: 0,
			skippedChunkIds: [],
		},
		negatives: {
			hardNegativeChunks: 4,
			hardNegativeCorrect: 3,
			forbiddenViolations: [],
		},
		chunkCount: 12,
		durationMs: 5000,
	};
}

describe("evaluateEdgeExtraction", () => {
	it("maps EvalReport metrics to EvalStageResult correctly", async () => {
		mockRunEdgeEval.mockResolvedValue(makeEvalReport(0.6));

		const result = await evaluateEdgeExtraction({
			baseUrl: "http://localhost:1234/v1",
			model: "test",
		});

		expect(result.stage).toBe("edge-extraction");
		expect(result.metrics.gatedF1).toBe(0.6);
		expect(result.metrics.goldSurvivalRate).toBe(0.9);
		expect(result.metrics.coverageRate).toBe(1);
	});

	it("verdict is 'fail' when gated F1 < 0.3", async () => {
		mockRunEdgeEval.mockResolvedValue(makeEvalReport(0.2));

		const result = await evaluateEdgeExtraction({
			baseUrl: "http://localhost:1234/v1",
			model: "test",
		});

		expect(result.verdict).toBe("fail");
	});

	it("verdict is 'warn' when gated F1 between 0.3 and 0.5", async () => {
		mockRunEdgeEval.mockResolvedValue(makeEvalReport(0.4));

		const result = await evaluateEdgeExtraction({
			baseUrl: "http://localhost:1234/v1",
			model: "test",
		});

		expect(result.verdict).toBe("warn");
	});

	it("verdict is 'pass' when gated F1 >= 0.5", async () => {
		mockRunEdgeEval.mockResolvedValue(makeEvalReport(0.7));

		const result = await evaluateEdgeExtraction({
			baseUrl: "http://localhost:1234/v1",
			model: "test",
		});

		expect(result.verdict).toBe("pass");
	});

	it("abort signal is forwarded to runEdgeEval", async () => {
		mockRunEdgeEval.mockResolvedValue(makeEvalReport(0.6));
		const controller = new AbortController();

		await evaluateEdgeExtraction(
			{ baseUrl: "http://localhost:1234/v1", model: "test" },
			controller.signal,
		);

		expect(mockRunEdgeEval).toHaveBeenCalledWith(
			expect.objectContaining({ baseUrl: "http://localhost:1234/v1" }),
			controller.signal,
		);
	});
});
