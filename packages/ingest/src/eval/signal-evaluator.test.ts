import type { Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { evaluateSignals } from "./signal-evaluator.js";

function makeSegment(chunks: Array<{ id: string; content: string; sourceType: string }>): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 384,
		chunks: chunks.map((c) => ({
			...c,
			storageId: c.id,
			source: "test",
			sourceUrl: "",
			timestamp: "",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
			embedding: [],
			terms: [],
		})),
		edges: [],
	};
}

describe("evaluateSignals", () => {
	it("reports correct signal distribution", async () => {
		const segments = [
			makeSegment([
				{ id: "c1", content: "This is broken and doesn't work at all", sourceType: "github-issue" },
				{ id: "c2", content: "I love this, works great, thank you!", sourceType: "slack-message" },
			]),
		];

		const result = await evaluateSignals(segments);
		const counts = result.metrics.signalCounts as Record<string, number>;
		expect(counts.pain).toBeGreaterThan(0);
		expect(counts.praise).toBeGreaterThan(0);
	});

	it("coverage rate computed correctly", async () => {
		const segments = [
			makeSegment([
				{ id: "c1", content: "This bug is broken", sourceType: "github-issue" }, // has signal
				{ id: "c2", content: "Works great!", sourceType: "slack-message" }, // has signal
				{ id: "c3", content: "const x = 42;", sourceType: "code" }, // no signal
				{ id: "c4", content: "function hello() {}", sourceType: "code" }, // no signal
			]),
		];

		const result = await evaluateSignals(segments);
		expect(result.metrics.signalCoverage).toBe(0.5);
	});

	it("per-source-type breakdown populated", async () => {
		const segments = [
			makeSegment([
				{ id: "c1", content: "This is broken", sourceType: "github-issue" },
				{ id: "c2", content: "I love this", sourceType: "slack-message" },
			]),
		];

		const result = await evaluateSignals(segments);
		const perSource = result.metrics.perSourceType as Record<string, Record<string, number>>;
		expect(perSource["github-issue"]?.pain).toBeGreaterThan(0);
		expect(perSource["slack-message"]?.praise).toBeGreaterThan(0);
	});

	it("empty segments handled gracefully", async () => {
		const result = await evaluateSignals([]);
		expect(result.verdict).toBe("pass");
		expect(result.metrics.totalChunks).toBe(0);
	});
});
