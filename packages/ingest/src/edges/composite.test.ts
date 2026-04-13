/**
 * Ownership: CompositeEdgeExtractor orchestration tests.
 * Tests: registration, disabled extractors, fail-open, abort, signal propagation, edge cap, merge delegation.
 * Delegates to: merge.test.ts for merge algorithm assertions (dedup, confidence boost, evidence concatenation).
 */
import type { Edge, EdgeExtractor } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { makeChunk, makeEdge } from "./__test-helpers.js";
import { CompositeEdgeExtractor } from "./composite.js";

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

	it("delegates merge to mergeEdges when multiple extractors return the same edge", async () => {
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
		// Verify merge was invoked (dedup occurred) — merge algorithm details tested in merge.test.ts
		expect(result).toHaveLength(1);
		expect(result[0]?.provenance).toBeDefined();
		expect(result[0]?.provenance?.length).toBeGreaterThanOrEqual(2);
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
