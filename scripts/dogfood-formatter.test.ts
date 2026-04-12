import { describe, expect, it } from "vitest";
import type { DogfoodReport, EvalStageResult } from "@wtfoc/common";
import { formatDogfoodReport } from "./dogfood-formatter.js";

function makeStage(
	stage: string,
	verdict: "pass" | "warn" | "fail",
	summary = "",
): EvalStageResult {
	return {
		stage,
		startedAt: "2026-04-12T00:00:00Z",
		durationMs: 100,
		verdict,
		summary,
		metrics: {},
		checks: [],
	};
}

function makeReport(
	overrides: Partial<DogfoodReport> = {},
): DogfoodReport {
	return {
		reportSchemaVersion: "1.0.0",
		timestamp: "2026-04-12T00:00:00Z",
		collectionId: "test-id",
		collectionName: "myrepo",
		stages: [makeStage("ingest", "pass")],
		verdict: "pass",
		durationMs: 500,
		...overrides,
	};
}

describe("formatDogfoodReport", () => {
	it("output includes collection name and aggregate verdict", () => {
		const output = formatDogfoodReport(makeReport());
		expect(output).toContain("myrepo");
		expect(output).toContain("PASS");
	});

	it("skipped stage is labelled 'skipped'", () => {
		const report = makeReport({
			stages: [
				makeStage("edge-extraction", "pass", "skipped: no extractor configured"),
			],
		});
		const output = formatDogfoodReport(report);
		expect(output).toContain("skipped");
	});

	it("failed stage is highlighted", () => {
		const report = makeReport({
			stages: [makeStage("storage", "fail")],
			verdict: "fail",
		});
		const output = formatDogfoodReport(report);
		expect(output).toContain("FAIL");
	});
});
