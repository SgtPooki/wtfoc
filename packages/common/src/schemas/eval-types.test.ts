import { describe, expect, it } from "vitest";
import type { DogfoodReport, EvalCheck, EvalStageResult } from "./eval.js";
import { aggregateVerdict } from "./eval.js";

describe("eval types", () => {
	it("DogfoodReport round-trips through JSON", () => {
		const check: EvalCheck = {
			name: "required:id",
			passed: true,
			actual: 0,
			expected: 0,
			detail: "All chunks have id",
		};

		const stage: EvalStageResult = {
			stage: "ingest",
			startedAt: "2026-04-12T00:00:00.000Z",
			durationMs: 123,
			verdict: "pass",
			summary: "All checks passed",
			metrics: { totalChunks: 42 },
			checks: [check],
		};

		const report: DogfoodReport = {
			reportSchemaVersion: "1.0.0",
			timestamp: "2026-04-12T00:00:00.000Z",
			collectionId: "abc123",
			collectionName: "test-collection",
			stages: [stage],
			verdict: "pass",
			durationMs: 456,
		};

		const json = JSON.stringify(report);
		const parsed = JSON.parse(json) as DogfoodReport;

		expect(parsed.reportSchemaVersion).toBe("1.0.0");
		expect(parsed.collectionName).toBe("test-collection");
		expect(parsed.stages).toHaveLength(1);
		expect(parsed.stages[0].stage).toBe("ingest");
		expect(parsed.stages[0].checks[0].name).toBe("required:id");
		expect(parsed.verdict).toBe("pass");
	});

	describe("aggregateVerdict", () => {
		it("returns 'fail' if any stage failed", () => {
			const stages: EvalStageResult[] = [
				makeStage("ingest", "pass"),
				makeStage("edges", "fail"),
				makeStage("storage", "warn"),
			];
			expect(aggregateVerdict(stages)).toBe("fail");
		});

		it("returns 'warn' if any stage warned and none failed", () => {
			const stages: EvalStageResult[] = [
				makeStage("ingest", "pass"),
				makeStage("edges", "warn"),
				makeStage("storage", "pass"),
			];
			expect(aggregateVerdict(stages)).toBe("warn");
		});

		it("returns 'pass' when all stages pass", () => {
			const stages: EvalStageResult[] = [makeStage("ingest", "pass"), makeStage("edges", "pass")];
			expect(aggregateVerdict(stages)).toBe("pass");
		});

		it("returns 'pass' for empty stages array", () => {
			expect(aggregateVerdict([])).toBe("pass");
		});
	});
});

function makeStage(stage: string, verdict: "pass" | "warn" | "fail"): EvalStageResult {
	return {
		stage,
		startedAt: "2026-04-12T00:00:00.000Z",
		durationMs: 0,
		verdict,
		summary: "",
		metrics: {},
		checks: [],
	};
}
