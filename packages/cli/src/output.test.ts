import type { TraceResult } from "@wtfoc/search";
import { describe, expect, it } from "vitest";
import {
	formatTrace,
	formatTraceEvidence,
	formatTraceLineage,
	formatTraceTimeline,
} from "./output.js";

function makeResult(overrides?: Partial<TraceResult>): TraceResult {
	return {
		query: "test query",
		groups: {},
		hops: [],
		lineageChains: [],
		insights: [],
		stats: { totalHops: 0, edgeHops: 0, semanticHops: 0, sourceTypes: [], insightCount: 0 },
		...overrides,
	};
}

describe("formatTrace dispatcher", () => {
	it("returns JSON for json format regardless of view", () => {
		const result = makeResult({
			hops: [
				{
					content: "test",
					sourceType: "code",
					source: "src/a.ts",
					storageId: "s1",
					connection: { method: "semantic", confidence: 0.9 },
				},
			],
		});
		const json = formatTrace(result, "json", "lineage");
		expect(() => JSON.parse(json)).not.toThrow();
		expect(JSON.parse(json).query).toBe("test query");
	});

	it("returns empty string for quiet format", () => {
		expect(formatTrace(makeResult(), "quiet", "lineage")).toBe("");
	});

	it("dispatches to evidence view by default", () => {
		const output = formatTrace(makeResult(), "human");
		expect(output).toContain("Trace:");
	});
});

describe("formatTraceEvidence", () => {
	it("renders grouped-by-sourceType output", () => {
		const result = makeResult({
			groups: {
				"github-issue": [
					{
						content: "issue text",
						sourceType: "github-issue",
						source: "org/repo#1",
						storageId: "s1",
						connection: {
							method: "edge",
							edgeType: "references",
							evidence: "ref #1",
							confidence: 1.0,
						},
					},
				],
			},
			stats: {
				totalHops: 1,
				edgeHops: 1,
				semanticHops: 0,
				sourceTypes: ["github-issue"],
				insightCount: 0,
			},
		});
		const output = formatTraceEvidence(result);
		expect(output).toContain("github-issue");
		expect(output).toContain("org/repo#1");
		expect(output).toContain("references");
		expect(output).toContain("1 results");
	});

	it("handles empty result gracefully", () => {
		const output = formatTraceEvidence(makeResult());
		expect(output).toContain("0 results");
	});
});

describe("formatTraceLineage", () => {
	it("renders chains with type sequence headers", () => {
		const result = makeResult({
			hops: [
				{
					content: "slack msg",
					sourceType: "slack-message",
					source: "#foc",
					storageId: "s1",
					connection: { method: "semantic", confidence: 0.9 },
				},
				{
					content: "issue text",
					sourceType: "github-issue",
					source: "org/repo#1",
					storageId: "s2",
					parentHopIndex: 0,
					connection: { method: "edge", edgeType: "references", evidence: "ref", confidence: 1.0 },
				},
			],
			lineageChains: [
				{
					hopIndices: [0, 1],
					typeSequence: ["slack-message", "github-issue"],
					sourceTypeDiversity: 2,
				},
			],
		});
		const output = formatTraceLineage(result);
		expect(output).toContain("Chain 1");
		expect(output).toContain("slack-message");
		expect(output).toContain("github-issue");
		expect(output).toContain("#foc");
	});

	it("shows Related Context for orphan hops", () => {
		const result = makeResult({
			hops: [
				{
					content: "orphan",
					sourceType: "code",
					source: "src/a.ts",
					storageId: "s1",
					connection: { method: "semantic", confidence: 0.7 },
				},
			],
			lineageChains: [],
		});
		const output = formatTraceLineage(result);
		expect(output).toContain("Related Context");
		expect(output).toContain("src/a.ts");
	});

	it("handles zero hops gracefully", () => {
		const output = formatTraceLineage(makeResult());
		expect(output).toContain("No results found");
	});
});

describe("formatTraceTimeline", () => {
	it("groups hops by UTC date", () => {
		const result = makeResult({
			hops: [
				{
					content: "hop1",
					sourceType: "slack-message",
					source: "#ch",
					storageId: "s1",
					timestamp: "2026-04-10T14:00:00Z",
					connection: { method: "semantic", confidence: 0.9 },
				},
				{
					content: "hop2",
					sourceType: "github-issue",
					source: "org/repo#1",
					storageId: "s2",
					timestamp: "2026-04-11T10:00:00Z",
					connection: { method: "edge", edgeType: "references", confidence: 1.0 },
				},
			],
		});
		const output = formatTraceTimeline(result);
		expect(output).toContain("2026-04-10");
		expect(output).toContain("2026-04-11");
	});

	it("puts undated hops at the end", () => {
		const result = makeResult({
			hops: [
				{
					content: "dated",
					sourceType: "code",
					source: "a.ts",
					storageId: "s1",
					timestamp: "2026-04-10T12:00:00Z",
					connection: { method: "semantic", confidence: 0.8 },
				},
				{
					content: "undated",
					sourceType: "code",
					source: "b.ts",
					storageId: "s2",
					connection: { method: "semantic", confidence: 0.7 },
				},
			],
		});
		const output = formatTraceTimeline(result);
		const datedIdx = output.indexOf("2026-04-10");
		const undatedIdx = output.indexOf("(no timestamp)");
		expect(datedIdx).toBeLessThan(undatedIdx);
	});

	it("handles all undated hops", () => {
		const result = makeResult({
			hops: [
				{
					content: "hop1",
					sourceType: "code",
					source: "a.ts",
					storageId: "s1",
					connection: { method: "semantic", confidence: 0.8 },
				},
			],
		});
		const output = formatTraceTimeline(result);
		expect(output).toContain("(no timestamp)");
	});

	it("handles malformed timestamps without crash", () => {
		const result = makeResult({
			hops: [
				{
					content: "hop1",
					sourceType: "code",
					source: "a.ts",
					storageId: "s1",
					timestamp: "not-a-date",
					connection: { method: "semantic", confidence: 0.8 },
				},
			],
		});
		const output = formatTraceTimeline(result);
		expect(output).toContain("(no timestamp)");
	});

	it("handles zero hops gracefully", () => {
		const output = formatTraceTimeline(makeResult());
		expect(output).toContain("No results found");
	});
});
