/**
 * Programmatic recipe-pipeline orchestrator (#360 milestone 1e).
 *
 * Turns a `FixtureHealthSignal.uncoveredStrata` list into a concrete
 * codegen-ready set of new gold queries by chaining the existing
 * recipe-author + recipe-validate + recipe-apply primitives end-to-end.
 *
 * Designed for autonomous-loop's `runFixtureExpandPath` to call without
 * spawning a subprocess. The CLI counterparts (`scripts/autoresearch/
 * recipe-{author,validate,apply}.ts`) keep working unchanged for the
 * end-user persona; this module is the maintainer-loop entry point.
 *
 * Pipeline:
 *
 *   1. Pick top-N uncovered strata by `artifactsInCorpus` desc (capped
 *      at `2 * maxNew` for adversarial-filter headroom).
 *   2. For each stratum: sample one catalog artifact of the matching
 *      sourceType; pair with a `RECIPE_TEMPLATES` entry of the matching
 *      `queryType`.
 *   3. `authorCandidate` (live LLM) per pair.
 *   4. `applyAdversarialFilter` against the live retriever.
 *   5. `probeCandidate` + `classifyValidation` per surviving candidate.
 *   6. `selectKeepers` (default policy: keeper-candidate only).
 *   7. `validateStructural` + `codegenAuthoredQueries` for the splicer.
 *
 * The returned result is splice-ready when `structuralErrors.length === 0`
 * AND `kept.length > 0`. Caller decides whether to actually write the
 * file + open a draft PR (slice 1f).
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/360
 */

import type { DocumentCatalog, Embedder, Segment, VectorIndex } from "@wtfoc/common";
import {
	applyAdversarialFilter,
	type CandidateQuery,
	type CatalogArtifact,
	type FixtureHealthSignal,
	type QueryTemplate,
	type QueryType,
	type RecipeSample,
	type Stratum,
	stratifyArtifacts,
} from "@wtfoc/search";
import { buildLiveRetriever, buildStorageToDocMap } from "./recipe-adversarial-retriever.js";
import { templatesForStratum } from "./recipe-templates.js";
import {
	type ApplyEnrichedRecord,
	codegenAuthoredQueries,
	selectKeepers,
	type StructuralError,
	validateStructural,
} from "./recipe-apply.js";
import { authorCandidate } from "./recipe-llm-author.js";
import { buildExcerptMap } from "./recipe-segment-loader.js";
import {
	classifyValidation,
	probeCandidate,
	summarizeLabels,
	type ValidationLabel,
	type ValidationRecord,
} from "./recipe-validate.js";

export const DEFAULT_MAX_NEW_QUERIES_PER_RUN = 5;
const ADVERSARIAL_HEADROOM_FACTOR = 2;

export interface TargetedStratum {
	sourceType: string;
	queryType: QueryTemplate["queryType"];
	artifactsInCorpus: number;
}

export interface RunRecipePipelineInput {
	collectionId: string;
	fixtureHealth: FixtureHealthSignal;
	catalog: DocumentCatalog;
	segments: Segment[];
	vectorIndex: VectorIndex;
	embedder: Embedder;
	/**
	 * Cap on accepted queries per run. Defaults to
	 * `DEFAULT_MAX_NEW_QUERIES_PER_RUN` (5); the loop reads
	 * `WTFOC_RECIPE_MAX_NEW_QUERIES_PER_RUN` and threads it here.
	 */
	maxNew?: number;
	/**
	 * Multiplier for `maxNew` that the planner uses as its upper bound on
	 * planned `(sample, template)` pairs. Higher values give the
	 * adversarial filter + author + validate chain more discard headroom
	 * before the cap bites. Defaults to `ADVERSARIAL_HEADROOM_FACTOR` (2);
	 * the loop reads `WTFOC_RECIPE_ADVERSARIAL_HEADROOM` and threads it
	 * here when set.
	 */
	headroomFactor?: number;
	/** Live-author LLM endpoint overrides; falls back to env in `authorCandidate`. */
	authorOptions?: { llmUrl?: string; llmModel?: string; llmApiKey?: string };
	/** Pre-built excerpt map; if absent, derived from `segments`. */
	excerpts?: ReadonlyMap<string, string>;
	/** Random seed for stable sampling within a stratum (default: clock-derived). */
	seed?: number;
}

export interface RunRecipePipelineResult {
	collectionId: string;
	targetedStrata: TargetedStratum[];
	authoredCount: number;
	authorErrors: Array<{ template: string; artifactId: string; error: string }>;
	adversarialKept: number;
	adversarialDiscarded: number;
	validationCounts: Record<ValidationLabel, number>;
	records: ValidationRecord[];
	kept: ApplyEnrichedRecord[];
	structuralErrors: StructuralError[];
	/** Splice-ready TS when `structuralErrors.length === 0 && kept.length > 0`. */
	codegen: string | null;
}

/**
 * Single-pass conversion of `DocumentCatalog` → `CatalogArtifact[]`,
 * keyed for downstream `stratifyArtifacts` rarity computation. Only
 * `active` documents are emitted; superseded / archived entries are
 * dropped (they would confuse rarity counts on real corpora).
 */
function catalogToArtifactList(catalog: DocumentCatalog): CatalogArtifact[] {
	const out: CatalogArtifact[] = [];
	for (const [artifactId, doc] of Object.entries(catalog.documents)) {
		if (doc.state !== "active") continue;
		out.push({
			artifactId,
			sourceType: doc.sourceType,
			contentLength: doc.chunkIds.length * 1000,
		});
	}
	return out;
}

interface RarityRow {
	artifact: CatalogArtifact;
	stratum: Stratum;
}

/**
 * Group rarity-tagged rows by `sourceType` so the planner can pick a
 * random artifact per uncovered (sourceType, queryType) cell with the
 * correct rarity attached. `stratifyArtifacts` emits one row per
 * (artifact, edgeType) — when an artifact has no edge types it
 * collapses to a single `edgeType: null` row, which is what the
 * planner uses today (no edgeType-aware queries on the catalog side).
 */
function indexRarityBySourceType(rows: RarityRow[]): Map<string, RarityRow[]> {
	const out = new Map<string, RarityRow[]>();
	for (const r of rows) {
		// Keep the no-edge-context baseline only — matches buildSample's
		// `edgeType: null` synthesis. Edge-typed rows can be re-added
		// when the gold schema carries an edgeType axis.
		if (r.stratum.edgeType !== null) continue;
		const arr = out.get(r.artifact.sourceType) ?? [];
		arr.push(r);
		out.set(r.artifact.sourceType, arr);
	}
	return out;
}

/**
 * Pick a template that satisfies BOTH the uncovered stratum's `queryType`
 * AND the synthesized stratum's `sourceType` constraints. Falls back to a
 * sourceType-agnostic template (no `appliesToStrata`) when no source-typed
 * template matches; returns null when even that fails so the caller can
 * skip the stratum cleanly.
 *
 * Earlier (pre-peer-review) `pickTemplateForQueryType` matched on
 * `queryType` alone, which routed `github-issue/lookup` to the
 * code-only `lookup-by-symbol` template and fed nonsensical artifacts
 * to the LLM. This now mirrors `templatesForStratum`'s applicability
 * filter and adds the queryType constraint on top.
 */
function pickTemplateForStratum(
	stratum: Pick<Stratum, "sourceType" | "edgeType" | "rarity">,
	queryType: QueryType,
): QueryTemplate | null {
	// `templatesForStratum` already returns templates whose
	// `appliesToStrata` matches this stratum OR is empty (universal
	// fallback). All we need on top is the queryType filter.
	return templatesForStratum(stratum).find((t) => t.queryType === queryType) ?? null;
}

/**
 * Build a `RecipeSample` from a rarity-tagged row. The stratum already
 * carries the correct `(sourceType, edgeType, lengthBucket, rarity)`
 * tuple from `stratifyArtifacts`; no synthesis or hardcoding here.
 */
function buildSample(row: RarityRow): RecipeSample {
	return { stratum: row.stratum, artifact: row.artifact };
}

/**
 * Pure planner: maps `FixtureHealthSignal.uncoveredStrata` to concrete
 * `(sample, template)` pairs with no I/O. Exported so unit tests can pin
 * the routing without a live LLM. The orchestrator wraps this with the
 * adversarial-filter + validate + apply chain.
 */
export function planRecipeExpansion(input: {
	fixtureHealth: FixtureHealthSignal;
	catalog: DocumentCatalog;
	maxNew?: number;
	headroomFactor?: number;
	seed?: number;
}): {
	targetedStrata: TargetedStratum[];
	plannedPairs: Array<{ sample: RecipeSample; template: QueryTemplate }>;
} {
	const maxNew = input.maxNew ?? DEFAULT_MAX_NEW_QUERIES_PER_RUN;
	const headroomFactor = input.headroomFactor ?? ADVERSARIAL_HEADROOM_FACTOR;
	const headroom = maxNew * headroomFactor;
	const rng = seededRng(input.seed ?? 1);
	const sortedUncovered = [...input.fixtureHealth.coverage.uncoveredStrata].sort(
		(a, b) => b.artifactsInCorpus - a.artifactsInCorpus,
	);
	// Run stratifyArtifacts once over the full catalog so each artifact
	// carries the correct (sourceType, edgeType, lengthBucket, rarity)
	// tuple. Index by sourceType for the planner's per-cell pick.
	const artifacts = catalogToArtifactList(input.catalog);
	const stratifiedRows = stratifyArtifacts(artifacts);
	const rarityBySource = indexRarityBySourceType(stratifiedRows);
	const targetedStrata: TargetedStratum[] = [];
	const plannedPairs: Array<{ sample: RecipeSample; template: QueryTemplate }> = [];
	for (const u of sortedUncovered) {
		if (plannedPairs.length >= headroom) break;
		const candidates = rarityBySource.get(u.key.sourceType);
		if (!candidates || candidates.length === 0) continue;
		const idx = Math.floor(rng() * candidates.length) % candidates.length;
		const row = candidates[idx];
		if (!row) continue;
		const sample = buildSample(row);
		const template = pickTemplateForStratum(sample.stratum, u.key.queryType);
		if (!template) continue;
		plannedPairs.push({ sample, template });
		targetedStrata.push({
			sourceType: u.key.sourceType,
			queryType: u.key.queryType,
			artifactsInCorpus: u.artifactsInCorpus,
		});
	}
	return { targetedStrata, plannedPairs };
}

function seededRng(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

/**
 * End-to-end programmatic recipe pipeline. See module docstring for the
 * step-by-step. The function is `async` because each `authorCandidate`,
 * `probeCandidate` (via `query` + `trace`), and `applyAdversarialFilter`
 * call hits the live LLM / vector index.
 */
export async function runRecipePipeline(
	input: RunRecipePipelineInput,
): Promise<RunRecipePipelineResult> {
	const maxNew = input.maxNew ?? DEFAULT_MAX_NEW_QUERIES_PER_RUN;
	const validationCounts: Record<ValidationLabel, number> = {
		"keeper-candidate": 0,
		"trivial-suspect": 0,
		"needs-fix": 0,
		"human-review": 0,
		"auto-reject": 0,
	};

	const planInput: {
		fixtureHealth: FixtureHealthSignal;
		catalog: DocumentCatalog;
		maxNew: number;
		headroomFactor?: number;
		seed?: number;
	} = {
		fixtureHealth: input.fixtureHealth,
		catalog: input.catalog,
		maxNew,
	};
	if (input.headroomFactor !== undefined) planInput.headroomFactor = input.headroomFactor;
	if (input.seed !== undefined) planInput.seed = input.seed;
	const { targetedStrata, plannedPairs } = planRecipeExpansion(planInput);

	const excerpts = input.excerpts ?? buildExcerptMap(input.segments);

	// 2. Live LLM author per pair.
	const authored: CandidateQuery[] = [];
	const authorErrors: RunRecipePipelineResult["authorErrors"] = [];
	for (const p of plannedPairs) {
		const excerpt = excerpts.get(p.sample.artifact.artifactId);
		const r = await authorCandidate(p.sample, p.template, {
			collectionId: input.collectionId,
			...(input.authorOptions?.llmUrl ? { llmUrl: input.authorOptions.llmUrl } : {}),
			...(input.authorOptions?.llmModel ? { llmModel: input.authorOptions.llmModel } : {}),
			...(input.authorOptions?.llmApiKey ? { llmApiKey: input.authorOptions.llmApiKey } : {}),
			...(excerpt ? { excerpt } : {}),
		});
		if (r.ok && r.candidate) {
			authored.push(r.candidate);
		} else {
			authorErrors.push({
				template: p.template.id,
				artifactId: p.sample.artifact.artifactId,
				error: r.error ?? "unknown",
			});
		}
	}

	// 3. Adversarial filter — drop trivial cases.
	const retrieve = buildLiveRetriever({
		embedder: input.embedder,
		vectorIndex: input.vectorIndex,
		segments: input.segments,
	});
	const adversarial = await applyAdversarialFilter(authored, retrieve, { topK: 3 });

	// 4. Probe + classify each survivor.
	const storageToDoc = buildStorageToDocMap(input.segments);
	const records: ValidationRecord[] = [];
	for (const candidate of adversarial.kept) {
		try {
			const probe = await probeCandidate(candidate, {
				embedder: input.embedder,
				vectorIndex: input.vectorIndex,
				segments: input.segments,
				storageToDoc,
			});
			const { label, reasons } = classifyValidation(candidate, probe);
			records.push({ candidate, label, reasons, probe });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			records.push({
				candidate,
				label: "human-review",
				reasons: [{ code: "retrieval-failure", detail: `probe-error: ${msg.slice(0, 120)}` }],
				probe: {
					goldRank: null,
					widerK: 100,
					requiredTypeCoverage: false,
					traceHopCount: 0,
					goldReachedByTrace: false,
					topResults: [],
				},
			});
		}
	}
	Object.assign(validationCounts, summarizeLabels(records));

	// 5. selectKeepers (default policy: only keeper-candidate, no overrides).
	const enriched: ApplyEnrichedRecord[] = records.map((r) => ({ ...r }));
	const { keep } = selectKeepers(enriched, {
		includeHumanReview: false,
		includeNeedsFix: false,
		force: false,
	});
	const keptCapped = keep.slice(0, maxNew);

	// 6. Structural validation + codegen. The caller (autonomous-loop) decides
	//    whether to splice into gold-authored-queries.ts or just preview.
	const existingIds = new Set<string>();
	const structuralErrors = validateStructural(keptCapped, existingIds);
	const codegen =
		structuralErrors.length === 0 && keptCapped.length > 0
			? codegenAuthoredQueries(keptCapped)
			: null;

	return {
		collectionId: input.collectionId,
		targetedStrata,
		authoredCount: authored.length,
		authorErrors,
		adversarialKept: adversarial.kept.length,
		adversarialDiscarded: adversarial.discarded.length,
		validationCounts,
		records,
		kept: keptCapped,
		structuralErrors,
		codegen,
	};
}
