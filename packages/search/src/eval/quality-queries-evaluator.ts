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
	GOLD_STANDARD_QUERIES,
	GOLD_STANDARD_QUERIES_VERSION,
	type GoldStandardQuery,
} from "./gold-standard-queries.js";
import {
	aggregateLineageMetrics,
	computeLineageMetrics,
	type LineageMetrics,
} from "./lineage-metrics.js";

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
): Promise<EvalStageResult> {
	const startedAt = new Date().toISOString();
	const t0 = performance.now();
	const checks: EvalCheck[] = [];

	const scores: QueryScore[] = [];
	let passCount = 0;
	let queryOnlyPassCount = 0;
	let skippedCount = 0;
	const skippedReasons: Array<{ id: string; reason: string }> = [];

	for (const gq of GOLD_STANDARD_QUERIES) {
		signal?.throwIfAborted();
		const skip = resolveSkip(gq, context);
		if (skip) {
			scores.push(skippedScore(gq, skip));
			skippedCount++;
			skippedReasons.push({ id: gq.id, reason: skip });
			continue;
		}
		const score = await scoreQuery(
			gq,
			embedder,
			vectorIndex,
			segments,
			signal,
			overlayEdges,
			reranker,
			autoRoute,
		);
		scores.push(score);
		if (score.passed) passCount++;
		if (score.passedQueryOnly) queryOnlyPassCount++;
	}

	const applicableTotal = GOLD_STANDARD_QUERIES.length - skippedCount;
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
		GOLD_STANDARD_QUERIES.filter((q) => q.tier === "demo-critical").map((q) => q.id),
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
			skippedCount,
			skippedReasons,
			/** Total queries in the fixture — includes skipped. */
			totalQueries: GOLD_STANDARD_QUERIES.length,
			categoryBreakdown,
			tierBreakdown,
			scores,
			// #217 — aggregate lineage trace quality (chain coverage, conclusion
			// signal, timeline completeness, chain diversity) across all scored
			// gold-standard traces. Per-query values are on each score.
			lineage: aggregateLineageMetrics(
				scores.map((s) => s.lineage).filter((m): m is LineageMetrics => m !== null),
			),
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
): Promise<QueryScore> {
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

	try {
		const boosts = autoRoute ? classifyQueryPersona(gq.queryText).sourceTypeBoosts : undefined;
		// File-level gold queries (#286) get an automatic boost on file-summary
		// chunks (#287). Category-based rather than persona-classifier-based
		// because the gold fixture already tags intent explicitly. Value chosen
		// conservatively — enough to surface a well-matched file summary above
		// prose chunks, not so high that a weakly-matched summary outranks a
		// directly-relevant symbol chunk.
		const chunkLevelBoosts = gq.category === "file-level" ? { file: 1.4 } : undefined;

		// Query phase
		const qResult = await query(gq.queryText, embedder, vectorIndex, {
			topK: 10,
			signal,
			reranker,
			sourceTypeBoosts: boosts,
			chunkLevelBoosts,
		});
		resultCount = qResult.results.length;

		const resultSourceTypes = new Set(qResult.results.map((r) => r.sourceType));
		requiredTypesFoundQueryOnly = gq.requiredSourceTypes.every((st) => resultSourceTypes.has(st));
		requiredTypesFound = requiredTypesFoundQueryOnly;

		if (gq.expectedSourceSubstrings) {
			const resultSources = qResult.results.map((r) => r.source);
			substringFound = gq.expectedSourceSubstrings.some((sub) =>
				resultSources.some((src) => src.toLowerCase().includes(sub.toLowerCase())),
			);
		}

		// Trace phase
		const tResult = await trace(gq.queryText, embedder, vectorIndex, segments, {
			mode: "analytical",
			signal,
			overlayEdges: overlayEdges.length > 0 ? overlayEdges : undefined,
			reranker,
			sourceTypeBoosts: boosts,
			chunkLevelBoosts,
		});

		for (const st of tResult.stats.sourceTypes) sourceTypesReached.push(st);

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

	const passed =
		resultCount >= gq.minResults &&
		requiredTypesFound &&
		substringFound &&
		edgeHopFound &&
		crossSourceFound;

	// Query-only pass: same criteria EXCEPT use the pre-trace requiredTypes check
	// and ignore edge-hop/cross-source requirements (those are inherently trace-assisted).
	const passedQueryOnly =
		resultCount >= gq.minResults && requiredTypesFoundQueryOnly && substringFound;

	return {
		id: gq.id,
		category: gq.category,
		queryText: gq.queryText,
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
	};
}
