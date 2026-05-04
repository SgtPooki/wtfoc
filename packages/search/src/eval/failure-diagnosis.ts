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
	| "gold-not-indexed"
	| "retrieved-not-ranked"
	| "missing-edge"
	| "answer-synthesis"
	| "hard-negative-violated";

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
}

/**
 * Diagnose a single failed query. Returns `null` when the query passed or was
 * skipped (skipped queries are not failures and don't need a diagnosis).
 */
export function diagnoseFailure(input: DiagnoseFailureInput): FailureDiagnosis | null {
	const { score, query, corpusId, preflightStatus } = input;
	if (score.skipped) return null;
	if (score.passed) return null;

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

	// Rule 3 — gold was not in the wider top-K. Either the chunk is not
	// indexed at all (chunking/ingest), or the embedder doesn't cluster it
	// near the query (embedding). Without a separate lexical-rank signal
	// we cannot distinguish chunking vs embedding deterministically — we
	// pin to `embedding` because it is the more common cause when gold is
	// in catalog but absent from wider retrieval; chunking-layer triage
	// can override this in step-5 patch-capsule selection.
	if (retrievedInWiderK === false) {
		return {
			queryId: query.id,
			corpusId: corpusId ?? null,
			failureClass: "gold-not-indexed",
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
	"gold-not-indexed",
	"retrieved-not-ranked",
	"missing-edge",
	"answer-synthesis",
	"hard-negative-violated",
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
