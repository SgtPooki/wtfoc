import { describe, expect, it } from "vitest";
import type { TraceConclusion } from "../trace/conclusion.js";
import type { LineageChain } from "../trace/lineage.js";
import type { TraceHop, TraceResult } from "../trace/trace.js";
import { aggregateLineageMetrics, computeLineageMetrics } from "./lineage-metrics.js";

function makeHop(overrides: Partial<TraceHop> & { sourceType: string }): TraceHop {
	return {
		content: "test",
		source: "test-source",
		storageId: "test-storage",
		connection: { method: "semantic", confidence: 0.9 },
		...overrides,
	};
}

function makeResult(
	hops: TraceHop[],
	chains: LineageChain[],
	conclusion?: TraceConclusion,
): TraceResult {
	return {
		query: "q",
		groups: {},
		hops,
		chronologicalHopIndices: hops.map((_, i) => i),
		lineageChains: chains,
		conclusion,
		insights: [],
		stats: {
			totalHops: hops.length,
			edgeHops: hops.filter((h) => h.connection.method === "edge").length,
			semanticHops: hops.filter((h) => h.connection.method === "semantic").length,
			sourceTypes: [...new Set(hops.map((h) => h.sourceType))],
			insightCount: 0,
		},
	};
}

describe("computeLineageMetrics", () => {
	it("returns zero metrics for an empty trace", () => {
		const m = computeLineageMetrics(makeResult([], []));
		expect(m.totalHops).toBe(0);
		expect(m.chainCoverageRate).toBe(0);
		expect(m.multiHopChainCount).toBe(0);
		expect(m.hasPrimaryArtifact).toBe(false);
		expect(m.traversalTimelineMonotonic).toBeNull();
		expect(m.timelineSpanMs).toBeNull();
	});

	it("counts hops in multi-hop chains and ignores single-hop chains for coverage", () => {
		// Two separate chains: [0,1,2] multi-hop, [3] single-hop orphan
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a" }),
			makeHop({ sourceType: "b", parentHopIndex: 0 }),
			makeHop({ sourceType: "c", parentHopIndex: 1 }),
			makeHop({ sourceType: "d" }),
		];
		const chains: LineageChain[] = [
			{ hopIndices: [0, 1, 2], typeSequence: ["a", "b", "c"], sourceTypeDiversity: 3 },
			{ hopIndices: [3], typeSequence: ["d"], sourceTypeDiversity: 1 },
		];
		const m = computeLineageMetrics(makeResult(hops, chains));
		expect(m.hopsInChains).toBe(3);
		expect(m.chainCoverageRate).toBeCloseTo(0.75);
		expect(m.totalChainCount).toBe(2);
		expect(m.multiHopChainCount).toBe(1);
	});

	it("deduplicates hopsInChains across overlapping chains", () => {
		// Branching DFS produces two chains sharing root 0 and middle 1
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a" }),
			makeHop({ sourceType: "b", parentHopIndex: 0 }),
			makeHop({ sourceType: "c", parentHopIndex: 1 }),
			makeHop({ sourceType: "d", parentHopIndex: 1 }),
		];
		const chains: LineageChain[] = [
			{ hopIndices: [0, 1, 2], typeSequence: ["a", "b", "c"], sourceTypeDiversity: 3 },
			{ hopIndices: [0, 1, 3], typeSequence: ["a", "b", "d"], sourceTypeDiversity: 3 },
		];
		const m = computeLineageMetrics(makeResult(hops, chains));
		expect(m.hopsInChains).toBe(4);
		expect(m.chainCoverageRate).toBe(1);
		expect(m.multiHopChainCount).toBe(2);
	});

	it("captures conclusion signal counts", () => {
		const hops: TraceHop[] = [makeHop({ sourceType: "a" })];
		const conclusion: TraceConclusion = {
			primaryArtifact: { hopIndex: 0, summary: "a: test-source" },
			candidateFixes: [
				{ hopIndex: 1, summary: "fix-1" },
				{ hopIndex: 2, summary: "fix-2" },
			],
			relatedContext: [{ hopIndex: 3, summary: "ctx-1" }],
			recommendedNextReads: [{ hopIndex: 4, reason: "leaf" }],
		};
		const m = computeLineageMetrics(makeResult(hops, [], conclusion));
		expect(m.hasPrimaryArtifact).toBe(true);
		expect(m.candidateFixCount).toBe(2);
		expect(m.relatedContextCount).toBe(1);
		expect(m.recommendedNextReadCount).toBe(1);
	});

	it("reports hasPrimaryArtifact=false when conclusion.primaryArtifact is absent", () => {
		const hops: TraceHop[] = [makeHop({ sourceType: "a" })];
		const conclusion: TraceConclusion = {
			candidateFixes: [],
			relatedContext: [],
			recommendedNextReads: [],
		};
		const m = computeLineageMetrics(makeResult(hops, [], conclusion));
		expect(m.hasPrimaryArtifact).toBe(false);
	});

	it("treats a missing conclusion as empty signal", () => {
		const hops: TraceHop[] = [makeHop({ sourceType: "a" })];
		const m = computeLineageMetrics(makeResult(hops, []));
		expect(m.hasPrimaryArtifact).toBe(false);
		expect(m.candidateFixCount).toBe(0);
		expect(m.recommendedNextReadCount).toBe(0);
	});

	it("computes timestamp coverage and monotonicity", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a", timestamp: "2024-01-01T00:00:00Z" }),
			makeHop({ sourceType: "b" }),
			makeHop({ sourceType: "c", timestamp: "2024-01-02T00:00:00Z" }),
			makeHop({ sourceType: "d", timestamp: "2024-01-03T00:00:00Z" }),
		];
		const m = computeLineageMetrics(makeResult(hops, []));
		expect(m.hopsWithTimestamp).toBe(3);
		expect(m.timestampCoverageRate).toBeCloseTo(0.75);
		expect(m.traversalTimelineMonotonic).toBe(true);
		expect(m.timelineSpanMs).toBe(2 * 24 * 60 * 60 * 1000);
	});

	it("detects non-monotonic timelines", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a", timestamp: "2024-01-05T00:00:00Z" }),
			makeHop({ sourceType: "b", timestamp: "2024-01-01T00:00:00Z" }),
		];
		const m = computeLineageMetrics(makeResult(hops, []));
		expect(m.traversalTimelineMonotonic).toBe(false);
		expect(m.timelineSpanMs).toBe(4 * 24 * 60 * 60 * 1000);
	});

	it("returns null timeline fields when fewer than two timestamps", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a", timestamp: "2024-01-01T00:00:00Z" }),
			makeHop({ sourceType: "b" }),
		];
		const m = computeLineageMetrics(makeResult(hops, []));
		expect(m.traversalTimelineMonotonic).toBeNull();
		expect(m.timelineSpanMs).toBeNull();
	});

	it("ignores unparseable timestamps", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a", timestamp: "not-a-date" }),
			makeHop({ sourceType: "b", timestamp: "2024-01-01T00:00:00Z" }),
		];
		const m = computeLineageMetrics(makeResult(hops, []));
		expect(m.hopsWithTimestamp).toBe(1);
		expect(m.traversalTimelineMonotonic).toBeNull();
	});

	it("buckets parent→child timestamp direction by edge type (#280)", () => {
		// Three edge hops off seed 0: one `closes` child older, one `references`
		// child younger, one `references` child younger.
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a", timestamp: "2025-10-15T00:00:00Z" }),
			makeHop({
				sourceType: "b",
				parentHopIndex: 0,
				timestamp: "2025-10-10T00:00:00Z",
				connection: { method: "edge", edgeType: "closes", confidence: 1 },
			}),
			makeHop({
				sourceType: "c",
				parentHopIndex: 0,
				timestamp: "2025-10-20T00:00:00Z",
				connection: { method: "edge", edgeType: "references", confidence: 1 },
			}),
			makeHop({
				sourceType: "d",
				parentHopIndex: 0,
				timestamp: "2025-10-22T00:00:00Z",
				connection: { method: "edge", edgeType: "references", confidence: 1 },
			}),
		];
		const m = computeLineageMetrics(makeResult(hops, []));
		expect(m.chainTemporalCoherenceByEdgeType).toHaveLength(2);
		const refs = m.chainTemporalCoherenceByEdgeType.find((e) => e.edgeType === "references");
		const closes = m.chainTemporalCoherenceByEdgeType.find((e) => e.edgeType === "closes");
		expect(refs).toMatchObject({
			pairCount: 2,
			childAfterParent: 2,
			childBeforeParent: 0,
			childAfterParentRate: 1,
			walkDirection: "forward",
		});
		expect(closes).toMatchObject({
			pairCount: 1,
			childAfterParent: 0,
			childBeforeParent: 1,
			childAfterParentRate: 0,
			walkDirection: "forward",
		});
	});

	it("records kindPairs drill-down per coherence cell (#280)", () => {
		const hops: TraceHop[] = [
			makeHop({
				sourceType: "github-pr",
				timestamp: "2025-10-15T00:00:00Z",
				timestampKind: "updated",
			}),
			makeHop({
				sourceType: "code",
				parentHopIndex: 0,
				timestamp: "2025-10-14T00:00:00Z",
				timestampKind: "committed",
				connection: {
					method: "edge",
					edgeType: "documents",
					confidence: 1,
					walkDirection: "forward",
				},
			}),
			makeHop({
				sourceType: "code",
				parentHopIndex: 0,
				timestamp: "2025-10-13T00:00:00Z",
				timestampKind: "committed",
				connection: {
					method: "edge",
					edgeType: "documents",
					confidence: 1,
					walkDirection: "forward",
				},
			}),
			// Hop with unknown parent kind — should bucket under "unknown->committed"
			makeHop({ sourceType: "x", timestamp: "2025-10-20T00:00:00Z" }),
			makeHop({
				sourceType: "code",
				parentHopIndex: 3,
				timestamp: "2025-10-19T00:00:00Z",
				timestampKind: "committed",
				connection: {
					method: "edge",
					edgeType: "documents",
					confidence: 1,
					walkDirection: "forward",
				},
			}),
		];
		const m = computeLineageMetrics(makeResult(hops, []));
		const cell = m.chainTemporalCoherenceByEdgeType.find(
			(e) => e.edgeType === "documents" && e.walkDirection === "forward",
		);
		expect(cell).toBeDefined();
		expect(cell?.pairCount).toBe(3);
		expect(cell?.kindPairs).toEqual({
			"updated->committed": 2,
			"unknown->committed": 1,
		});
	});

	it("splits coherence cells by walkDirection so forward/reverse walks don't conflate (#280)", () => {
		// Same `closes` edge type, traversed both directions. Forward walks should
		// be child-before-parent (PR → older issue). Reverse walks should be
		// child-after-parent (issue → newer PR). Two separate cells.
		const hops: TraceHop[] = [
			makeHop({ sourceType: "pr", timestamp: "2025-10-15T00:00:00Z" }),
			makeHop({
				sourceType: "issue",
				parentHopIndex: 0,
				timestamp: "2025-10-10T00:00:00Z",
				connection: {
					method: "edge",
					edgeType: "closes",
					confidence: 1,
					walkDirection: "forward",
				},
			}),
			makeHop({ sourceType: "issue2", timestamp: "2025-10-01T00:00:00Z" }),
			makeHop({
				sourceType: "pr2",
				parentHopIndex: 2,
				timestamp: "2025-10-05T00:00:00Z",
				connection: {
					method: "edge",
					edgeType: "closes",
					confidence: 1,
					walkDirection: "reverse",
				},
			}),
		];
		const m = computeLineageMetrics(makeResult(hops, []));
		const fwd = m.chainTemporalCoherenceByEdgeType.find(
			(e) => e.edgeType === "closes" && e.walkDirection === "forward",
		);
		const rev = m.chainTemporalCoherenceByEdgeType.find(
			(e) => e.edgeType === "closes" && e.walkDirection === "reverse",
		);
		expect(fwd).toMatchObject({ pairCount: 1, childBeforeParent: 1, childAfterParentRate: 0 });
		expect(rev).toMatchObject({ pairCount: 1, childAfterParent: 1, childAfterParentRate: 1 });
	});

	it("ignores semantic hops and missing timestamps for coherence", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a", timestamp: "2025-10-15T00:00:00Z" }),
			// semantic: no edgeType — excluded
			makeHop({ sourceType: "b", parentHopIndex: 0, timestamp: "2025-10-16T00:00:00Z" }),
			// edge without a resolved parentHopIndex (seed-like) — excluded
			makeHop({
				sourceType: "c",
				timestamp: "2025-10-17T00:00:00Z",
				connection: { method: "edge", edgeType: "references", confidence: 1 },
			}),
			// undated parent — child has a timestamp but can't form a pair; excluded
			makeHop({ sourceType: "p2" }),
			makeHop({
				sourceType: "e",
				parentHopIndex: 3,
				timestamp: "2025-10-19T00:00:00Z",
				connection: { method: "edge", edgeType: "references", confidence: 1 },
			}),
			// edge with both timestamps — counted
			makeHop({
				sourceType: "d",
				parentHopIndex: 0,
				timestamp: "2025-10-18T00:00:00Z",
				connection: { method: "edge", edgeType: "references", confidence: 1 },
			}),
		];
		const m = computeLineageMetrics(makeResult(hops, []));
		expect(m.chainTemporalCoherenceByEdgeType).toHaveLength(1);
		expect(m.chainTemporalCoherenceByEdgeType[0]).toMatchObject({
			edgeType: "references",
			pairCount: 1,
			childAfterParent: 1,
			childAfterParentRate: 1,
		});
	});

	it("counts cross-source chains and average diversity over multi-hop chains only", () => {
		const hops: TraceHop[] = [
			makeHop({ sourceType: "a" }),
			makeHop({ sourceType: "b", parentHopIndex: 0 }),
			makeHop({ sourceType: "a" }),
			makeHop({ sourceType: "a", parentHopIndex: 2 }),
			makeHop({ sourceType: "c" }), // single-hop: excluded from multi-hop denominators
		];
		const chains: LineageChain[] = [
			// multi-hop, diversity 2
			{ hopIndices: [0, 1], typeSequence: ["a", "b"], sourceTypeDiversity: 2 },
			// multi-hop, diversity 1 (same type both hops)
			{ hopIndices: [2, 3], typeSequence: ["a"], sourceTypeDiversity: 1 },
			// single-hop — excluded
			{ hopIndices: [4], typeSequence: ["c"], sourceTypeDiversity: 1 },
		];
		const m = computeLineageMetrics(makeResult(hops, chains));
		expect(m.multiHopChainCount).toBe(2);
		expect(m.crossSourceChainCount).toBe(1);
		expect(m.crossSourceChainRate).toBe(0.5);
		expect(m.avgChainDiversity).toBe(1.5); // (2 + 1) / 2
	});
});

describe("aggregateLineageMetrics", () => {
	it("returns zeros when no metrics were captured", () => {
		const a = aggregateLineageMetrics([]);
		expect(a.traceCount).toBe(0);
		expect(a.tracesObserved).toBe(0);
		expect(a.avgChainCoverageRate).toBe(0);
		expect(a.primaryArtifactRate).toBe(0);
		// Null (not 0) when nothing could be scored — prevents the report from
		// reading "0% monotonic" when the true state is "no measurable data".
		expect(a.traversalTimelineMonotonicRate).toBeNull();
		expect(a.traversalTimelineMonotonicCandidateCount).toBe(0);
		expect(a.chainTemporalCoherenceByEdgeType).toEqual([]);
	});

	it("excludes empty traces from rate averages", () => {
		const full = computeLineageMetrics(
			makeResult(
				[makeHop({ sourceType: "a" }), makeHop({ sourceType: "b", parentHopIndex: 0 })],
				[{ hopIndices: [0, 1], typeSequence: ["a", "b"], sourceTypeDiversity: 2 }],
				{
					primaryArtifact: { hopIndex: 0, summary: "root" },
					candidateFixes: [{ hopIndex: 1, summary: "f" }],
					relatedContext: [],
					recommendedNextReads: [{ hopIndex: 1, reason: "leaf" }],
				},
			),
		);
		const empty = computeLineageMetrics(makeResult([], []));

		const a = aggregateLineageMetrics([full, empty]);
		expect(a.tracesObserved).toBe(2);
		expect(a.traceCount).toBe(1);
		expect(a.avgChainCoverageRate).toBe(1);
		expect(a.primaryArtifactRate).toBe(1);
		expect(a.totalCandidateFixes).toBe(1);
		expect(a.totalRecommendedNextReads).toBe(1);
	});

	it("computes timeline-monotonic rate only over traces with >= 2 timestamped hops", () => {
		const monotonic = computeLineageMetrics(
			makeResult(
				[
					makeHop({ sourceType: "a", timestamp: "2024-01-01T00:00:00Z" }),
					makeHop({ sourceType: "b", timestamp: "2024-01-02T00:00:00Z" }),
				],
				[],
			),
		);
		const reversed = computeLineageMetrics(
			makeResult(
				[
					makeHop({ sourceType: "a", timestamp: "2024-01-05T00:00:00Z" }),
					makeHop({ sourceType: "b", timestamp: "2024-01-04T00:00:00Z" }),
				],
				[],
			),
		);
		const noTs = computeLineageMetrics(
			makeResult([makeHop({ sourceType: "a" }), makeHop({ sourceType: "b" })], []),
		);
		const a = aggregateLineageMetrics([monotonic, reversed, noTs]);
		expect(a.traceCount).toBe(3);
		// 1 of 2 candidates (noTs excluded from denominator)
		expect(a.traversalTimelineMonotonicRate).toBe(0.5);
		expect(a.traversalTimelineMonotonicCandidateCount).toBe(2);
	});

	it("traversalTimelineMonotonicRate is null when no trace has enough timestamps", () => {
		const noTs1 = computeLineageMetrics(
			makeResult([makeHop({ sourceType: "a" }), makeHop({ sourceType: "b" })], []),
		);
		const noTs2 = computeLineageMetrics(
			makeResult(
				[
					makeHop({ sourceType: "a", timestamp: "2024-01-01T00:00:00Z" }),
					makeHop({ sourceType: "b" }),
				],
				[],
			),
		);
		const a = aggregateLineageMetrics([noTs1, noTs2]);
		expect(a.traversalTimelineMonotonicRate).toBeNull();
		expect(a.traversalTimelineMonotonicCandidateCount).toBe(0);
	});

	it("sums edge-type coherence pair counts across traces (pair-weighted, #280)", () => {
		const mkTrace = (children: Array<{ edgeType: string; childMs: string }>) =>
			computeLineageMetrics(
				makeResult(
					[
						makeHop({ sourceType: "p", timestamp: "2025-10-10T00:00:00Z" }),
						...children.map((c) =>
							makeHop({
								sourceType: "c",
								parentHopIndex: 0,
								timestamp: c.childMs,
								connection: { method: "edge", edgeType: c.edgeType, confidence: 1 },
							}),
						),
					],
					[],
				),
			);
		const t1 = mkTrace([
			{ edgeType: "references", childMs: "2025-10-11T00:00:00Z" },
			{ edgeType: "references", childMs: "2025-10-09T00:00:00Z" },
		]);
		const t2 = mkTrace([
			{ edgeType: "references", childMs: "2025-10-12T00:00:00Z" },
			{ edgeType: "closes", childMs: "2025-10-05T00:00:00Z" },
		]);
		const agg = aggregateLineageMetrics([t1, t2]);
		const refs = agg.chainTemporalCoherenceByEdgeType.find((e) => e.edgeType === "references");
		const closes = agg.chainTemporalCoherenceByEdgeType.find((e) => e.edgeType === "closes");
		expect(refs).toMatchObject({
			pairCount: 3,
			childAfterParent: 2,
			childBeforeParent: 1,
			walkDirection: "forward",
		});
		expect(refs?.childAfterParentRate).toBeCloseTo(2 / 3);
		expect(closes).toMatchObject({
			pairCount: 1,
			childAfterParent: 0,
			childBeforeParent: 1,
			childAfterParentRate: 0,
			walkDirection: "forward",
		});
	});

	it("aggregates forward and reverse walks of the same edge type into separate cells", () => {
		const t1 = computeLineageMetrics(
			makeResult(
				[
					makeHop({ sourceType: "pr", timestamp: "2025-10-15T00:00:00Z" }),
					makeHop({
						sourceType: "issue",
						parentHopIndex: 0,
						timestamp: "2025-10-10T00:00:00Z",
						connection: {
							method: "edge",
							edgeType: "closes",
							confidence: 1,
							walkDirection: "forward",
						},
					}),
				],
				[],
			),
		);
		const t2 = computeLineageMetrics(
			makeResult(
				[
					makeHop({ sourceType: "issue", timestamp: "2025-10-05T00:00:00Z" }),
					makeHop({
						sourceType: "pr",
						parentHopIndex: 0,
						timestamp: "2025-10-12T00:00:00Z",
						connection: {
							method: "edge",
							edgeType: "closes",
							confidence: 1,
							walkDirection: "reverse",
						},
					}),
				],
				[],
			),
		);
		const agg = aggregateLineageMetrics([t1, t2]);
		const closes = agg.chainTemporalCoherenceByEdgeType.filter((e) => e.edgeType === "closes");
		expect(closes).toHaveLength(2);
		const fwd = closes.find((c) => c.walkDirection === "forward");
		const rev = closes.find((c) => c.walkDirection === "reverse");
		expect(fwd).toMatchObject({ pairCount: 1, childBeforeParent: 1, childAfterParentRate: 0 });
		expect(rev).toMatchObject({ pairCount: 1, childAfterParent: 1, childAfterParentRate: 1 });
	});

	it("averages multi-hop chain counts and cross-source rates across traces", () => {
		const a = computeLineageMetrics(
			makeResult(
				[makeHop({ sourceType: "x" }), makeHop({ sourceType: "y", parentHopIndex: 0 })],
				[{ hopIndices: [0, 1], typeSequence: ["x", "y"], sourceTypeDiversity: 2 }],
			),
		);
		const b = computeLineageMetrics(
			makeResult(
				[makeHop({ sourceType: "x" }), makeHop({ sourceType: "x", parentHopIndex: 0 })],
				[{ hopIndices: [0, 1], typeSequence: ["x"], sourceTypeDiversity: 1 }],
			),
		);
		const agg = aggregateLineageMetrics([a, b]);
		expect(agg.avgMultiHopChainCount).toBe(1);
		expect(agg.avgCrossSourceChainRate).toBe(0.5); // (1.0 + 0.0) / 2
		expect(agg.avgChainDiversity).toBe(1.5); // (2 + 1) / 2
	});
});
