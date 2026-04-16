import type {
	Edge,
	Embedder,
	EvalCheck,
	EvalStageResult,
	Segment,
	VectorIndex,
} from "@wtfoc/common";
import { classifyQueryPersona } from "../persona/classify-query.js";
import { query } from "../query.js";
import { trace } from "../trace/trace.js";
import { aggregateLineageMetrics, computeLineageMetrics } from "./lineage-metrics.js";
import { FIXTURE_QUERIES } from "./search-eval-fixtures.js";

/**
 * Evaluate search and trace quality using canned test queries.
 *
 * `autoRoute`: when true, each query is classified through the persona
 * classifier and its boosts are applied. Use to measure whether soft
 * routing improves MRR on a real corpus (#265).
 */
export async function evaluateSearch(
	embedder: Embedder,
	vectorIndex: VectorIndex,
	segments: Segment[],
	signal?: AbortSignal,
	overlayEdges: Edge[] = [],
	autoRoute = false,
): Promise<EvalStageResult> {
	// Compute total source types in collection for coverage ratio (AC-US7-06)
	const collectionSourceTypes = new Set<string>();
	for (const seg of segments) {
		for (const chunk of seg.chunks) {
			if (chunk.sourceType) collectionSourceTypes.add(chunk.sourceType);
		}
	}

	// Sanity-check fixtures against the actual collection (#255). Warn if any
	// fixture's expectedSourceTypes are ALL absent from the collection — that
	// fixture can't score MRR > 0 no matter how good retrieval is.
	for (const fixture of FIXTURE_QUERIES) {
		const present = fixture.expectedSourceTypes.some((t) => collectionSourceTypes.has(t));
		if (!present && collectionSourceTypes.size > 0) {
			console.warn(
				`[search-eval] Fixture "${fixture.queryText}" expects sourceTypes ` +
					`[${fixture.expectedSourceTypes.join(", ")}] but none are present in the ` +
					`collection (has: ${[...collectionSourceTypes].join(", ")}). ` +
					`This fixture will always score MRR=0 — update fixtures or ingest the missing source types.`,
			);
		}
	}

	const startedAt = new Date().toISOString();
	const t0 = performance.now();

	const checks: EvalCheck[] = [];
	const queryResults: Array<Record<string, unknown>> = [];
	const traceResults: Array<Record<string, unknown>> = [];
	const perTraceLineage: ReturnType<typeof computeLineageMetrics>[] = [];

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
			const boosts = autoRoute
				? classifyQueryPersona(fixture.queryText).sourceTypeBoosts
				: undefined;
			const qResult = await query(fixture.queryText, embedder, vectorIndex, {
				topK: fixture.topK,
				signal,
				sourceTypeBoosts: boosts,
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

			// Source identity matching (AC-US7-03)
			const expectedIdentityFound = fixture.expectedSourceIdentity
				? fixture.expectedSourceIdentity.some((id) =>
						resultSources.some((src) => src.toLowerCase().includes(id.toLowerCase())),
					)
				: true;

			queryResults.push({
				query: fixture.queryText,
				resultCount,
				topScore,
				expectedSourceTypeFound: expectedFound,
				expectedSubstringFound,
				expectedIdentityFound,
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
				overlayEdges: overlayEdges.length > 0 ? overlayEdges : undefined,
			});

			totalHops += tResult.stats.totalHops;
			totalEdgeHops += tResult.stats.edgeHops;
			for (const st of tResult.stats.sourceTypes) allTraceSourceTypes.add(st);

			perTraceLineage.push(computeLineageMetrics(tResult));

			// Provenance quality: edge hops with both evidence and edgeType
			for (const hop of tResult.hops) {
				if (hop.connection.method === "edge") {
					totalEdgeHopsForProvenance++;
					if (hop.connection.evidence && hop.connection.edgeType) {
						totalProvenanceGood++;
					}
				}
			}

			// Evidence quality check per fixture (AC-US7-04)
			const hasTraceEvidence = tResult.hops.some(
				(hop) => hop.connection.method === "edge" && hop.connection.evidence,
			);

			traceResults.push({
				query: fixture.queryText,
				totalHops: tResult.stats.totalHops,
				edgeHops: tResult.stats.edgeHops,
				semanticHops: tResult.stats.semanticHops,
				sourceTypesReached: tResult.stats.sourceTypes.length,
				insightCount: tResult.stats.insightCount,
				hasTraceEvidence,
				requireTraceEvidence: fixture.requireTraceEvidence ?? false,
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

	// Trace quality checks — the core differentiator
	if (totalHops > 0 && edgeHopRatio === 0) {
		if (verdict !== "fail") verdict = "warn";
		checks.push({
			name: "trace:no-edge-hops",
			passed: false,
			actual: 0,
			expected: "> 0",
			detail: "Trace found 0 edge hops — graph is too sparse for edge-following",
		});
	}
	if (totalEdgeHopsForProvenance > 0 && provenanceQualityRate < 0.5) {
		if (verdict !== "fail") verdict = "warn";
		checks.push({
			name: "trace:low-provenance",
			passed: false,
			actual: Math.round(provenanceQualityRate * 100),
			expected: ">= 50%",
			detail: `Only ${Math.round(provenanceQualityRate * 100)}% of edge hops have evidence + edgeType`,
		});
	}

	// Source identity check
	const identityMissCount = (queryResults as Array<Record<string, unknown>>).filter(
		(qr) => qr.expectedIdentityFound === false,
	).length;
	if (identityMissCount > 0) {
		checks.push({
			name: "query:identity-miss",
			passed: false,
			actual: identityMissCount,
			detail: `${identityMissCount} queries failed source identity matching`,
		});
	}

	// Evidence requirement check
	const evidenceMissCount = (traceResults as Array<Record<string, unknown>>).filter(
		(tr) => tr.requireTraceEvidence === true && tr.hasTraceEvidence === false,
	).length;
	if (evidenceMissCount > 0) {
		checks.push({
			name: "trace:evidence-miss",
			passed: false,
			actual: evidenceMissCount,
			detail: `${evidenceMissCount} queries required trace evidence but had none`,
		});
	}

	const durationMs = Math.round(performance.now() - t0);

	const lineage = aggregateLineageMetrics(perTraceLineage);

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
			lineage,
			perTraceLineage,
		},
		checks,
	};
}
