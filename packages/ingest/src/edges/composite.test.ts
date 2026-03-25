import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { CompositeEdgeExtractor } from "./composite.js";

function makeChunk(id = "chunk-1"): Chunk {
	return {
		id,
		content: "Fixes #42 in the codebase",
		sourceType: "github-pr",
		source: "owner/repo#10",
		metadata: {},
	};
}

function makeEdge(overrides: Partial<Edge> = {}): Edge {
	return {
		type: "references",
		sourceId: "chunk-1",
		targetType: "issue",
		targetId: "owner/repo#42",
		evidence: "found #42",
		confidence: 1.0,
		...overrides,
	};
}

function mockExtractor(edges: Edge[]): EdgeExtractor {
	return { extract: vi.fn(async () => edges) };
}

function failingExtractor(error: Error): EdgeExtractor {
	return {
		extract: vi.fn(async () => {
			throw error;
		}),
	};
}

describe("CompositeEdgeExtractor", () => {
	it("returns empty array with no registered extractors", async () => {
		const composite = new CompositeEdgeExtractor();
		const result = await composite.extract([makeChunk()]);
		expect(result).toEqual([]);
	});

	it("passes through a single extractor's edges", async () => {
		const composite = new CompositeEdgeExtractor();
		const edges = [makeEdge(), makeEdge({ targetId: "owner/repo#99" })];
		composite.register({ name: "regex", extractor: mockExtractor(edges) });

		const result = await composite.extract([makeChunk()]);
		expect(result).toHaveLength(2);
		expect(result[0]?.provenance).toEqual(["regex"]);
	});

	it("merges and deduplicates edges from multiple extractors", async () => {
		const composite = new CompositeEdgeExtractor();
		const edge = makeEdge();
		composite.register({
			name: "regex",
			extractor: mockExtractor([{ ...edge, evidence: "regex evidence" }]),
		});
		composite.register({
			name: "heuristic",
			extractor: mockExtractor([{ ...edge, evidence: "heuristic evidence" }]),
		});

		const result = await composite.extract([makeChunk()]);
		expect(result).toHaveLength(1);
		expect(result[0]?.evidence).toContain("regex evidence");
		expect(result[0]?.evidence).toContain("heuristic evidence");
		expect(result[0]?.provenance).toEqual(expect.arrayContaining(["regex", "heuristic"]));
	});

	it("skips disabled extractors", async () => {
		const composite = new CompositeEdgeExtractor();
		const enabledMock = mockExtractor([makeEdge()]);
		const disabledMock = mockExtractor([makeEdge({ targetId: "should-not-appear" })]);

		composite.register({ name: "enabled", extractor: enabledMock });
		composite.register({ name: "disabled", extractor: disabledMock, enabled: false });

		const result = await composite.extract([makeChunk()]);
		expect(result).toHaveLength(1);
		expect(disabledMock.extract).not.toHaveBeenCalled();
	});

	it("continues when a non-abort extractor fails (fail-open)", async () => {
		const composite = new CompositeEdgeExtractor();
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		composite.register({ name: "good", extractor: mockExtractor([makeEdge()]) });
		composite.register({ name: "bad", extractor: failingExtractor(new Error("oops")) });

		const result = await composite.extract([makeChunk()]);
		expect(result).toHaveLength(1);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('"bad" failed'),
			expect.any(Error),
		);

		consoleSpy.mockRestore();
	});

	it("respects AbortSignal", async () => {
		const composite = new CompositeEdgeExtractor();
		composite.register({ name: "slow", extractor: mockExtractor([makeEdge()]) });

		const controller = new AbortController();
		controller.abort();

		await expect(composite.extract([makeChunk()], controller.signal)).rejects.toThrow();
	});

	it("passes signal to sub-extractors", async () => {
		const composite = new CompositeEdgeExtractor();
		const extractor = mockExtractor([]);
		composite.register({ name: "test", extractor });

		const controller = new AbortController();
		await composite.extract([makeChunk()], controller.signal);

		expect(extractor.extract).toHaveBeenCalledWith(expect.any(Array), controller.signal);
	});

	it("caps total edges to prevent memory exhaustion", async () => {
		const composite = new CompositeEdgeExtractor();
		// Create extractor that returns 200 edges for 1 chunk (exceeds 100 per chunk cap)
		const manyEdges = Array.from({ length: 200 }, (_, i) => makeEdge({ targetId: `target-${i}` }));
		composite.register({ name: "spam", extractor: mockExtractor(manyEdges) });

		const result = await composite.extract([makeChunk()]);
		expect(result.length).toBeLessThanOrEqual(100);
	});
});
