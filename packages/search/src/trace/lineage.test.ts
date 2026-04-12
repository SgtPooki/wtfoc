import { describe, expect, it } from "vitest";
import { buildLineageChains } from "./lineage.js";
import type { TraceHop } from "./trace.js";

function makeHop(overrides: Partial<TraceHop> & { sourceType: string }): TraceHop {
	return {
		content: "test",
		source: "test-source",
		storageId: "test-storage",
		connection: { method: "edge", confidence: 1.0 },
		...overrides,
	};
}

describe("buildLineageChains", () => {
	it("returns empty array for empty hops", () => {
		expect(buildLineageChains([])).toEqual([]);
	});

	it("produces single-hop chains for seed-only hops (no parentHopIndex)", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "slack-message" }),
			makeHop({ sourceType: "github-issue" }),
		];
		const chains = buildLineageChains(hops);
		expect(chains).toHaveLength(2);
		expect(chains.at(0)?.hopIndices).toEqual([0]);
		expect(chains.at(1)?.hopIndices).toEqual([1]);
	});

	it("reconstructs a linear chain from parentHopIndex links", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "slack-message" }),
			makeHop({ sourceType: "github-issue", parentHopIndex: 0 }),
			makeHop({ sourceType: "github-pr", parentHopIndex: 1 }),
			makeHop({ sourceType: "code", parentHopIndex: 2 }),
		];
		const chains = buildLineageChains(hops);
		expect(chains).toHaveLength(1);
		expect(chains.at(0)?.hopIndices).toEqual([0, 1, 2, 3]);
		expect(chains.at(0)?.typeSequence).toEqual([
			"slack-message",
			"github-issue",
			"github-pr",
			"code",
		]);
		expect(chains.at(0)?.sourceTypeDiversity).toBe(4);
	});

	it("produces separate chains for branching DFS trees", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "slack-message" }), // 0: root
			makeHop({ sourceType: "github-issue", parentHopIndex: 0 }), // 1: child of 0
			makeHop({ sourceType: "github-pr", parentHopIndex: 1 }), // 2: child of 1 (branch A leaf)
			makeHop({ sourceType: "code", parentHopIndex: 1 }), // 3: child of 1 (branch B leaf)
		];
		const chains = buildLineageChains(hops);
		expect(chains).toHaveLength(2);
		const chainPaths = chains.map((c) => c.hopIndices);
		expect(chainPaths).toContainEqual([0, 1, 2]);
		expect(chainPaths).toContainEqual([0, 1, 3]);
	});

	it("deduplicates consecutive repeated sourceTypes in typeSequence", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "github-pr" }),
			makeHop({ sourceType: "github-pr", parentHopIndex: 0 }),
			makeHop({ sourceType: "code", parentHopIndex: 1 }),
		];
		const chains = buildLineageChains(hops);
		expect(chains).toHaveLength(1);
		expect(chains.at(0)?.typeSequence).toEqual(["github-pr", "code"]);
		expect(chains.at(0)?.sourceTypeDiversity).toBe(2);
	});

	it("sorts chains by length descending, then diversity descending", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "slack-message" }), // 0: root A
			makeHop({ sourceType: "github-issue", parentHopIndex: 0 }), // 1
			makeHop({ sourceType: "github-pr", parentHopIndex: 1 }), // 2 (chain A: length 3, diversity 3)
			makeHop({ sourceType: "code" }), // 3: root B (chain B: length 1, diversity 1)
		];
		const chains = buildLineageChains(hops);
		expect(chains.at(0)?.hopIndices).toEqual([0, 1, 2]);
		expect(chains.at(1)?.hopIndices).toEqual([3]);
	});

	it("handles unknown sourceTypes as-is", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "custom-adapter" }),
			makeHop({ sourceType: "custom-adapter-v2", parentHopIndex: 0 }),
		];
		const chains = buildLineageChains(hops);
		expect(chains.at(0)?.typeSequence).toEqual(["custom-adapter", "custom-adapter-v2"]);
	});
});
