import type {
	Edge,
	Embedder,
	EvalCheck,
	EvalStageResult,
	Reranker,
	Segment,
	VectorIndex,
} from "@wtfoc/common";
import { query } from "../query.js";
import { trace } from "../trace/trace.js";
import { GOLD_STANDARD_QUERIES, type GoldStandardQuery } from "./gold-standard-queries.js";

interface QueryScore {
	id: string;
	category: string;
	queryText: string;
	passed: boolean;
	resultCount: number;
	requiredTypesFound: boolean;
	substringFound: boolean;
	edgeHopFound: boolean;
	crossSourceFound: boolean;
	sourceTypesReached: string[];
}

/**
 * Evaluate search quality against gold standard queries.
 * Runs each query via trace and scores against expected results.
 */
export async function evaluateQualityQueries(
	embedder: Embedder,
	vectorIndex: VectorIndex,
	segments: Segment[],
	signal?: AbortSignal,
	overlayEdges: Edge[] = [],
	reranker?: Reranker,
): Promise<EvalStageResult> {
	const startedAt = new Date().toISOString();
	const t0 = performance.now();
	const checks: EvalCheck[] = [];

	const scores: QueryScore[] = [];
	let passCount = 0;

	for (const gq of GOLD_STANDARD_QUERIES) {
		signal?.throwIfAborted();
		const score = await scoreQuery(
			gq,
			embedder,
			vectorIndex,
			segments,
			signal,
			overlayEdges,
			reranker,
		);
		scores.push(score);
		if (score.passed) passCount++;
	}

	const passRate = GOLD_STANDARD_QUERIES.length > 0 ? passCount / GOLD_STANDARD_QUERIES.length : 0;

	// Category breakdown
	const categories = ["direct-lookup", "cross-source", "coverage", "synthesis"] as const;
	const categoryBreakdown: Record<string, { total: number; passed: number; passRate: number }> = {};
	for (const cat of categories) {
		const catScores = scores.filter((s) => s.category === cat);
		const catPassed = catScores.filter((s) => s.passed).length;
		categoryBreakdown[cat] = {
			total: catScores.length,
			passed: catPassed,
			passRate: catScores.length > 0 ? catPassed / catScores.length : 0,
		};
	}

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
		summary: `${passCount}/${GOLD_STANDARD_QUERIES.length} gold queries passed (${Math.round(passRate * 100)}%)`,
		metrics: {
			passRate,
			passCount,
			totalQueries: GOLD_STANDARD_QUERIES.length,
			categoryBreakdown,
			scores,
		},
		checks,
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
): Promise<QueryScore> {
	let resultCount = 0;
	let requiredTypesFound = false;
	let substringFound = true; // default true if no substrings specified
	let edgeHopFound = true; // default true if not required
	let crossSourceFound = true; // default true if not required
	const sourceTypesReached: string[] = [];

	try {
		// Query phase
		const qResult = await query(gq.queryText, embedder, vectorIndex, {
			topK: 10,
			signal,
			reranker,
		});
		resultCount = qResult.results.length;

		const resultSourceTypes = new Set(qResult.results.map((r) => r.sourceType));
		requiredTypesFound = gq.requiredSourceTypes.every((st) => resultSourceTypes.has(st));

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
		});

		for (const st of tResult.stats.sourceTypes) sourceTypesReached.push(st);

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

	return {
		id: gq.id,
		category: gq.category,
		queryText: gq.queryText,
		passed,
		resultCount,
		requiredTypesFound,
		substringFound,
		edgeHopFound,
		crossSourceFound,
		sourceTypesReached,
	};
}
