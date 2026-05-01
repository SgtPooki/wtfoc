/**
 * Stratified-template recipe primitives for #344 step 2 (gold-query
 * regeneration). The legacy fixture used unstructured human-authored queries
 * with substring patterns that drift from real catalog ids; this module is
 * the foundation for the replacement: deterministic stratified sampling,
 * template-driven LLM authoring, and an adversarial filter that discards
 * queries vector-search alone solves.
 *
 * Three peer reviewers (codex/gemini/cursor) converged on this recipe in
 * round 3 (see `reference_peer_review_snapshots.md`):
 *
 *   1. Stratify the corpus by `(sourceType × edgeType × length × rarity)`.
 *   2. Apply 8–15 templates across strata. Variety from strata, not artistry.
 *   3. LLM generates candidate queries anchored to sampled spans.
 *   4. Human approves / edits / rejects — NOT human authors.
 *   5. Adversarial filter: discard any candidate whose required evidence is
 *      in top-3 of a plain vector search (too easy; doesn't exercise trace).
 *   6. Difficulty tags + per-template caps prevent overfitting the scaffold.
 *
 * This module ships **only** the deterministic primitives (stratification,
 * sampling, adversarial filter, types). The actual LLM authoring loop +
 * per-collection invocations land as separate per-collection PRs.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import type { GoldQuery, QueryType } from "./gold-standard-queries.js";

/** Bucket axis values used to key strata. */
export type LengthBucket = "short" | "medium" | "long";

/**
 * Stratum key. Strata are defined as the cartesian product of axis values
 * present in the corpus. The recipe targets ≥1 sample per (occupied)
 * stratum so generated queries cover the corpus shape evenly.
 */
export interface Stratum {
	sourceType: string;
	edgeType: string | null;
	lengthBucket: LengthBucket;
	/** "rare" if the (sourceType, edgeType) combo appears in <5% of catalog. */
	rarity: "common" | "rare";
}

/**
 * One source artifact + its measurable shape, used as input to stratified
 * sampling. Keep this minimal — concrete corpora may carry richer metadata
 * but the recipe should stay corpus-agnostic.
 */
export interface CatalogArtifact {
	artifactId: string;
	sourceType: string;
	/**
	 * Edge-types this artifact participates in (e.g. `imports`, `closes`,
	 * `references`). Empty/undefined for artifacts the graph builder hasn't
	 * touched yet.
	 */
	edgeTypes?: string[];
	/** Length in characters of the canonical chunk content. */
	contentLength: number;
}

/**
 * One template the LLM uses to generate candidate queries. Templates are
 * intent-shaped, not surface-shaped — "find the implementation that closes
 * this issue" not "where is X.ts".
 */
export interface QueryTemplate {
	id: string;
	intent: string;
	queryType: QueryType;
	/** Difficulty floor for queries authored from this template. */
	difficulty: GoldQuery["difficulty"];
	/** Layer hints to seed `targetLayerHints` on generated queries. */
	targetLayerHints: GoldQuery["targetLayerHints"];
	/**
	 * Strata this template is appropriate for. When empty, applies to every
	 * stratum — rare for a useful template; most templates target specific
	 * source-type/edge combinations.
	 */
	appliesToStrata?: Array<Partial<Stratum>>;
	/**
	 * Example surface form, for the human reviewer. NOT injected into the
	 * LLM prompt verbatim (would prime the candidates toward this phrasing).
	 */
	exampleSurface: string;
}

/**
 * One sample anchored in the catalog. The LLM-authoring step receives
 * `(template, sample)` pairs and emits one or more `CandidateQuery` records
 * per pair.
 */
export interface RecipeSample {
	stratum: Stratum;
	artifact: CatalogArtifact;
}

/**
 * One LLM-generated candidate query awaiting human review and adversarial
 * filtering. Shape mirrors `GoldQuery` so an approved candidate can drop
 * straight into `GOLD_STANDARD_QUERIES` after the filter passes.
 */
export interface CandidateQuery {
	template: QueryTemplate;
	stratum: Stratum;
	draft: Omit<GoldQuery, "id"> & { id?: string };
}

export interface SamplingOptions {
	/** Target samples per occupied stratum (default 2). */
	samplesPerStratum?: number;
	/** Length bucket boundaries in chars. Default: 0–800 / 800–4000 / 4000+. */
	lengthBuckets?: { short: number; medium: number };
	/**
	 * Rarity cutoff — `(sourceType, edgeType)` combos seen in less than this
	 * fraction of the catalog are tagged `rare`. Default 0.05.
	 */
	rarityFraction?: number;
	/** Deterministic RNG for sample selection. Defaults to `Math.random`. */
	rng?: () => number;
	/** Hard cap on total samples (defense against pathological strata). */
	maxTotalSamples?: number;
}

/** Classify content length into a bucket using configured boundaries. */
export function lengthBucketOf(length: number, opts: SamplingOptions = {}): LengthBucket {
	const buckets = opts.lengthBuckets ?? { short: 800, medium: 4000 };
	if (length < buckets.short) return "short";
	if (length < buckets.medium) return "medium";
	return "long";
}

/**
 * Compute the stratum each artifact falls into. An artifact with multiple
 * edge types yields multiple strata entries (one per edge-type, plus one
 * with `edgeType: null` for "no-edge-context" baseline).
 */
export function stratifyArtifacts(
	artifacts: ReadonlyArray<CatalogArtifact>,
	opts: SamplingOptions = {},
): Array<{ stratum: Stratum; artifact: CatalogArtifact }> {
	const rarityFraction = opts.rarityFraction ?? 0.05;
	const total = artifacts.length;
	if (total === 0) return [];

	// Pass 1: per (sourceType, edgeType) frequency for the rarity tag.
	const comboCount = new Map<string, number>();
	for (const a of artifacts) {
		const edges = a.edgeTypes && a.edgeTypes.length > 0 ? a.edgeTypes : [null];
		for (const e of edges) {
			const key = `${a.sourceType}::${e ?? ""}`;
			comboCount.set(key, (comboCount.get(key) ?? 0) + 1);
		}
	}

	// Pass 2: emit one row per (artifact, edgeType) cell.
	const out: Array<{ stratum: Stratum; artifact: CatalogArtifact }> = [];
	for (const a of artifacts) {
		const edges = a.edgeTypes && a.edgeTypes.length > 0 ? a.edgeTypes : [null];
		for (const e of edges) {
			const key = `${a.sourceType}::${e ?? ""}`;
			const count = comboCount.get(key) ?? 0;
			const rarity: Stratum["rarity"] = count / total < rarityFraction ? "rare" : "common";
			out.push({
				stratum: {
					sourceType: a.sourceType,
					edgeType: e,
					lengthBucket: lengthBucketOf(a.contentLength, opts),
					rarity,
				},
				artifact: a,
			});
		}
	}
	return out;
}

/** Group strata-tagged artifacts into a Map keyed by serialized Stratum. */
export function groupByStratum(
	rows: ReadonlyArray<{ stratum: Stratum; artifact: CatalogArtifact }>,
): Map<string, Array<{ stratum: Stratum; artifact: CatalogArtifact }>> {
	const out = new Map<string, Array<{ stratum: Stratum; artifact: CatalogArtifact }>>();
	for (const row of rows) {
		const key = stratumKey(row.stratum);
		const list = out.get(key) ?? [];
		list.push(row);
		out.set(key, list);
	}
	return out;
}

export function stratumKey(s: Stratum): string {
	return `${s.sourceType}::${s.edgeType ?? "_"}::${s.lengthBucket}::${s.rarity}`;
}

/**
 * Stratified sampling — pick `samplesPerStratum` artifacts from each
 * occupied stratum. Deterministic when `opts.rng` is supplied. Capped by
 * `maxTotalSamples` (default 1000) to defend against pathological corpora.
 */
export function sampleStratified(
	artifacts: ReadonlyArray<CatalogArtifact>,
	opts: SamplingOptions = {},
): RecipeSample[] {
	const samplesPer = opts.samplesPerStratum ?? 2;
	const cap = opts.maxTotalSamples ?? 1000;
	const rng = opts.rng ?? Math.random;
	const grouped = groupByStratum(stratifyArtifacts(artifacts, opts));
	const out: RecipeSample[] = [];
	for (const rows of grouped.values()) {
		// Fisher-Yates with the supplied RNG, then take prefix.
		const shuffled = [...rows];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			const a = shuffled[i];
			const b = shuffled[j];
			if (!a || !b) continue;
			shuffled[i] = b;
			shuffled[j] = a;
		}
		for (const row of shuffled.slice(0, samplesPer)) {
			out.push({ stratum: row.stratum, artifact: row.artifact });
			if (out.length >= cap) return out;
		}
	}
	return out;
}

export type RetrieveTopK = (
	queryText: string,
	k: number,
) => Promise<ReadonlyArray<{ artifactId: string }>>;

export interface AdversarialFilterOptions {
	/** Top-K to read from the retriever. Default 3 (peer-review consensus). */
	topK?: number;
	/**
	 * If `true`, log the retriever's top-K snapshot per discarded candidate
	 * so the human reviewer can audit why the filter rejected each.
	 */
	verbose?: boolean;
}

export interface AdversarialFilterResult {
	kept: CandidateQuery[];
	discarded: Array<{ candidate: CandidateQuery; reason: string }>;
}

/**
 * Adversarial filter. Discards a candidate when ≥1 of its `required:true`
 * artifacts appears in the retriever's top-K for the candidate's query
 * text. Such queries are too easy — vector search alone solves them — and
 * do not exercise the trace engine that wtfoc differentiates on.
 *
 * The retrieve fn is supplied by the caller so this module stays
 * corpus-agnostic and unit-testable. Production wiring passes a thin
 * adapter around the live `query()` from `@wtfoc/search`.
 */
export async function applyAdversarialFilter(
	candidates: ReadonlyArray<CandidateQuery>,
	retrieve: RetrieveTopK,
	opts: AdversarialFilterOptions = {},
): Promise<AdversarialFilterResult> {
	const topK = opts.topK ?? 3;
	const kept: CandidateQuery[] = [];
	const discarded: Array<{ candidate: CandidateQuery; reason: string }> = [];
	for (const c of candidates) {
		const queryText = c.draft.query;
		const required = c.draft.expectedEvidence.filter((e) => e.required).map((e) => e.artifactId);
		if (required.length === 0) {
			// No required evidence — cannot reason about adversarial difficulty;
			// keep with a note so downstream review sees it.
			kept.push(c);
			continue;
		}
		const hits = await retrieve(queryText, topK);
		const hitSet = new Set(hits.map((h) => h.artifactId));
		const easyMatch = required.find((id) => hitSet.has(id));
		if (easyMatch) {
			discarded.push({
				candidate: c,
				reason: `vector top-${topK} already contains required artifact "${easyMatch}" — query too easy`,
			});
		} else {
			kept.push(c);
		}
	}
	return { kept, discarded };
}
