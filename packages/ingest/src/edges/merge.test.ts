import type { Edge } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { edgeKey, mergeEdges } from "./merge.js";

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

describe("edgeKey", () => {
	it("produces a JSON-encoded canonical key", () => {
		const key = edgeKey(makeEdge());
		expect(key).toBe(JSON.stringify(["references", "chunk-1", "issue", "owner/repo#42"]));
	});

	it("different edges produce different keys", () => {
		const a = edgeKey(makeEdge({ targetId: "owner/repo#42" }));
		const b = edgeKey(makeEdge({ targetId: "owner/repo#99" }));
		expect(a).not.toBe(b);
	});

	it("handles fields containing pipe characters without collision", () => {
		const a = edgeKey(makeEdge({ targetId: "a|b" }));
		const b = edgeKey(makeEdge({ targetId: "a", targetType: "b" }));
		expect(a).not.toBe(b);
	});
});

describe("mergeEdges", () => {
	it("passes through single-extractor edges unchanged", () => {
		const edges = [makeEdge(), makeEdge({ targetId: "owner/repo#99" })];
		const result = mergeEdges([{ extractorName: "regex", edges }]);
		expect(result).toHaveLength(2);
		expect(result[0]?.provenance).toEqual(["regex"]);
	});

	it("deduplicates same edge from multiple extractors", () => {
		const edge = makeEdge();
		const result = mergeEdges([
			{ extractorName: "regex", edges: [{ ...edge, evidence: "regex found #42" }] },
			{ extractorName: "heuristic", edges: [{ ...edge, evidence: "heuristic found #42" }] },
		]);
		expect(result).toHaveLength(1);
		expect(result[0]?.provenance).toEqual(expect.arrayContaining(["regex", "heuristic"]));
	});

	it("merges evidence from multiple extractors", () => {
		const edge = makeEdge();
		const result = mergeEdges([
			{ extractorName: "regex", edges: [{ ...edge, evidence: "evidence-A" }] },
			{ extractorName: "llm", edges: [{ ...edge, evidence: "evidence-B" }] },
		]);
		expect(result[0]?.evidence).toBe("evidence-A | evidence-B");
	});

	it("does not duplicate identical evidence strings", () => {
		const edge = makeEdge({ evidence: "same evidence" });
		const result = mergeEdges([
			{ extractorName: "regex", edges: [edge] },
			{ extractorName: "heuristic", edges: [edge] },
		]);
		expect(result[0]?.evidence).toBe("same evidence");
	});

	it("applies confidence boost for multi-extractor agreement", () => {
		const edge = makeEdge({ confidence: 0.8 });
		const result = mergeEdges([
			{ extractorName: "regex", edges: [edge] },
			{ extractorName: "heuristic", edges: [edge] },
		]);
		expect(result[0]?.confidence).toBeCloseTo(0.85);
	});

	it("caps confidence at 1.0", () => {
		const edge = makeEdge({ confidence: 1.0 });
		const result = mergeEdges([
			{ extractorName: "a", edges: [edge] },
			{ extractorName: "b", edges: [edge] },
			{ extractorName: "c", edges: [edge] },
		]);
		expect(result[0]?.confidence).toBe(1.0);
	});

	it("keeps highest individual confidence as base", () => {
		const result = mergeEdges([
			{ extractorName: "regex", edges: [makeEdge({ confidence: 1.0 })] },
			{ extractorName: "llm", edges: [makeEdge({ confidence: 0.5 })] },
		]);
		expect(result[0]?.confidence).toBeCloseTo(1.0); // 1.0 + 0.05 capped at 1.0
	});

	it("handles N-way convergence (3+ extractors)", () => {
		const edge = makeEdge({ confidence: 0.7 });
		const result = mergeEdges([
			{ extractorName: "a", edges: [edge] },
			{ extractorName: "b", edges: [edge] },
			{ extractorName: "c", edges: [edge] },
			{ extractorName: "d", edges: [edge] },
		]);
		// 0.7 + (3 * 0.05) = 0.85
		expect(result[0]?.confidence).toBeCloseTo(0.85);
		expect(result[0]?.provenance).toHaveLength(4);
	});

	it("returns empty array for empty input", () => {
		expect(mergeEdges([])).toEqual([]);
	});

	it("returns empty array for extractors with no edges", () => {
		expect(mergeEdges([{ extractorName: "a", edges: [] }])).toEqual([]);
	});
});
