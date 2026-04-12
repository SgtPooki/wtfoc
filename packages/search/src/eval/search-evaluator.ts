import type { Embedder, EvalCheck, EvalStageResult, Segment, VectorIndex } from "@wtfoc/common";
import { query } from "../query.js";
import { trace } from "../trace/trace.js";
import { FIXTURE_QUERIES } from "./search-eval-fixtures.js";

/**
 * Evaluate search and trace quality using canned test queries.
 */
export async function evaluateSearch(
	embedder: Embedder,
	vectorIndex: VectorIndex,
	segments: Segment[],
	signal?: AbortSignal,
): Promise<EvalStageResult> {
	// Compute total source types in collection for coverage ratio (AC-US7-06)
	const collectionSourceTypes = new Set<string>();
	for (const seg of segments) {
		for (const chunk of seg.chunks) {
			if (chunk.sourceType) collectionSourceTypes.add(chunk.sourceType);
		}
	}
	const startedAt = new Date().toISOString();
	const t0 = performance.now();

	const checks: EvalCheck[] = [];
	const queryResults: Array<Record<string, unknown>> = [];
	const traceResults: Array<Record<string, unknown>> = [];

	let totalQueryResults = 0;
	let reciprocalRankSum = 0;
	let totalEdgeHops = 0;
	let totalHops = 0;
	let totalProvenanceGood = 0;
	let totalEdgeHopsForProvenance = 0;
	const allTraceSourceTypes = new Set<string>();

	for (const fixture of FIXTURE_QUERIES) {
		signal?.throwIfAborted();

		// Query eval
		try {
			const qResult = await query(fixture.queryText, embedder, vectorIndex, {
				topK: fixture.topK,
				signal,
			});

			const resultCount = qResult.results.length;
			totalQueryResults += resultCount;
			const topScore = resultCount > 0 ? (qResult.results[0]?.score ?? 0) : 0;
			const resultSourceTypes = qResult.results.map((r) => r.sourceType);
			const expectedFound = fixture.expectedSourceTypes.some((st) =>
				resultSourceTypes.includes(st),
			);

			// Reciprocal rank: find first result matching expected source type
			let rr = 0;
			for (let i = 0; i < qResult.results.length; i++) {
				const resultItem = qResult.results[i];
				if (resultItem && fixture.expectedSourceTypes.includes(resultItem.sourceType)) {
					rr = 1 / (i + 1);
					break;
				}
			}
			reciprocalRankSum += rr;

			// Source substring matching (AC-US7-02)
			const resultSources = qResult.results.map((r) => r.source);
			const expectedSubstringFound = fixture.expectedSourceSubstrings
				? fixture.expectedSourceSubstrings.some((sub) =>
						resultSources.some((src) => src.toLowerCase().includes(sub.toLowerCase())),
					)
				: true;

			queryResults.push({
				query: fixture.queryText,
				resultCount,
				topScore,
				expectedSourceTypeFound: expectedFound,
				expectedSubstringFound,
				reciprocalRank: rr,
			});
		} catch {
			queryResults.push({
				query: fixture.queryText,
				resultCount: 0,
				topScore: 0,
				expectedSourceTypeFound: false,
				reciprocalRank: 0,
				error: true,
			});
		}

		// Trace eval
		try {
			const tResult = await trace(fixture.queryText, embedder, vectorIndex, segments, {
				mode: "analytical",
				signal,
			});

			totalHops += tResult.stats.totalHops;
			totalEdgeHops += tResult.stats.edgeHops;
			for (const st of tResult.stats.sourceTypes) allTraceSourceTypes.add(st);

			// Provenance quality: edge hops with both evidence and edgeType
			for (const hop of tResult.hops) {
				if (hop.connection.method === "edge") {
					totalEdgeHopsForProvenance++;
					if (hop.connection.evidence && hop.connection.edgeType) {
						totalProvenanceGood++;
					}
				}
			}

			traceResults.push({
				query: fixture.queryText,
				totalHops: tResult.stats.totalHops,
				edgeHops: tResult.stats.edgeHops,
				semanticHops: tResult.stats.semanticHops,
				sourceTypesReached: tResult.stats.sourceTypes.length,
				insightCount: tResult.stats.insightCount,
			});
		} catch {
			traceResults.push({
				query: fixture.queryText,
				totalHops: 0,
				edgeHops: 0,
				semanticHops: 0,
				sourceTypesReached: 0,
				insightCount: 0,
				error: true,
			});
		}
	}

	const mrr = FIXTURE_QUERIES.length > 0 ? reciprocalRankSum / FIXTURE_QUERIES.length : 0;

	const edgeHopRatio = totalHops > 0 ? totalEdgeHops / totalHops : 0;

	const provenanceQualityRate =
		totalEdgeHopsForProvenance > 0 ? totalProvenanceGood / totalEdgeHopsForProvenance : 0;

	// Verdict
	let verdict: "pass" | "warn" | "fail" = "pass";
	if (totalQueryResults === 0) {
		verdict = "fail";
		checks.push({
			name: "query:all-empty",
			passed: false,
			actual: 0,
			detail: "All queries returned 0 results",
		});
	} else if (mrr < 0.3) {
		verdict = "warn";
		checks.push({
			name: "query:low-mrr",
			passed: false,
			actual: Math.round(mrr * 1000) / 1000,
			expected: 0.3,
			detail: `MRR ${mrr.toFixed(3)} below 0.3 threshold`,
		});
	}

	const durationMs = Math.round(performance.now() - t0);

	return {
		stage: "search",
		startedAt,
		durationMs,
		verdict,
		summary: `MRR=${mrr.toFixed(2)}, edge-hop ratio=${edgeHopRatio.toFixed(2)}, ${allTraceSourceTypes.size} source types reached`,
		metrics: {
			queryResults,
			traceResults,
			meanReciprocalRank: mrr,
			edgeHopRatio,
			provenanceQualityRate,
			sourceTypeCoverage:
				collectionSourceTypes.size > 0 ? allTraceSourceTypes.size / collectionSourceTypes.size : 0,
		},
		checks,
	};
}
