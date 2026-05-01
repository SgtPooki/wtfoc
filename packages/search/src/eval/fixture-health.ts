/**
 * Fixture-health signals — corpus-level observations about what the gold
 * fixture can and cannot measure on a given collection. Orthogonal to
 * `FailureClass` (which is per-failed-query). The autonomous loop reads
 * both per cycle and decides whether to (a) patch ranking, (b) expand
 * fixture, or (c) both — independent caps.
 *
 * Layering (per #360 settled-spec synthesis):
 *
 *   Generation layer:
 *     `Stratum` (semantic + structural) → `recipe-author` → `CandidateQuery`
 *
 *   Validation-outcomes layer:
 *     `RejectReason` (#362) — populated by `recipe-validate` probe.
 *     `answerabilityState` — future LLM-grader; not in this slice.
 *
 *   Aggregation layer (this file):
 *     `CoverageReport` — per-stratum counts + uncovered strata + Gini.
 *     `FixtureHealthSignal` — corpus-level signal the loop routes on.
 *
 * Pure: no I/O. The eval runner computes `buildCoverageReport(...)` from
 * `(GOLD_STANDARD_QUERIES, DocumentCatalog, segments)` and emits it
 * alongside `DiagnosisAggregate`. Loop wiring + recipe-pipeline
 * integration land in subsequent slices.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/360
 */

import type { DocumentCatalog, Segment } from "@wtfoc/common";
import type { GoldQuery, QueryType } from "./gold-standard-queries.js";

/**
 * Operator family for structural-coverage analysis. Currently 1:1 with
 * `QueryType` plus `aggregation` (reserved; not in the gold set yet).
 * Kept as a separate type so the structural axis can evolve independently
 * from the on-disk fixture schema.
 */
export type OperatorFamily =
	| "lookup"
	| "trace"
	| "compare"
	| "temporal"
	| "causal"
	| "howto"
	| "entity-resolution"
	| "aggregation";

export interface SemanticStratumKey {
	sourceType: string;
	/** null = no edge requirement (lookup-style queries). */
	edgeType: string | null;
	queryType: QueryType;
}

export interface StructuralStratumKey {
	/** Estimated minimum hops the query exercises. 1 for lookup, ≥2 for trace family. */
	hopCount: number;
	/** True when the query requires evidence from >1 source type. */
	crossSource: boolean;
	operatorFamily: OperatorFamily;
}

export interface SemanticStratumCount {
	key: SemanticStratumKey;
	count: number;
}

export interface StructuralStratumCount {
	key: StructuralStratumKey;
	count: number;
}

export interface UncoveredStratum {
	key: SemanticStratumKey;
	/** Catalog artifacts in this stratum that have no gold query. */
	artifactsInCorpus: number;
}

export interface CoverageReport {
	/** Total gold queries scoped to this corpus. */
	totalQueries: number;
	/** Per-(sourceType, edgeType, queryType) cell counts. */
	semantic: SemanticStratumCount[];
	/** Per-(hopCount, crossSource, operatorFamily) cell counts. */
	structural: StructuralStratumCount[];
	/** Strata occupied by the corpus catalog/edges but absent from the fixture. */
	uncoveredStrata: UncoveredStratum[];
	/**
	 * Gini coefficient over per-semantic-stratum query counts. 0 = perfectly
	 * even distribution; 1 = all queries in one stratum. Empty fixture
	 * returns 0 (well-defined edge case, not a coverage failure).
	 */
	giniCoefficient: number;
}

export interface FixtureHealthSignal {
	collectionId: string;
	coverage: CoverageReport;
	/**
	 * True when `uncoveredStrata.length >= minUncovered` OR `gini >= giniFloor`.
	 * The autonomous loop reads this as "expand-fixture candidate," NOT a
	 * failure-class value (the layering distinction matters per #360).
	 */
	hasCoverageGap: boolean;
	thresholds: {
		giniFloor: number;
		minUncoveredStrata: number;
	};
}

/**
 * Map a `QueryType` to its `OperatorFamily`. Currently 1:1 (the families
 * superset the fixture-level enum), kept as a function so future families
 * (`aggregation`) can route via different `queryType` shapes without
 * rippling through call sites.
 */
export function inferOperatorFamily(queryType: QueryType): OperatorFamily {
	return queryType;
}

/**
 * Estimate the minimum edge-hop count a query exercises. `lookup` is 1
 * (single retrieval). `trace`/`causal` are ≥2 (one edge walk minimum).
 * `compare` is ≥2 (must surface ≥2 artifacts). Others default to 1 unless
 * the query carries multiple required artifacts, in which case the min is
 * `requiredArtifacts.length`.
 */
export function estimateHopCount(query: GoldQuery): number {
	const requiredArtifacts = query.expectedEvidence.filter((e) => e.required).length;
	const baseline = requiredArtifacts >= 2 ? requiredArtifacts : 1;
	switch (query.queryType) {
		case "lookup":
		case "entity-resolution":
		case "howto":
			return baseline;
		case "trace":
		case "causal":
		case "compare":
		case "temporal":
			return Math.max(2, baseline);
		default:
			return baseline;
	}
}

/** Whether a query requires evidence from more than one source type. */
export function isCrossSource(query: GoldQuery): boolean {
	return query.requiredSourceTypes.length > 1;
}

/**
 * Gini coefficient over a non-negative count distribution. Implemented via
 * the sorted formulation `G = (sum_i (2i - n - 1) * x_i) / (n * sum(x))`
 * where `x` is sorted ascending and `i` is 1-indexed. Returns 0 for empty
 * or all-zero inputs (no inequality definable).
 */
export function giniCoefficient(counts: ReadonlyArray<number>): number {
	if (counts.length === 0) return 0;
	const sorted = [...counts].sort((a, b) => a - b);
	const n = sorted.length;
	let total = 0;
	let weighted = 0;
	for (let i = 0; i < n; i++) {
		const v = sorted[i] ?? 0;
		total += v;
		weighted += (2 * (i + 1) - n - 1) * v;
	}
	if (total <= 0) return 0;
	return weighted / (n * total);
}

function semanticKeyEquals(a: SemanticStratumKey, b: SemanticStratumKey): boolean {
	return a.sourceType === b.sourceType && a.edgeType === b.edgeType && a.queryType === b.queryType;
}

function structuralKeyEquals(a: StructuralStratumKey, b: StructuralStratumKey): boolean {
	return (
		a.hopCount === b.hopCount &&
		a.crossSource === b.crossSource &&
		a.operatorFamily === b.operatorFamily
	);
}

/**
 * Derive the semantic stratum cell(s) a query occupies. A query may name
 * multiple required source types; emit one cell per (sourceType,
 * queryType) pair. `edgeType` is currently null (the gold schema does not
 * carry an explicit edge-type field); future schema bumps may surface it.
 */
function semanticStrataForQuery(query: GoldQuery): SemanticStratumKey[] {
	const sourceTypes =
		query.requiredSourceTypes.length > 0 ? query.requiredSourceTypes : ["unknown"];
	return sourceTypes.map((sourceType) => ({
		sourceType,
		edgeType: null,
		queryType: query.queryType,
	}));
}

function structuralStratumForQuery(query: GoldQuery): StructuralStratumKey {
	return {
		hopCount: estimateHopCount(query),
		crossSource: isCrossSource(query),
		operatorFamily: inferOperatorFamily(query.queryType),
	};
}

/**
 * Compute the coverage report for a corpus. Inputs:
 *
 *   - `queries` — gold queries scoped to this corpus (caller filters by
 *     `applicableCorpora` BEFORE calling; this function is corpus-agnostic).
 *   - `catalog` — corpus document catalog. Surfaces source-type cells
 *     present in the corpus that the fixture may not measure.
 *   - `segments` — surfaces edge-type cells via aggregated `Edge.type`.
 *
 * Pure: no I/O, deterministic given the inputs.
 */
export function buildCoverageReport(input: {
	queries: ReadonlyArray<GoldQuery>;
	catalog: DocumentCatalog;
	segments: ReadonlyArray<Segment>;
}): CoverageReport {
	const { queries, catalog, segments } = input;

	const semantic: SemanticStratumCount[] = [];
	const structural: StructuralStratumCount[] = [];

	for (const q of queries) {
		for (const key of semanticStrataForQuery(q)) {
			const existing = semantic.find((c) => semanticKeyEquals(c.key, key));
			if (existing) existing.count++;
			else semantic.push({ key, count: 1 });
		}
		const sKey = structuralStratumForQuery(q);
		const existing = structural.find((c) => structuralKeyEquals(c.key, sKey));
		if (existing) existing.count++;
		else structural.push({ key: sKey, count: 1 });
	}

	// Catalog occupancy: count documents per sourceType. Edge types come
	// from segments. The corpus "shape" is the cross-product of catalog
	// sourceTypes × {null, ...edgeTypes} × all queryTypes — that's an
	// over-broad upper bound, so we only flag uncovered cells where the
	// corpus actually has artifacts of the source type.
	const catalogSourceTypeCounts = new Map<string, number>();
	for (const doc of Object.values(catalog.documents)) {
		catalogSourceTypeCounts.set(
			doc.sourceType,
			(catalogSourceTypeCounts.get(doc.sourceType) ?? 0) + 1,
		);
	}

	const corpusEdgeTypes = new Set<string>();
	for (const seg of segments) {
		for (const edge of seg.edges) corpusEdgeTypes.add(edge.type);
	}

	// Per #360 acceptance criterion: surface uncovered (sourceType,
	// queryType) cells where the catalog has artifacts but the fixture has
	// zero gold queries. Edge dimension stays null in this slice — adding
	// it would require gold queries to carry an explicit `edgeType` field.
	const uncoveredStrata: UncoveredStratum[] = [];
	const allQueryTypes: QueryType[] = [
		"lookup",
		"trace",
		"compare",
		"temporal",
		"causal",
		"howto",
		"entity-resolution",
	];
	for (const [sourceType, artifactsInCorpus] of catalogSourceTypeCounts) {
		for (const queryType of allQueryTypes) {
			const key: SemanticStratumKey = { sourceType, edgeType: null, queryType };
			const covered = semantic.some((c) => semanticKeyEquals(c.key, key));
			if (!covered) uncoveredStrata.push({ key, artifactsInCorpus });
		}
	}

	const gini = giniCoefficient(semantic.map((c) => c.count));

	// `corpusEdgeTypes` is captured for future structural-edge expansion;
	// surfacing it now keeps the contract stable without a schema change.
	void corpusEdgeTypes;

	return {
		totalQueries: queries.length,
		semantic,
		structural,
		uncoveredStrata,
		giniCoefficient: gini,
	};
}

export const DEFAULT_GINI_FLOOR = 0.6;
export const DEFAULT_MIN_UNCOVERED_STRATA = 3;

/**
 * Wrap a `CoverageReport` in a routing-friendly signal. The autonomous
 * loop checks `hasCoverageGap` to decide whether to invoke the
 * recipe-author pipeline this cycle. Thresholds are env-tunable per
 * #360 spec (knob defaults match `WTFOC_RECIPE_GINI_FLOOR` /
 * `WTFOC_RECIPE_MIN_UNCOVERED_STRATA`).
 */
export function deriveFixtureHealthSignal(input: {
	collectionId: string;
	coverage: CoverageReport;
	giniFloor?: number;
	minUncoveredStrata?: number;
}): FixtureHealthSignal {
	const giniFloor = input.giniFloor ?? DEFAULT_GINI_FLOOR;
	const minUncoveredStrata = input.minUncoveredStrata ?? DEFAULT_MIN_UNCOVERED_STRATA;
	const hasCoverageGap =
		input.coverage.uncoveredStrata.length >= minUncoveredStrata ||
		input.coverage.giniCoefficient >= giniFloor;
	return {
		collectionId: input.collectionId,
		coverage: input.coverage,
		hasCoverageGap,
		thresholds: { giniFloor, minUncoveredStrata },
	};
}
