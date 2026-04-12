import { describe, expect, it } from "vitest";
import { buildConclusion } from "./conclusion.js";
import type { LineageChain } from "./lineage.js";
import type { TraceHop } from "./trace.js";

function makeHop(overrides: Partial<TraceHop> & { sourceType: string }): TraceHop {
	return {
		content: "test content",
		source: "test-source",
		storageId: "test-storage",
		connection: { method: "semantic", confidence: 0.9 },
		...overrides,
	};
}

describe("buildConclusion", () => {
	it("returns undefined for empty hops", () => {
		expect(buildConclusion([], [])).toBeUndefined();
	});

	it("sets primaryArtifact to the highest-confidence seed hop", () => {
		const hops: TraceHop[] = [
			makeHop({
				sourceType: "slack-message",
				connection: { method: "semantic", confidence: 0.85 },
			}),
			makeHop({ sourceType: "github-issue", connection: { method: "semantic", confidence: 0.95 } }),
		];
		const conclusion = buildConclusion(hops, []);
		expect(conclusion).toBeDefined();
		expect(conclusion?.primaryArtifact).toEqual({
			hopIndex: 1,
			summary: "github-issue: test-source",
		});
	});

	it("populates candidateFixes from edge-based hops with closes/addresses types", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "github-issue", connection: { method: "semantic", confidence: 0.9 } }),
			makeHop({
				sourceType: "github-pr",
				parentHopIndex: 0,
				connection: {
					method: "edge",
					edgeType: "closes",
					evidence: "Closes #142",
					confidence: 1.0,
				},
			}),
			makeHop({
				sourceType: "code",
				parentHopIndex: 0,
				connection: {
					method: "edge",
					edgeType: "addresses",
					evidence: "Addresses #142",
					confidence: 0.8,
				},
			}),
		];
		const conclusion = buildConclusion(hops, []);
		expect(conclusion?.candidateFixes).toHaveLength(2);
		expect(conclusion?.candidateFixes[0].hopIndex).toBe(1);
		expect(conclusion?.candidateFixes[1].hopIndex).toBe(2);
	});

	it("excludes semantic hops from candidateFixes even if they look like fixes", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "github-issue", connection: { method: "semantic", confidence: 0.9 } }),
			makeHop({
				sourceType: "github-pr",
				connection: { method: "semantic", confidence: 0.85 },
			}),
		];
		const conclusion = buildConclusion(hops, []);
		expect(conclusion?.candidateFixes).toHaveLength(0);
	});

	it("populates relatedContext from orphan hops not in chains", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "slack-message" }),
			makeHop({ sourceType: "github-issue", parentHopIndex: 0 }),
			makeHop({ sourceType: "code" }), // orphan - not in any chain
		];
		const chains: LineageChain[] = [
			{
				hopIndices: [0, 1],
				typeSequence: ["slack-message", "github-issue"],
				sourceTypeDiversity: 2,
			},
		];
		const conclusion = buildConclusion(hops, chains);
		expect(conclusion?.relatedContext).toHaveLength(1);
		expect(conclusion?.relatedContext[0].hopIndex).toBe(2);
	});

	it("populates recommendedNextReads from chain leaf hops", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "slack-message" }),
			makeHop({ sourceType: "github-issue", parentHopIndex: 0 }),
			makeHop({ sourceType: "github-pr", parentHopIndex: 1 }),
		];
		const chains: LineageChain[] = [
			{
				hopIndices: [0, 1, 2],
				typeSequence: ["slack-message", "github-issue", "github-pr"],
				sourceTypeDiversity: 3,
			},
		];
		const conclusion = buildConclusion(hops, chains);
		expect(conclusion?.recommendedNextReads).toHaveLength(1);
		expect(conclusion?.recommendedNextReads[0].hopIndex).toBe(2);
	});

	it("returns conclusion with empty candidateFixes when no fix edges exist", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "slack-message", connection: { method: "semantic", confidence: 0.9 } }),
		];
		const conclusion = buildConclusion(hops, []);
		expect(conclusion).toBeDefined();
		expect(conclusion?.candidateFixes).toEqual([]);
		expect(conclusion?.primaryArtifact).toBeDefined();
	});
});
