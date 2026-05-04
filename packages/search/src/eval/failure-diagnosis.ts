import type { PreflightStatus } from "./catalog-applicability-preflight.js";
import type { GoldQuery } from "./gold-standard-queries.js";

/**
 * Failure-classification layer for the autonomous-research loop (#344 step 3).
 *
 * For every failing gold query, emit a structured `FailureDiagnosis` that
 * pins the failure to a single pipeline layer. The LLM patch-proposer is
 * gated on this diagnosis: a "ranking-only" tier capsule cannot accept a
 * patch for a failure diagnosed as `chunking` or `fixture`. This is exactly
 * the gap that drove two no-op patches into review (#343 forensics) — the
 * proposer was patching ranking for failures that lived upstream.
 *
 * Rules-based (NO LLM in this layer). Inputs are the per-query `QueryScore`,
 * the source `GoldQuery`, and the corresponding preflight status for the
 * (query, corpus) pair. Output is `null` when the query passed (no diagnosis
 * needed) and a `FailureDiagnosis` object otherwise.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

/**
 * Pipeline layer the failure most likely lives in. The patch-proposer's
 * tier-staged allowlist (#344 step 5) maps these values to the file paths it
 * is permitted to edit per cycle.
 */
export type FailureLayer =
	| "fixture"
	| "ingest"
	| "chunking"
	| "embedding"
	| "edge-extraction"
	| "ranking"
	| "trace";

export type FailureClass =
	| "fixture-invalid"
	| "retrieval-miss"
	| "retrieved-not-ranked"
	| "missing-edge"
	| "answer-synthesis"
	| "hard-negative-violated"
	/**
	 * #364 — query passed all rubric criteria but exceeded the slow-query p95
	 * floor. Treated as a regression because the loop must reject patches that
	 * raise quality at unacceptable latency cost. Layer pinned to `ranking`
	 * by default; substage-aware routing (#364 follow-up) will refine to
	 * `embedding` / `chunking` / `trace` when per-substage per-query data is
	 * captured.
	 */
	| "slow-but-passing";

export interface DiagnosisEvidence {
	/**
	 * `true` if the catalog-applicability preflight confirmed ≥1 required
	 * artifact resolves in the corpus. `false` means the fixture itself is
	 * the bug — no retrieval change can fix this query on this corpus.
	 */
	goldInCatalog: boolean;
	/**
	 * `true` if the wider top-50 retrieval surfaced ≥1 gold artifact (i.e.
	 * `goldProximity.goldRank !== null`). `false` means the chunk is missing
	 * from the vector index entirely (ingest/chunking layer) or the embedder
	 * does not cluster it near the query (embedding layer).
	 *
	 * `null` when `goldProximity` is unavailable (recordGoldProximity was off
	 * or the query has no gold supporting set). The classifier downgrades
	 * confidence in that case.
	 */
	retrievedInWiderK: boolean | null;
	/**
	 * 1-indexed rank of the first gold hit in the wider candidate list. null
	 * when the gold did not appear, or proximity was not recorded.
	 */
	finalRank: number | null;
	/** True when `requiredSourceTypes` were satisfied (post-trace). */
	requiredTypesMet: boolean;
	/** True when `requireEdgeHop` was either not required or satisfied. */
	edgeHopsMet: boolean;
	/** True when `requireCrossSourceHops` was either not required or satisfied. */
	crossSourceMet: boolean;
	/** True when ≥1 `required:true` artifactId surfaced in retrieved sources. */
	substringFound: boolean;
	/** #344 D1 — true when ≥1 required artifactId exact-matched a retrieved `Chunk.documentId`. */
	documentIdFound?: boolean;
	/** True when canonical exact-match gate drove pass/fail (vs legacy substring). */
	evidenceGateCanonical?: boolean;
	/** Gold-source proximity context, when available. */
	goldRank: number | null;
	topKCutoff: number | null;
	widerK: number | null;
}

export interface FailureDiagnosis {
	queryId: string;
	corpusId: string | null;
	failureClass: FailureClass;
	layer: FailureLayer;
	evidence: DiagnosisEvidence;
}

/**
 * Minimal QueryScore-shaped input for diagnosis. Mirrors the relevant fields
 * of `quality-queries-evaluator.QueryScore` so this module does not have to
 * depend on the evaluator's internal types.
 */
export interface DiagnosisScoreInput {
	id: string;
	skipped?: boolean;
	passed: boolean;
	passedQueryOnly: boolean;
	resultCount: number;
	requiredTypesFound: boolean;
	substringFound: boolean;
	documentIdFound?: boolean;
	evidenceGateCanonical?: boolean;
	edgeHopFound: boolean;
	crossSourceFound: boolean;
	/** #364 — wall-clock per-query duration (ms). Used for `slow-but-passing`. */
	durationMs?: number;
	goldProximity?: {
		widerK: number;
		topKCutoff: number;
		goldRank: number | null;
		goldScore: number | null;
		topKLastScore: number | null;
	};
}

export interface DiagnoseFailureInput {
	score: DiagnosisScoreInput;
	query: GoldQuery;
	corpusId?: string;
	/**
	 * Result of the catalog-applicability preflight for this (query, corpus)
	 * pair. When `invalid`, the diagnosis short-circuits to `fixture-invalid`
	 * — no retrieval change can pass this query.
	 */
	preflightStatus?: PreflightStatus;
	/**
	 * #364 — wall-clock duration (ms) above which a passing query gets the
	 * `slow-but-passing` failure class. `undefined` disables the check
	 * (legacy behavior; passing queries return `null`).
	 */
	slowQueryFloorMs?: number;
}

/**
 * #364 — default p95 floor for the `slow-but-passing` class. Calibrated
 * against the production `noar_div_rrOff` baseline (per-query-total p95
 * ~4250ms): 8000ms catches reranker variants (~14000ms) and the
 * borderline `noar_nodiv_rrBge` (~7000ms) without firing on the noise
 * band of non-rerank variants.
 */
export const DEFAULT_SLOW_QUERY_FLOOR_MS = 8000;

/**
 * Diagnose a single query. Returns `null` for skipped queries and for
 * passing queries whose duration is within `slowQueryFloorMs`. A passing
 * query whose `durationMs` exceeds the floor is diagnosed as
 * `slow-but-passing` (#364) so the autoresearch loop can reject patches
 * that improve quality at unacceptable latency cost.
 */
export function diagnoseFailure(input: DiagnoseFailureInput): FailureDiagnosis | null {
	const { score, query, corpusId, preflightStatus, slowQueryFloorMs } = input;
	if (score.skipped) return null;

	// #364 — slow-but-passing: a query that satisfies all rubric criteria
	// but exceeded the per-query latency floor. Pinned to `ranking` layer
	// for now; substage-aware routing follows when per-query substage data
	// is captured.
	if (score.passed) {
		if (
			slowQueryFloorMs !== undefined &&
			typeof score.durationMs === "number" &&
			score.durationMs > slowQueryFloorMs
		) {
			return {
				queryId: query.id,
				corpusId: corpusId ?? null,
				failureClass: "slow-but-passing",
				layer: "ranking",
				evidence: {
					goldInCatalog: preflightStatus !== "invalid",
					retrievedInWiderK: null,
					finalRank: null,
					requiredTypesMet: score.requiredTypesFound,
					edgeHopsMet: score.edgeHopFound,
					crossSourceMet: score.crossSourceFound,
					substringFound: score.substringFound,
					documentIdFound: score.documentIdFound,
					evidenceGateCanonical: score.evidenceGateCanonical,
					goldRank: null,
					topKCutoff: null,
					widerK: null,
				},
			};
		}
		return null;
	}

	const goldRank = score.goldProximity?.goldRank ?? null;
	const widerK = score.goldProximity?.widerK ?? null;
	const topKCutoff = score.goldProximity?.topKCutoff ?? null;
	const retrievedInWiderK =
		score.goldProximity === undefined ? null : score.goldProximity.goldRank !== null;
	const goldInCatalog = preflightStatus !== "invalid";

	// #344 D1 — when the canonical exact-match gate is in force, evidence
	// pass/fail is `documentIdFound`. Otherwise the legacy substring gate
	// drives. Routing rules below consult the active signal so a substring-
	// only hit in a canonical query no longer masquerades as a pass.
	const evidencePass = score.evidenceGateCanonical
		? score.documentIdFound === true
		: score.substringFound;

	const evidence: DiagnosisEvidence = {
		goldInCatalog,
		retrievedInWiderK,
		finalRank: goldRank,
		requiredTypesMet: score.requiredTypesFound,
		edgeHopsMet: score.edgeHopFound,
		crossSourceMet: score.crossSourceFound,
		substringFound: score.substringFound,
		documentIdFound: score.documentIdFound,
		evidenceGateCanonical: score.evidenceGateCanonical,
		goldRank,
		topKCutoff,
		widerK,
	};

	// Rule 1 — preflight already flagged the fixture as invalid for this
	// corpus. No retrieval change can pass this query; diagnosis pins to the
	// fixture layer so the patch-proposer skips it entirely.
	if (preflightStatus === "invalid") {
		return {
			queryId: query.id,
			corpusId: corpusId ?? null,
			failureClass: "fixture-invalid",
			layer: "fixture",
			evidence,
		};
	}

	// Rule 2 — hard-negative inversion. A failed hard-negative means
	// retrieval surfaced strong-looking false positives. This is a
	// retrieve-not-ranked failure but with inverted intent — flag it
	// distinctly so the patch-proposer doesn't try to "fix" it by
	// surfacing more results.
	if (query.isHardNegative) {
		return {
			queryId: query.id,
			corpusId: corpusId ?? null,
			failureClass: "hard-negative-violated",
			layer: "ranking",
			evidence,
		};
	}

	// Rule 3 — gold artifact was recorded as absent from wider top-K
	// (retrievedInWiderK === false). Honest label is "retrieval-miss":
	// the artifact is in catalog but did NOT surface in widerK retrieval.
	// Could be chunking (not indexed), ingest (lifecycle dropped it), or
	// embedding (vectors don't cluster). Without a lexical-rank
	// disambiguation signal we cannot tell deterministically — pin to
	// `embedding` because empirically it is the dominant cause; the
	// step-5 patch-capsule can re-route to chunking when triage finds
	// missing chunks. Renamed from `gold-not-indexed` (#343 Phase A) so
	// the class label no longer overclaims certainty about the cause.
	if (retrievedInWiderK === false) {
		return {
			queryId: query.id,
			corpusId: corpusId ?? null,
			failureClass: "retrieval-miss",
			layer: "embedding",
			evidence,
		};
	}

	// Rule 4 — gold IS retrievable in widerK but ranked below the cutoff.
	// Pure ranking failure: a reranker / topK / boost change is the
	// minimum-blast-radius fix.
	if (
		retrievedInWiderK === true &&
		goldRank !== null &&
		topKCutoff !== null &&
		goldRank > topKCutoff
	) {
		return {
			queryId: query.id,
			corpusId: corpusId ?? null,
			failureClass: "retrieved-not-ranked",
			layer: "ranking",
			evidence,
		};
	}

	// Rule 5 — query-only passed but trace-rescued pass failed. The graph
	// did not contribute additional evidence the rubric required. Pin to
	// trace; if trace itself was empty (zero edges followed), step-5 may
	// re-route to edge-extraction.
	if (score.passedQueryOnly && !score.passed) {
		const layer: FailureLayer =
			query.requireEdgeHop && !score.edgeHopFound ? "edge-extraction" : "trace";
		return {
			queryId: query.id,
			corpusId: corpusId ?? null,
			failureClass: "missing-edge",
			layer,
			evidence,
		};
	}

	// Rule 6 — required types absent or evidence gate failed: ranking layer.
	// `evidencePass` is `documentIdFound` when canonical, `substringFound`
	// otherwise. Either way, gold IS in widerK (Rule 3 already exited) so
	// the failure is "retrieved but the right artifact didn't surface".
	if (!score.requiredTypesFound || !evidencePass) {
		return {
			queryId: query.id,
			corpusId: corpusId ?? null,
			failureClass: "retrieved-not-ranked",
			layer: "ranking",
			evidence,
		};
	}

	// Default — answer-synthesis. Required types met, gold artifacts seen,
	// but the trace assembly didn't reach the cross-source threshold or
	// some other rubric component failed. Pin to trace.
	return {
		queryId: query.id,
		corpusId: corpusId ?? null,
		failureClass: "answer-synthesis",
		layer: "trace",
		evidence,
	};
}

/**
 * Aggregate diagnosis output for a corpus. Used by the eval reporter and the
 * step-5 patch-capsule selector to decide which layer the LLM proposer is
 * permitted to edit on this cycle.
 */
export interface DiagnosisAggregate {
	totalFailures: number;
	byFailureClass: Record<FailureClass, number>;
	byLayer: Record<FailureLayer, number>;
	dominantLayer: FailureLayer | null;
	dominantLayerShare: number;
}

const ALL_FAILURE_CLASSES: FailureClass[] = [
	"fixture-invalid",
	"retrieval-miss",
	"retrieved-not-ranked",
	"missing-edge",
	"answer-synthesis",
	"hard-negative-violated",
	"slow-but-passing",
];
const ALL_LAYERS: FailureLayer[] = [
	"fixture",
	"ingest",
	"chunking",
	"embedding",
	"edge-extraction",
	"ranking",
	"trace",
];

export function aggregateDiagnoses(diagnoses: ReadonlyArray<FailureDiagnosis>): DiagnosisAggregate {
	const byFailureClass = Object.fromEntries(ALL_FAILURE_CLASSES.map((c) => [c, 0])) as Record<
		FailureClass,
		number
	>;
	const byLayer = Object.fromEntries(ALL_LAYERS.map((l) => [l, 0])) as Record<FailureLayer, number>;
	for (const d of diagnoses) {
		byFailureClass[d.failureClass]++;
		byLayer[d.layer]++;
	}
	let dominantLayer: FailureLayer | null = null;
	let dominantCount = 0;
	for (const l of ALL_LAYERS) {
		if (byLayer[l] > dominantCount) {
			dominantCount = byLayer[l];
			dominantLayer = l;
		}
	}
	return {
		totalFailures: diagnoses.length,
		byFailureClass,
		byLayer,
		dominantLayer,
		dominantLayerShare: diagnoses.length > 0 ? dominantCount / diagnoses.length : 0,
	};
}
