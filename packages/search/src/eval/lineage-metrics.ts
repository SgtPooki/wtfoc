import { parseHopTimestampMs } from "../trace/chronology.js";
import type { TraceResult } from "../trace/trace.js";

/**
 * Parent→child timestamp direction over edges of one `(edgeType, walkDirection)`
 * cell (#280).
 *
 * Neutral signal: reports how often `child.timestamp > parent.timestamp` for
 * each cell, without prescribing which direction is "right". A `closes` edge
 * walked forward (PR → issue) has opposite temporal expectations than the same
 * edge walked reverse (issue → PR), so the two are reported separately. A
 * wildly unexpected rate for a specific cell is the real quality signal.
 */
export interface EdgeTypeTemporalCoherence {
	edgeType: string;
	/** Which index orientation this cell aggregates — see `TraceHop.connection.walkDirection`. */
	walkDirection: "forward" | "reverse";
	/** Parent→child hops where both parent and child have a parseable timestamp. */
	pairCount: number;
	/** Pairs where `child.ts > parent.ts`. */
	childAfterParent: number;
	/** Pairs where `child.ts < parent.ts`. */
	childBeforeParent: number;
	/** Pairs where `child.ts === parent.ts` to millisecond precision. */
	childEqualsParent: number;
	/** `childAfterParent / pairCount`. 0 when no pairs were scored. */
	childAfterParentRate: number;
}

type CoherenceBucket = { after: number; before: number; equal: number };
type CoherenceKey = { edgeType: string; walkDirection: "forward" | "reverse" };

function coherenceKeyString(k: CoherenceKey): string {
	return `${k.walkDirection}|${k.edgeType}`;
}

function computeCoherence(
	buckets: Map<string, { key: CoherenceKey; bucket: CoherenceBucket }>,
): EdgeTypeTemporalCoherence[] {
	return [...buckets.values()]
		.map(({ key, bucket: b }): EdgeTypeTemporalCoherence => {
			const pairCount = b.after + b.before + b.equal;
			return {
				edgeType: key.edgeType,
				walkDirection: key.walkDirection,
				pairCount,
				childAfterParent: b.after,
				childBeforeParent: b.before,
				childEqualsParent: b.equal,
				childAfterParentRate: pairCount > 0 ? b.after / pairCount : 0,
			};
		})
		.sort(
			(a, b) =>
				b.pairCount - a.pairCount ||
				a.edgeType.localeCompare(b.edgeType) ||
				a.walkDirection.localeCompare(b.walkDirection),
		);
}

/**
 * Per-trace lineage quality metrics (#217 follow-up to #206).
 *
 * Captures how well a single trace's lineage output conveys causal structure,
 * agent-consumable conclusions, temporal ordering, and cross-source reach —
 * complementing the existing MRR / edge-hop-ratio measurements.
 */
export interface LineageMetrics {
	// ── Chain coverage ──────────────────────────────────────
	/** Total hops in the trace. */
	totalHops: number;
	/** Hops that appear in any multi-hop chain (length >= 2). */
	hopsInChains: number;
	/** hopsInChains / totalHops; 0 when totalHops === 0. */
	chainCoverageRate: number;
	/** Count of all lineage chains (includes single-hop roots). */
	totalChainCount: number;
	/** Count of multi-hop chains (length >= 2) — the "inferred causal chains". */
	multiHopChainCount: number;

	// ── Conclusion signal ───────────────────────────────────
	/** True when the trace produced a populated primaryArtifact. */
	hasPrimaryArtifact: boolean;
	candidateFixCount: number;
	relatedContextCount: number;
	recommendedNextReadCount: number;

	// ── Timeline completeness ───────────────────────────────
	/** Hops with a valid, parseable timestamp. */
	hopsWithTimestamp: number;
	/** hopsWithTimestamp / totalHops. */
	timestampCoverageRate: number;
	/**
	 * Diagnostic: true when timestamped hops in *traversal* order are monotonically
	 * non-decreasing. Null when fewer than two timestamped hops exist.
	 *
	 * Not a quality signal. DFS traversal order is not timeline order by design —
	 * edges are walked in edge-index order, not chronologically. See #274.
	 * Use `TraceResult.chronologicalHopIndices` for timeline consumption.
	 */
	traversalTimelineMonotonic: boolean | null;
	/** Latest − earliest timestamp in ms; null when < 2 timestamped hops. */
	timelineSpanMs: number | null;

	// ── Chain diversity ─────────────────────────────────────
	/** Multi-hop chains whose sourceTypeDiversity >= 2. */
	crossSourceChainCount: number;
	/** crossSourceChainCount / multiHopChainCount; 0 when no multi-hop chains. */
	crossSourceChainRate: number;
	/** Mean sourceTypeDiversity across multi-hop chains; 0 when none. */
	avgChainDiversity: number;

	// ── Edge-type temporal coherence (#280) ─────────────────
	/**
	 * Per-edge-type parent→child timestamp direction breakdown for edge hops
	 * whose parent and child both carry a parseable timestamp. See
	 * `EdgeTypeTemporalCoherence`. Sorted by `pairCount` descending.
	 */
	chainTemporalCoherenceByEdgeType: EdgeTypeTemporalCoherence[];
}

/**
 * Aggregate lineage metrics across a batch of traces (e.g. all fixtures in a
 * dogfood stage). Rates are simple means across the underlying per-trace
 * values — empty-trace metrics (`totalHops === 0`) are excluded so a single
 * degenerate fixture can't artificially pull coverage down.
 */
export interface AggregateLineageMetrics {
	/** Traces scored (excludes traces with no hops). */
	traceCount: number;
	/**
	 * Non-empty traces that produced a LineageMetrics record.
	 *
	 * Does NOT include queries whose trace threw (those are filtered out before
	 * aggregation by the evaluators). When reading the report, compare against
	 * `totalQueries` / fixture count to tell how many attempts reached this stage.
	 */
	tracesObserved: number;
	avgChainCoverageRate: number;
	avgCrossSourceChainRate: number;
	avgTimestampCoverageRate: number;
	avgChainDiversity: number;
	/** Mean multi-hop chain count per non-empty trace. */
	avgMultiHopChainCount: number;
	/** Fraction of non-empty traces with a populated primaryArtifact. */
	primaryArtifactRate: number;
	/**
	 * Diagnostic aggregate of `traversalTimelineMonotonic`. Measures how often
	 * DFS traversal order happens to be chronological, which is incidental — not
	 * a quality target. Null when no trace had enough timestamp data to score
	 * (distinct from a true "0% monotonic" result). See #274.
	 */
	traversalTimelineMonotonicRate: number | null;
	/** Traces that contributed to `traversalTimelineMonotonicRate` (>=2 timestamped hops). */
	traversalTimelineMonotonicCandidateCount: number;
	/** Summed candidate fixes across all traces. */
	totalCandidateFixes: number;
	/** Summed recommended-next-reads across all traces. */
	totalRecommendedNextReads: number;
	/**
	 * Pair-weighted aggregate of per-trace `chainTemporalCoherenceByEdgeType`:
	 * pairs from every trace are summed per edge type, then
	 * `childAfterParentRate` is recomputed on the merged totals. Reports the
	 * aggregate pair population — a population-level diagnostic where
	 * edge-rich traces do contribute proportionally more pairs, which is the
	 * intended behavior for measuring extractor/traversal output. A trace-mean
	 * would answer a different question (average query behavior) and is not
	 * used here. Sorted by `pairCount` descending. See #280.
	 */
	chainTemporalCoherenceByEdgeType: EdgeTypeTemporalCoherence[];
}

/** Compute per-trace lineage metrics. Safe for empty traces. */
export function computeLineageMetrics(result: TraceResult): LineageMetrics {
	const hops = result.hops;
	const totalHops = hops.length;
	const chains = result.lineageChains;
	const multiHop = chains.filter((c) => c.hopIndices.length >= 2);
	const hopsInChains = new Set(multiHop.flatMap((c) => c.hopIndices)).size;

	// Timeline
	const timestampedOrdered: number[] = [];
	let hopsWithTimestamp = 0;
	for (const hop of hops) {
		if (hop.timestamp) {
			const ms = Date.parse(hop.timestamp);
			if (!Number.isNaN(ms)) {
				hopsWithTimestamp++;
				timestampedOrdered.push(ms);
			}
		}
	}

	let traversalTimelineMonotonic: boolean | null;
	let timelineSpanMs: number | null;
	if (timestampedOrdered.length < 2) {
		traversalTimelineMonotonic = null;
		timelineSpanMs = null;
	} else {
		let monotonic = true;
		for (let i = 1; i < timestampedOrdered.length; i++) {
			const prev = timestampedOrdered[i - 1];
			const cur = timestampedOrdered[i];
			if (prev === undefined || cur === undefined) continue;
			if (cur < prev) {
				monotonic = false;
				break;
			}
		}
		traversalTimelineMonotonic = monotonic;
		const min = Math.min(...timestampedOrdered);
		const max = Math.max(...timestampedOrdered);
		timelineSpanMs = max - min;
	}

	const crossSourceChains = multiHop.filter((c) => c.sourceTypeDiversity >= 2);
	const avgDiversity =
		multiHop.length > 0
			? multiHop.reduce((sum, c) => sum + c.sourceTypeDiversity, 0) / multiHop.length
			: 0;

	// #280 — bucket parent→child timestamp direction by (edgeType, walkDirection).
	// Only edge hops with a resolved parent qualify; semantic seeds and fallbacks
	// carry no parent/edge relationship and are skipped. Splitting by
	// walkDirection prevents conflating forward vs reverse walks of the same
	// edge type (see `TraversalEdge` in trace/indexing.ts).
	const edgeBuckets = new Map<string, { key: CoherenceKey; bucket: CoherenceBucket }>();
	for (const hop of hops) {
		if (hop.connection.method !== "edge") continue;
		if (hop.parentHopIndex === undefined) continue;
		const edgeType = hop.connection.edgeType;
		if (!edgeType) continue;
		// Default reverse-index hops land with an explicit walkDirection; hops
		// assembled in tests or older callers without one are treated as forward.
		const walkDirection: "forward" | "reverse" = hop.connection.walkDirection ?? "forward";
		const parent = hops[hop.parentHopIndex];
		if (!parent) continue;
		const parentMs = parseHopTimestampMs(parent.timestamp);
		const childMs = parseHopTimestampMs(hop.timestamp);
		if (parentMs === null || childMs === null) continue;
		const key: CoherenceKey = { edgeType, walkDirection };
		const keyStr = coherenceKeyString(key);
		const entry = edgeBuckets.get(keyStr) ?? { key, bucket: { after: 0, before: 0, equal: 0 } };
		if (childMs > parentMs) entry.bucket.after++;
		else if (childMs < parentMs) entry.bucket.before++;
		else entry.bucket.equal++;
		edgeBuckets.set(keyStr, entry);
	}
	const chainTemporalCoherenceByEdgeType = computeCoherence(edgeBuckets);

	const conclusion = result.conclusion;

	return {
		totalHops,
		hopsInChains,
		chainCoverageRate: totalHops > 0 ? hopsInChains / totalHops : 0,
		totalChainCount: chains.length,
		multiHopChainCount: multiHop.length,

		hasPrimaryArtifact: conclusion?.primaryArtifact != null,
		candidateFixCount: conclusion?.candidateFixes.length ?? 0,
		relatedContextCount: conclusion?.relatedContext.length ?? 0,
		recommendedNextReadCount: conclusion?.recommendedNextReads.length ?? 0,

		hopsWithTimestamp,
		timestampCoverageRate: totalHops > 0 ? hopsWithTimestamp / totalHops : 0,
		traversalTimelineMonotonic,
		timelineSpanMs,

		crossSourceChainCount: crossSourceChains.length,
		crossSourceChainRate: multiHop.length > 0 ? crossSourceChains.length / multiHop.length : 0,
		avgChainDiversity: avgDiversity,

		chainTemporalCoherenceByEdgeType,
	};
}

export function aggregateLineageMetrics(metrics: LineageMetrics[]): AggregateLineageMetrics {
	const observed = metrics.length;
	const nonEmpty = metrics.filter((m) => m.totalHops > 0);
	const n = nonEmpty.length;

	if (n === 0) {
		return {
			traceCount: 0,
			tracesObserved: observed,
			avgChainCoverageRate: 0,
			avgCrossSourceChainRate: 0,
			avgTimestampCoverageRate: 0,
			avgChainDiversity: 0,
			avgMultiHopChainCount: 0,
			primaryArtifactRate: 0,
			traversalTimelineMonotonicRate: null,
			traversalTimelineMonotonicCandidateCount: 0,
			totalCandidateFixes: 0,
			totalRecommendedNextReads: 0,
			chainTemporalCoherenceByEdgeType: [],
		};
	}

	const mean = (fn: (m: LineageMetrics) => number): number =>
		nonEmpty.reduce((sum, m) => sum + fn(m), 0) / n;

	const monotonicCandidates = nonEmpty.filter((m) => m.traversalTimelineMonotonic !== null);
	const monotonicRate =
		monotonicCandidates.length > 0
			? monotonicCandidates.filter((m) => m.traversalTimelineMonotonic === true).length /
				monotonicCandidates.length
			: null;

	// #280 — merge per-trace (edgeType, walkDirection) buckets into a single
	// pair-weighted view.
	const mergedBuckets = new Map<string, { key: CoherenceKey; bucket: CoherenceBucket }>();
	for (const m of nonEmpty) {
		for (const c of m.chainTemporalCoherenceByEdgeType) {
			const key: CoherenceKey = { edgeType: c.edgeType, walkDirection: c.walkDirection };
			const keyStr = coherenceKeyString(key);
			const entry = mergedBuckets.get(keyStr) ?? {
				key,
				bucket: { after: 0, before: 0, equal: 0 },
			};
			entry.bucket.after += c.childAfterParent;
			entry.bucket.before += c.childBeforeParent;
			entry.bucket.equal += c.childEqualsParent;
			mergedBuckets.set(keyStr, entry);
		}
	}
	const chainTemporalCoherenceByEdgeType = computeCoherence(mergedBuckets);

	return {
		traceCount: n,
		tracesObserved: observed,
		avgChainCoverageRate: mean((m) => m.chainCoverageRate),
		avgCrossSourceChainRate: mean((m) => m.crossSourceChainRate),
		avgTimestampCoverageRate: mean((m) => m.timestampCoverageRate),
		avgChainDiversity: mean((m) => m.avgChainDiversity),
		avgMultiHopChainCount: mean((m) => m.multiHopChainCount),
		primaryArtifactRate: nonEmpty.filter((m) => m.hasPrimaryArtifact).length / n,
		traversalTimelineMonotonicRate: monotonicRate,
		traversalTimelineMonotonicCandidateCount: monotonicCandidates.length,
		totalCandidateFixes: nonEmpty.reduce((s, m) => s + m.candidateFixCount, 0),
		totalRecommendedNextReads: nonEmpty.reduce((s, m) => s + m.recommendedNextReadCount, 0),
		chainTemporalCoherenceByEdgeType,
	};
}
