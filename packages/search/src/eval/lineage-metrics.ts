import type { TraceResult } from "../trace/trace.js";

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
	};
}
