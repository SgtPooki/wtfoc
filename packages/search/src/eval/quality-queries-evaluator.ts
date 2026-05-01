import type {
	Edge,
	Embedder,
	EvalCheck,
	EvalStageResult,
	Reranker,
	Segment,
	VectorIndex,
} from "@wtfoc/common";
import { classifyQueryPersona } from "../persona/classify-query.js";
import { query } from "../query.js";
import { trace } from "../trace/trace.js";
import {
	GOLD_STANDARD_QUERIES_LEGACY_VIEW as GOLD_STANDARD_QUERIES,
	GOLD_STANDARD_QUERIES_VERSION,
	type LegacyGoldQueryView as GoldStandardQuery,
} from "./gold-standard-queries.js";
import {
	aggregateLineageMetrics,
	computeLineageMetrics,
	type LineageMetrics,
} from "./lineage-metrics.js";

/**
 * #320 — fast-iteration smoke support. When `WTFOC_QUERY_FILTER` is set
 * to a comma-separated list of query ids, score only those queries from
 * the gold fixture. Aggregate metrics get noisier (demo-critical
 * pass-rate of 1/1 is not the same signal as 5/5) but per-query data
 * stays real — useful for hypothesis testing on a 20-30 query subset
 * before burning hours on the full 153-query fixture.
 *
 * Empty / unset / whitespace-only env var = no filter (default behavior).
 * Unknown ids in the filter list are silently dropped. Missing ids in
 * the fixture are reported in `queryFilter.unknownIds` so a typo doesn't
 * silently shrink the run beyond expectation.
 */
export function getActiveQueries(): {
	queries: ReadonlyArray<GoldStandardQuery>;
	filter: { active: boolean; requestedIds: string[]; unknownIds: string[]; totalAvailable: number };
} {
	const raw = process.env.WTFOC_QUERY_FILTER ?? "";
	const requested = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	if (requested.length === 0) {
		return {
			queries: GOLD_STANDARD_QUERIES,
			filter: {
				active: false,
				requestedIds: [],
				unknownIds: [],
				totalAvailable: GOLD_STANDARD_QUERIES.length,
			},
		};
	}
	const wantedSet = new Set(requested);
	const filtered = GOLD_STANDARD_QUERIES.filter((q) => wantedSet.has(q.id));
	const matchedIds = new Set(filtered.map((q) => q.id));
	const unknownIds = requested.filter((id) => !matchedIds.has(id));
	return {
		queries: filtered,
		filter: {
			active: true,
			requestedIds: requested,
			unknownIds,
			totalAvailable: GOLD_STANDARD_QUERIES.length,
		},
	};
}

interface QueryScore {
	id: string;
	category: string;
	queryText: string;
	/**
	 * True when the query was skipped as inapplicable to this corpus (because
	 * its `requiredSourceTypes` are not present, or its `collectionScopePattern`
	 * does not match the collection id). Skipped queries do not count toward
	 * pass/fail; they contribute to `skippedCount` and `skippedReasons`.
	 */
	skipped?: boolean;
	skipReason?: string;
	passed: boolean;
	/**
	 * #261 — whether the query would pass using ONLY the semantic search stage
	 * (no trace). Lets dogfood detect retrieval regressions that are being
	 * hidden by trace-hop rescue.
	 */
	passedQueryOnly: boolean;
	resultCount: number;
	requiredTypesFound: boolean;
	/** #261 — requiredTypesFound computed against query results only (no trace). */
	requiredTypesFoundQueryOnly: boolean;
	substringFound: boolean;
	edgeHopFound: boolean;
	crossSourceFound: boolean;
	sourceTypesReached: string[];
	/** #217 — per-query lineage metrics (null when trace failed). */
	lineage: LineageMetrics | null;
	/**
	 * #311 (Phase 0e) — evidence-diversity per query. Counts distinct
	 * source identifiers and source-types across the union of `query()`
	 * results and `trace()` reached hops. Lets the autoresearch loop
	 * detect retrieval narrowing (improvements that look better on
	 * pass-rate but kill cross-source evidence).
	 */
	distinctDocs: number;
	distinctSourceTypes: number;
	/**
	 * #311 (Phase 0d) — retrieval recall@K against gold supporting
	 * sources, computed only for queries with a `goldSupportingSources`
	 * mapping in the fixture (demo-critical tier in v1.7.0). null when
	 * the fixture has no recall baseline for this query, or when the
	 * query failed before retrieval (resultCount === 0).
	 */
	recallAtK: number | null;
	/** Top-K depth used to compute `recallAtK` (currently 10). */
	recallK: number | null;
	/**
	 * Highest score in the query top-K. Used for hard-negative scoring
	 * (#311 reviewer feedback): a hard-negative passes only when the
	 * top result's confidence is below `HARD_NEGATIVE_SCORE_CEILING`,
	 * even if `resultCount` is small.
	 */
	topScore: number | null;
	/**
	 * #311 (Phase 1a) — paraphrase invariance check. Populated only when
	 * `QualityQueriesContext.checkParaphrases === true` AND the fixture
	 * has `paraphrases` for this query.
	 */
	paraphraseScores?: ParaphraseScore[];
	/**
	 * True iff the canonical query passed AND every paraphrase passed.
	 * Brittle queries (canonical pass + ≥1 paraphrase fail) surface as
	 * false. Undefined when paraphrases not checked.
	 */
	paraphraseInvariant?: boolean;
	/**
	 * #334 — gold-source proximity: where the expected source actually
	 * landed in the wider candidate list (top-50). When the query
	 * failed but the gold source was retrieved at a rank just past the
	 * production top-K cutoff, this surfaces a direct mandate for the
	 * autonomous loop's LLM proposer to widen K. When the gold source
	 * is absent from the wider candidate list, that's a retrieval /
	 * embedder problem, not a K problem.
	 *
	 * Computed only when:
	 *   - the query has `goldSupportingSources`, AND
	 *   - the canonical query failed (passed === false), AND
	 *   - WTFOC_GOLD_PROXIMITY=1 OR the evaluator was given
	 *     `recordGoldProximity: true` in context.
	 *
	 * `goldRank` is the (1-indexed) rank of the first matching gold
	 * source in the WIDER top-50 list. null when the gold source did
	 * not appear in top-50 at all.
	 */
	goldProximity?: {
		widerK: number;
		topKCutoff: number;
		goldRank: number | null;
		goldScore: number | null;
		topKLastScore: number | null;
	};
}

export interface ParaphraseScore {
	text: string;
	passed: boolean;
	passedQueryOnly: boolean;
}

/**
 * Evaluate search quality against gold standard queries.
 * Runs each query via trace and scores against expected results.
 */
export interface QualityQueriesContext {
	/** Collection ID for `collectionScopePattern` matching. */
	collectionId?: string;
	/**
	 * Source types actually present in the corpus (union across all
	 * segments). When provided, queries whose `requiredSourceTypes` are
	 * not all present are marked skipped rather than failed — that is a
	 * corpus coverage gap, not a retrieval regression.
	 */
	corpusSourceTypes?: ReadonlySet<string>;
	/**
	 * Per-query timing hook. Maintainer-only: dogfood and the autoresearch
	 * sweep harness pass a callback that receives `(queryId, durationMs)`
	 * after each query is scored. Used to compute end-to-end p50/p95
	 * across the fixture; consumers leave it unset.
	 */
	perQueryHook?: (queryId: string, durationMs: number) => void;
	/**
	 * Run each fixture query's `paraphrases` through the same scoring
	 * pipeline and report per-query `paraphraseInvariant`. Default off
	 * because paraphrase scoring multiplies wall-clock cost by ~(1+N)
	 * paraphrases per query; on for autoresearch sweeps that need
	 * brittleness signal.
	 */
	checkParaphrases?: boolean;
	/**
	 * Numeric retrieval-config overrides for the autoresearch loop
	 * (#334). When unset, evaluator uses its built-in defaults
	 * (topK=10, traceMaxPerSource=3, traceMaxTotal=15, traceMinScore=0.3).
	 * The dogfood CLI exposes these as flags, the sweep harness threads
	 * them through, and the run-config fingerprint records the effective
	 * values so two variants with different topK never share caches or
	 * baseline windows.
	 */
	retrievalOverrides?: {
		topK?: number;
		traceMaxPerSource?: number;
		traceMaxTotal?: number;
		traceMinScore?: number;
	};
	/**
	 * #334 — when true, on a failed query with goldSupportingSources, run
	 * a wider retrieval (topK=50) and record where the expected source
	 * landed. Adds wall-clock overhead per failed query but produces
	 * direct LLM-actionable signal ("gold ranked at 14, K cutoff at 10
	 * — widen K"). Default: respects WTFOC_GOLD_PROXIMITY=1 env.
	 */
	recordGoldProximity?: boolean;
}

export async function evaluateQualityQueries(
	embedder: Embedder,
	vectorIndex: VectorIndex,
	segments: Segment[],
	signal?: AbortSignal,
	overlayEdges: Edge[] = [],
	reranker?: Reranker,
	autoRoute = false,
	context: QualityQueriesContext = {},
	diversityEnforce = false,
): Promise<EvalStageResult> {
	const startedAt = new Date().toISOString();
	const t0 = performance.now();
	const checks: EvalCheck[] = [];

	const scores: QueryScore[] = [];
	let passCount = 0;
	let queryOnlyPassCount = 0;
	let skippedCount = 0;
	const skippedReasons: Array<{ id: string; reason: string }> = [];

	const { queries: activeQueries, filter: queryFilter } = getActiveQueries();

	for (const gq of activeQueries) {
		signal?.throwIfAborted();
		const skip = resolveSkip(gq, context);
		if (skip) {
			scores.push(skippedScore(gq, skip));
			skippedCount++;
			skippedReasons.push({ id: gq.id, reason: skip });
			continue;
		}
		const queryStart = performance.now();
		const score = await scoreQuery(
			gq,
			embedder,
			vectorIndex,
			segments,
			signal,
			overlayEdges,
			reranker,
			autoRoute,
			diversityEnforce,
			context.checkParaphrases ?? false,
			context.retrievalOverrides ?? {},
			context.recordGoldProximity ?? process.env.WTFOC_GOLD_PROXIMITY === "1",
		);
		context.perQueryHook?.(gq.id, performance.now() - queryStart);
		scores.push(score);
		if (score.passed) passCount++;
		if (score.passedQueryOnly) queryOnlyPassCount++;
	}

	const applicableTotal = activeQueries.length - skippedCount;
	const passRate = applicableTotal > 0 ? passCount / applicableTotal : 0;
	const queryOnlyPassRate = applicableTotal > 0 ? queryOnlyPassCount / applicableTotal : 0;

	// Category breakdown
	const categories = [
		"direct-lookup",
		"cross-source",
		"coverage",
		"synthesis",
		"file-level",
		"work-lineage",
		"hard-negative",
	] as const;
	const categoryBreakdown: Record<
		string,
		{ total: number; passed: number; passRate: number; skipped: number }
	> = {};
	for (const cat of categories) {
		const catScores = scores.filter((s) => s.category === cat);
		const applicable = catScores.filter((s) => !s.skipped);
		const catPassed = applicable.filter((s) => s.passed).length;
		categoryBreakdown[cat] = {
			total: applicable.length,
			passed: catPassed,
			passRate: applicable.length > 0 ? catPassed / applicable.length : 0,
			skipped: catScores.length - applicable.length,
		};
	}

	// Tier breakdown (v1.2.0) — demo-critical queries must pass for the
	// June 7 flagship to be safe. Surfaced separately so overall pass rate
	// doesn't hide a demo-breaking regression.
	const demoCriticalIds = new Set(
		activeQueries.filter((q) => q.tier === "demo-critical").map((q) => q.id),
	);
	const demoCriticalScores = scores.filter((s) => demoCriticalIds.has(s.id) && !s.skipped);
	const demoCriticalPassed = demoCriticalScores.filter((s) => s.passed).length;
	const tierBreakdown = {
		"demo-critical": {
			total: demoCriticalScores.length,
			passed: demoCriticalPassed,
			passRate: demoCriticalScores.length > 0 ? demoCriticalPassed / demoCriticalScores.length : 0,
		},
	};

	// Portability breakdown (v1.6.0) — split pass rate into generic
	// retrieval quality (portable queries) vs corpus-specific depth
	// (queries naming v12 artifacts). Keeps a 100% corpus-specific score
	// from masquerading as general retrieval. Peer-review (codex + gemini)
	// required after overfitting audit flagged single-corpus tuning.
	const portableIds = new Set(
		activeQueries.filter((q) => q.portability === "portable").map((q) => q.id),
	);
	const portableScores = scores.filter((s) => portableIds.has(s.id) && !s.skipped);
	const portablePassed = portableScores.filter((s) => s.passed).length;
	const corpusSpecificScores = scores.filter((s) => !portableIds.has(s.id) && !s.skipped);
	const corpusSpecificPassed = corpusSpecificScores.filter((s) => s.passed).length;
	const portabilityBreakdown = {
		portable: {
			total: portableScores.length,
			passed: portablePassed,
			passRate: portableScores.length > 0 ? portablePassed / portableScores.length : 0,
		},
		"corpus-specific": {
			total: corpusSpecificScores.length,
			passed: corpusSpecificPassed,
			passRate:
				corpusSpecificScores.length > 0 ? corpusSpecificPassed / corpusSpecificScores.length : 0,
		},
	};

	// Applicable rate (v1.6.0) — what fraction of the fixture this corpus
	// can even answer. A high pass rate on a low applicable rate is the
	// overfit-and-skip signature; threshold check should warn on this.
	const applicableRate = activeQueries.length ? applicableTotal / activeQueries.length : 0;

	// Verdict
	let verdict: "pass" | "warn" | "fail" = "pass";
	if (passRate === 0) {
		verdict = "fail";
		checks.push({
			name: "quality:all-failed",
			passed: false,
			actual: 0,
			detail: "All gold standard queries failed",
		});
	} else if (passRate < 0.5) {
		verdict = "warn";
		checks.push({
			name: "quality:low-pass-rate",
			passed: false,
			actual: Math.round(passRate * 100),
			expected: ">= 50%",
			detail: `Only ${Math.round(passRate * 100)}% of gold standard queries passed`,
		});
	}

	// Add individual failure checks
	for (const score of scores) {
		if (score.skipped) continue;
		if (!score.passed) {
			const reasons: string[] = [];
			if (score.resultCount === 0) reasons.push("no results");
			if (!score.requiredTypesFound) reasons.push("missing required source types");
			if (!score.substringFound) reasons.push("missing expected source substrings");
			if (!score.edgeHopFound) reasons.push("no edge hops");
			if (!score.crossSourceFound) reasons.push("no cross-source hops");
			checks.push({
				name: `quality:${score.id}`,
				passed: false,
				actual: reasons.join(", "),
				detail: `[${score.category}] "${score.queryText}" — ${reasons.join(", ")}`,
			});
		}
	}

	const durationMs = Math.round(performance.now() - t0);

	return {
		stage: "quality-queries",
		startedAt,
		durationMs,
		verdict,
		summary: `${passCount}/${applicableTotal} applicable gold queries passed (${Math.round(passRate * 100)}%${skippedCount > 0 ? `, ${skippedCount} skipped` : ""})`,
		metrics: {
			// #261 — stamp the fixture version into every report so historical
			// dogfood runs remain comparable only when the same gold queries
			// scored them. Version bumps on add/remove/re-categorize.
			goldQueriesVersion: GOLD_STANDARD_QUERIES_VERSION,
			// v1.4.0 — pass rates are computed against the *applicable* subset
			// (queries minus skipped). Skipped queries are tracked separately
			// so "69%" does not silently change meaning across collections.
			passRate,
			passCount,
			queryOnlyPassRate,
			queryOnlyPassCount,
			applicableTotal,
			applicableRate,
			skippedCount,
			skippedReasons,
			/** Total queries in the fixture — includes skipped. */
			totalQueries: GOLD_STANDARD_QUERIES.length,
			categoryBreakdown,
			tierBreakdown,
			portabilityBreakdown,
			scores,
			// #217 — aggregate lineage trace quality (chain coverage, conclusion
			// signal, timeline completeness, chain diversity) across all scored
			// gold-standard traces. Per-query values are on each score.
			lineage: aggregateLineageMetrics(
				scores.map((s) => s.lineage).filter((m): m is LineageMetrics => m !== null),
			),
			// #311 (Phase 0e) — evidence-diversity averages. Computed over
			// applicable queries only (passing-only and overall) so the
			// autoresearch loop can detect retrieval narrowing — variants
			// that improve pass-rate while shrinking cross-source evidence.
			evidenceDiversity: aggregateDiversity(scores),
			// #311 (Phase 0d) — recall@K aggregate over queries that have a
			// goldSupportingSources mapping in the fixture (demo-critical
			// tier in v1.7.0). Reports the mean recall@K across those
			// queries plus the per-tier average for demo-critical.
			recallAtK: aggregateRecall(scores, activeQueries),
			// #320 — when WTFOC_QUERY_FILTER is set, surface the filter
			// state in metrics so analysts can see the run was a subset
			// (and not compare aggregate metrics directly to full-fixture
			// runs). `active: false` when no filter — analysts can ignore.
			queryFilter,
			// #311 (Phase 1a) — paraphrase invariance aggregate. Only
			// emitted when paraphrase checking ran. A query is "brittle"
			// when canonical passes but ≥1 paraphrase fails — directly
			// measures the memorization-not-retrieval risk peer-review
			// flagged at #311.
			paraphraseInvariance: aggregateParaphraseInvariance(scores),
		},
		checks,
	};
}

/**
 * Decide whether a query is inapplicable to the current corpus.
 * Returns a human-readable reason string when skipped, or null when applicable.
 *
 * Two gates:
 * 1. `collectionScopePattern` — query declares which corpora it targets.
 * 2. corpus source-type coverage — if the query requires a source type not
 *    ingested into the corpus, skip instead of failing (a coverage gap in
 *    the corpus is not a retrieval regression).
 */
function resolveSkip(gq: GoldStandardQuery, ctx: QualityQueriesContext): string | null {
	if (gq.collectionScopePattern && ctx.collectionId) {
		const re = new RegExp(gq.collectionScopePattern);
		if (!re.test(ctx.collectionId)) {
			return (
				gq.collectionScopeReason ??
				`collection "${ctx.collectionId}" does not match scope pattern ${gq.collectionScopePattern}`
			);
		}
	}
	if (ctx.corpusSourceTypes) {
		const missing = gq.requiredSourceTypes.filter((st) => !ctx.corpusSourceTypes?.has(st));
		if (missing.length > 0) {
			return `corpus lacks required source type(s): ${missing.join(", ")}`;
		}
	}
	return null;
}

interface DiversityAggregate {
	passingAvgDistinctDocs: number;
	passingAvgDistinctSourceTypes: number;
	applicableAvgDistinctDocs: number;
	applicableAvgDistinctSourceTypes: number;
	passingCount: number;
	applicableCount: number;
}

function avg(nums: number[]): number {
	if (nums.length === 0) return 0;
	const sum = nums.reduce((a, b) => a + b, 0);
	return sum / nums.length;
}

interface RecallAggregate {
	k: number | null;
	graded: number;
	avgRecallAtK: number;
	demoCriticalAvgRecallAtK: number;
	demoCriticalGraded: number;
}

function aggregateRecall(
	scores: QueryScore[],
	activeQueries: ReadonlyArray<GoldStandardQuery>,
): RecallAggregate {
	const graded = scores.filter((s) => !s.skipped && s.recallAtK !== null && s.recallK !== null);
	const demoCriticalIds = new Set(
		activeQueries.filter((q) => q.tier === "demo-critical").map((q) => q.id),
	);
	const demoCriticalGraded = graded.filter((s) => demoCriticalIds.has(s.id));
	const k = graded[0]?.recallK ?? null;
	return {
		k,
		graded: graded.length,
		avgRecallAtK: avg(graded.map((s) => s.recallAtK ?? 0)),
		demoCriticalAvgRecallAtK: avg(demoCriticalGraded.map((s) => s.recallAtK ?? 0)),
		demoCriticalGraded: demoCriticalGraded.length,
	};
}

interface ParaphraseInvarianceAggregate {
	checked: boolean;
	withParaphrases: number;
	allInvariant: number;
	brittle: number;
	invariantFraction: number;
}

function aggregateParaphraseInvariance(scores: QueryScore[]): ParaphraseInvarianceAggregate {
	const withP = scores.filter((s) => !s.skipped && s.paraphraseInvariant !== undefined);
	const allInvariant = withP.filter((s) => s.paraphraseInvariant === true).length;
	return {
		checked: withP.length > 0,
		withParaphrases: withP.length,
		allInvariant,
		brittle: withP.length - allInvariant,
		invariantFraction: withP.length > 0 ? allInvariant / withP.length : 0,
	};
}

function aggregateDiversity(scores: QueryScore[]): DiversityAggregate {
	const applicable = scores.filter((s) => !s.skipped);
	const passing = applicable.filter((s) => s.passed);
	return {
		passingAvgDistinctDocs: avg(passing.map((s) => s.distinctDocs)),
		passingAvgDistinctSourceTypes: avg(passing.map((s) => s.distinctSourceTypes)),
		applicableAvgDistinctDocs: avg(applicable.map((s) => s.distinctDocs)),
		applicableAvgDistinctSourceTypes: avg(applicable.map((s) => s.distinctSourceTypes)),
		passingCount: passing.length,
		applicableCount: applicable.length,
	};
}

function skippedScore(gq: GoldStandardQuery, reason: string): QueryScore {
	return {
		id: gq.id,
		category: gq.category,
		queryText: gq.queryText,
		skipped: true,
		skipReason: reason,
		passed: false,
		passedQueryOnly: false,
		resultCount: 0,
		requiredTypesFound: false,
		requiredTypesFoundQueryOnly: false,
		substringFound: true,
		edgeHopFound: true,
		crossSourceFound: true,
		sourceTypesReached: [],
		lineage: null,
		distinctDocs: 0,
		distinctSourceTypes: 0,
		recallAtK: null,
		recallK: null,
		topScore: null,
	};
}

interface InnerScore {
	passed: boolean;
	passedQueryOnly: boolean;
	resultCount: number;
	requiredTypesFound: boolean;
	requiredTypesFoundQueryOnly: boolean;
	substringFound: boolean;
	edgeHopFound: boolean;
	crossSourceFound: boolean;
	sourceTypesReached: string[];
	lineage: LineageMetrics | null;
	distinctDocs: number;
	distinctSourceTypes: number;
	recallAtK: number | null;
	recallK: number | null;
	/**
	 * Highest score in the query top-K (cosine similarity, etc). Captured
	 * for hard-negative scoring: a hard-negative fails if the retrieval
	 * surfaced ANY high-confidence result, regardless of count. Phase
	 * 1+ tightening of #311 (b).
	 */
	topScore: number | null;
	/**
	 * #334 — gold-source proximity diagnostic, when computed.
	 */
	goldProximity?: QueryScore["goldProximity"];
}

interface RetrievalOverrides {
	topK?: number;
	traceMaxPerSource?: number;
	traceMaxTotal?: number;
	traceMinScore?: number;
}

async function scoreText(
	queryText: string,
	gq: GoldStandardQuery,
	embedder: Embedder,
	vectorIndex: VectorIndex,
	segments: Segment[],
	signal?: AbortSignal,
	overlayEdges: Edge[] = [],
	reranker?: Reranker,
	autoRoute = false,
	diversityEnforce = false,
	overrides: RetrievalOverrides = {},
	recordGoldProximity = false,
): Promise<InnerScore> {
	const TOPK = overrides.topK ?? 10;
	const TRACE_MAX_PER_SOURCE = overrides.traceMaxPerSource ?? 3;
	const TRACE_MAX_TOTAL = overrides.traceMaxTotal ?? 15;
	const TRACE_MIN_SCORE = overrides.traceMinScore ?? 0.3;
	let resultCount = 0;
	let requiredTypesFound = false;
	// #261 — captured before trace rescue so we can report retrieval quality
	// independently of the graph-assisted pass rate.
	let requiredTypesFoundQueryOnly = false;
	let substringFound = true; // default true if no substrings specified
	let edgeHopFound = true; // default true if not required
	let crossSourceFound = true; // default true if not required
	const sourceTypesReached: string[] = [];
	let lineage: LineageMetrics | null = null;
	const distinctSources = new Set<string>();
	const distinctTypes = new Set<string>();
	let recallAtK: number | null = null;
	let recallK: number | null = null;
	let topScore: number | null = null;

	try {
		const boosts = autoRoute ? classifyQueryPersona(queryText).sourceTypeBoosts : undefined;
		// File-level gold queries (#286) get an automatic boost on file-summary
		// chunks (#287). Category-based rather than persona-classifier-based
		// because the gold fixture already tags intent explicitly. Value chosen
		// conservatively — enough to surface a well-matched file summary above
		// prose chunks, not so high that a weakly-matched summary outranks a
		// directly-relevant symbol chunk.
		const chunkLevelBoosts = gq.category === "file-level" ? { file: 1.4 } : undefined;

		const diversityOption = diversityEnforce ? { minScoreRatio: 0.65 } : undefined;

		// Query phase
		const qResult = await query(queryText, embedder, vectorIndex, {
			topK: TOPK,
			signal,
			reranker,
			sourceTypeBoosts: boosts,
			chunkLevelBoosts,
			...(diversityOption ? { diversityEnforce: diversityOption } : {}),
		});
		resultCount = qResult.results.length;
		for (const r of qResult.results) {
			distinctSources.add(r.source);
			distinctTypes.add(r.sourceType);
			if (typeof r.score === "number" && (topScore === null || r.score > topScore)) {
				topScore = r.score;
			}
		}

		const resultSourceTypes = new Set(qResult.results.map((r) => r.sourceType));
		requiredTypesFoundQueryOnly = gq.requiredSourceTypes.every((st) => resultSourceTypes.has(st));
		requiredTypesFound = requiredTypesFoundQueryOnly;

		if (gq.expectedSourceSubstrings) {
			const resultSources = qResult.results.map((r) => r.source);
			substringFound = gq.expectedSourceSubstrings.some((sub) =>
				resultSources.some((src) => src.toLowerCase().includes(sub.toLowerCase())),
			);
		}

		// #311 Phase 0d — recall@K against gold supporting sources.
		// Computed against query-stage top-K only (no trace rescue) so the
		// metric measures retrieval quality independently of the graph.
		if (gq.goldSupportingSources && gq.goldSupportingSources.length > 0) {
			const k = TOPK;
			const topKSources = qResult.results.slice(0, k).map((r) => r.source.toLowerCase());
			let matched = 0;
			for (const goldSub of gq.goldSupportingSources) {
				const subLower = goldSub.toLowerCase();
				if (topKSources.some((src) => src.includes(subLower))) matched++;
			}
			recallAtK = matched / gq.goldSupportingSources.length;
			recallK = k;
		}

		// Trace phase
		const tResult = await trace(queryText, embedder, vectorIndex, segments, {
			mode: "analytical",
			signal,
			overlayEdges: overlayEdges.length > 0 ? overlayEdges : undefined,
			reranker,
			sourceTypeBoosts: boosts,
			chunkLevelBoosts,
			maxPerSource: TRACE_MAX_PER_SOURCE,
			maxTotal: TRACE_MAX_TOTAL,
			minScore: TRACE_MIN_SCORE,
			...(diversityOption ? { diversityEnforce: diversityOption } : {}),
		});

		for (const st of tResult.stats.sourceTypes) sourceTypesReached.push(st);
		for (const hop of tResult.hops) {
			distinctSources.add(hop.source);
			distinctTypes.add(hop.sourceType);
		}

		lineage = computeLineageMetrics(tResult);

		// Re-check requiredSourceTypes against combined query + trace source types
		// Cross-source and synthesis queries often surface required types via trace, not query seeds
		const allReachedTypes = new Set([...resultSourceTypes, ...tResult.stats.sourceTypes]);
		requiredTypesFound = gq.requiredSourceTypes.every((st) => allReachedTypes.has(st));

		if (gq.requireEdgeHop) {
			edgeHopFound = tResult.stats.edgeHops > 0;
		}

		if (gq.requireCrossSourceHops) {
			crossSourceFound = tResult.stats.sourceTypes.length >= 2;
		}
	} catch {
		// Query/trace failure = no results
	}

	// Hard-negative scoring is INVERTED. A hard negative passes when
	// retrieval correctly does NOT pile on strong-looking false positives.
	// Two checks combined:
	//   1. resultCount < HARD_NEGATIVE_RESULT_CEILING — fewer false hits
	//   2. topScore < HARD_NEGATIVE_SCORE_CEILING — even if a couple
	//      results slip through, none should look high-confidence
	//
	// Reviewer (peer-review on Phase 1) flagged that count-only scoring
	// rewards "fewer but high-confidence false positives" — a strictly
	// worse failure mode. The score ceiling closes that loophole.
	//
	// Score ceiling chosen at 0.6 — empirically the boundary above which
	// vector cosine similarity on bge-base means the chunk is genuinely
	// on-topic. Tunable; a future PR can swap to a corpus-relative
	// percentile threshold if 0.6 turns out to be over- or under-tight.
	const HARD_NEGATIVE_RESULT_CEILING = 3;
	const HARD_NEGATIVE_SCORE_CEILING = 0.6;

	const hardNegativeNoStrongHits = topScore === null || topScore < HARD_NEGATIVE_SCORE_CEILING;

	const passed =
		gq.category === "hard-negative"
			? resultCount < HARD_NEGATIVE_RESULT_CEILING && hardNegativeNoStrongHits
			: resultCount >= gq.minResults &&
				requiredTypesFound &&
				substringFound &&
				edgeHopFound &&
				crossSourceFound;

	// Query-only pass: same criteria EXCEPT use the pre-trace requiredTypes check
	// and ignore edge-hop/cross-source requirements (those are inherently trace-assisted).
	const passedQueryOnly =
		gq.category === "hard-negative"
			? resultCount < HARD_NEGATIVE_RESULT_CEILING && hardNegativeNoStrongHits
			: resultCount >= gq.minResults && requiredTypesFoundQueryOnly && substringFound;

	let goldProximity: InnerScore["goldProximity"];
	if (
		recordGoldProximity &&
		!passed &&
		gq.goldSupportingSources &&
		gq.goldSupportingSources.length > 0
	) {
		try {
			const widerK = 50;
			const wider = await query(queryText, embedder, vectorIndex, {
				topK: widerK,
				signal,
				reranker,
				sourceTypeBoosts: autoRoute ? classifyQueryPersona(queryText).sourceTypeBoosts : undefined,
				chunkLevelBoosts: gq.category === "file-level" ? { file: 1.4 } : undefined,
				...(diversityEnforce ? { diversityEnforce: { minScoreRatio: 0.65 } } : {}),
			});
			let goldRank: number | null = null;
			let goldScore: number | null = null;
			for (let i = 0; i < wider.results.length; i++) {
				const r = wider.results[i];
				if (!r) continue;
				const src = r.source.toLowerCase();
				const matches = gq.goldSupportingSources.some((sub) => src.includes(sub.toLowerCase()));
				if (matches) {
					goldRank = i + 1;
					goldScore = typeof r.score === "number" ? r.score : null;
					break;
				}
			}
			const cutoffEntry = wider.results[TOPK - 1];
			const topKLastScore =
				cutoffEntry && typeof cutoffEntry.score === "number" ? cutoffEntry.score : null;
			goldProximity = {
				widerK,
				topKCutoff: TOPK,
				goldRank,
				goldScore,
				topKLastScore,
			};
		} catch {
			// best-effort diagnostic — never fail the score
		}
	}

	return {
		passed,
		passedQueryOnly,
		resultCount,
		requiredTypesFound,
		requiredTypesFoundQueryOnly,
		substringFound,
		edgeHopFound,
		crossSourceFound,
		sourceTypesReached,
		lineage,
		distinctDocs: distinctSources.size,
		distinctSourceTypes: distinctTypes.size,
		recallAtK,
		recallK,
		topScore,
		...(goldProximity ? { goldProximity } : {}),
	};
}

async function scoreQuery(
	gq: GoldStandardQuery,
	embedder: Embedder,
	vectorIndex: VectorIndex,
	segments: Segment[],
	signal?: AbortSignal,
	overlayEdges: Edge[] = [],
	reranker?: Reranker,
	autoRoute = false,
	diversityEnforce = false,
	checkParaphrases = false,
	overrides: RetrievalOverrides = {},
	recordGoldProximity = false,
): Promise<QueryScore> {
	const inner = await scoreText(
		gq.queryText,
		gq,
		embedder,
		vectorIndex,
		segments,
		signal,
		overlayEdges,
		reranker,
		autoRoute,
		diversityEnforce,
		overrides,
		recordGoldProximity,
	);

	let paraphraseScores: ParaphraseScore[] | undefined;
	let paraphraseInvariant: boolean | undefined;
	if (checkParaphrases && gq.paraphrases && gq.paraphrases.length > 0) {
		paraphraseScores = [];
		for (const p of gq.paraphrases) {
			const ps = await scoreText(
				p,
				gq,
				embedder,
				vectorIndex,
				segments,
				signal,
				overlayEdges,
				reranker,
				autoRoute,
				diversityEnforce,
				overrides,
			);
			paraphraseScores.push({ text: p, passed: ps.passed, passedQueryOnly: ps.passedQueryOnly });
		}
		paraphraseInvariant = inner.passed && paraphraseScores.every((p) => p.passed);
	}

	return {
		id: gq.id,
		category: gq.category,
		queryText: gq.queryText,
		...inner,
		...(paraphraseScores ? { paraphraseScores } : {}),
		...(paraphraseInvariant !== undefined ? { paraphraseInvariant } : {}),
	};
}
