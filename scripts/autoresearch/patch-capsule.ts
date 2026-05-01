/**
 * Tier-staged patch capsule selector for the autoresearch LLM proposer (#344
 * step 5). Maps `diagnosisAggregate.dominantLayer` to a layer-scoped patch
 * surface so the proposer can only edit files relevant to the diagnosed
 * failure layer. The frozen tier (graders, fixtures, scorer, runner, gold
 * paths) NEVER appears in any capsule — this is what stops the loop from
 * "fixing" a regression by relaxing the test.
 *
 * Tier hierarchy (per #344):
 *
 *   Tier 0 — graders/fixtures/scorer/runner  (FROZEN, never patchable)
 *   Tier 1 — query.ts, trace.ts, ranking weights / rerankers
 *   Tier 2 — chunking + segmentation + embedding namespaces
 *   Tier 3 — extractors + edge-type registry
 *   Tier 4 — ingest adapters + schemas        (HUMAN-ONLY, never patchable)
 *
 * Layer → capsule mapping:
 *
 *   fixture          -> null (Tier 4 / human; skip cycle)
 *   ingest           -> null (Tier 4 / human; skip cycle)
 *   ranking          -> Tier 1
 *   trace            -> Tier 1 (trace.ts already in Tier 1)
 *   embedding        -> Tier 1 + Tier 2
 *   chunking         -> Tier 1 + Tier 2
 *   edge-extraction  -> Tier 1 + Tier 3
 *
 * Why include Tier 1 alongside higher tiers: when diagnosis pins to chunking
 * or extraction, the ranking layer is often a co-conspirator (e.g. a chunk
 * boundary change interacts with type-boost weights). Letting the proposer
 * see both surfaces in the same capsule prevents "fix one layer, regress
 * another" oscillation that strict single-tier capsules would produce.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import type { FailureLayer } from "@wtfoc/search";

/** Numeric tier identifier — purely for documentation / debugging. */
export type Tier = 0 | 1 | 2 | 3 | 4;

export interface PatchCapsule {
	/** Layer the capsule was selected for (drives the tier set). */
	dominantLayer: FailureLayer;
	/** Tiers the LLM proposer may edit on this cycle (sorted ascending). */
	tiers: Tier[];
	/**
	 * Path prefixes the patch validator (`validatePatch.allowedPaths`)
	 * accepts on this cycle. The proposer's tools enforce these on the
	 * applied diff; the validator enforces them again on the proposal.
	 */
	allowedPaths: readonly string[];
	/**
	 * Files inlined verbatim into the LLM prompt (override the analyzer's
	 * `curatedFiles`). Keep small; the prompt budget is finite.
	 */
	curatedFiles: readonly string[];
	/** Short human-readable description for the proposal record / PR body. */
	description: string;
}

/**
 * Tier 0 — FROZEN. These paths never appear in any capsule. The validator
 * still uses the standard allowlist as a backstop, but the capsule selector
 * deliberately omits them so even a misconfigured allowlist cannot leak.
 */
export const TIER_0_FROZEN_PATHS: readonly string[] = [
	"packages/search/src/eval/",
	"scripts/autoresearch/decision.ts",
	"scripts/autoresearch/decision.test.ts",
	"scripts/autoresearch/headline.ts",
	"scripts/autoresearch/headline.test.ts",
	"scripts/dogfood.ts",
];

export const TIER_1_RANKING_PATHS: readonly string[] = [
	"packages/search/src/query.ts",
	"packages/search/src/trace/",
	"packages/search/src/rerankers/",
	"packages/search/src/persona/",
];

export const TIER_2_CHUNKING_EMBEDDING_PATHS: readonly string[] = [
	"packages/ingest/src/chunkers/",
	"packages/ingest/src/segment-builder.ts",
	"packages/search/src/embedders/",
	"packages/search/src/index/",
];

export const TIER_3_EXTRACTORS_PATHS: readonly string[] = [
	"packages/ingest/src/edges/",
	"packages/search/src/edge-resolution.ts",
];

/** Tier 1 default curated set (matches the analyzer's pre-#344 default). */
export const TIER_1_CURATED: readonly string[] = [
	"packages/search/src/query.ts",
	"packages/search/src/trace/trace.ts",
];

export const TIER_2_CURATED: readonly string[] = [
	"packages/search/src/query.ts",
	"packages/ingest/src/chunkers/index.ts",
	"packages/ingest/src/segment-builder.ts",
];

export const TIER_3_CURATED: readonly string[] = [
	"packages/search/src/query.ts",
	"packages/search/src/trace/trace.ts",
	"packages/search/src/edge-resolution.ts",
];

/**
 * Select a tier-staged patch capsule for the next LLM proposal cycle.
 *
 * Returns `null` when the diagnosed layer is human-only (`fixture` or
 * `ingest`). The autoresearch loop should skip patch generation for that
 * cycle and emit a triage marker instead — there is no LLM patch surface
 * that can fix a fixture or ingest-adapter problem without human review.
 */
export function selectPatchCapsule(dominantLayer: FailureLayer | null): PatchCapsule | null {
	if (dominantLayer === null) return null;
	switch (dominantLayer) {
		case "fixture":
		case "ingest":
			return null;
		case "ranking":
		case "trace":
			return {
				dominantLayer,
				tiers: [1],
				allowedPaths: TIER_1_RANKING_PATHS,
				curatedFiles: TIER_1_CURATED,
				description: `Tier 1 (ranking + trace) capsule — diagnosis pinned to "${dominantLayer}".`,
			};
		case "embedding":
		case "chunking":
			return {
				dominantLayer,
				tiers: [1, 2],
				allowedPaths: [...TIER_1_RANKING_PATHS, ...TIER_2_CHUNKING_EMBEDDING_PATHS],
				curatedFiles: TIER_2_CURATED,
				description: `Tier 1+2 (ranking + chunking/embedding) capsule — diagnosis pinned to "${dominantLayer}".`,
			};
		case "edge-extraction":
			return {
				dominantLayer,
				tiers: [1, 3],
				allowedPaths: [...TIER_1_RANKING_PATHS, ...TIER_3_EXTRACTORS_PATHS],
				curatedFiles: TIER_3_CURATED,
				description: `Tier 1+3 (ranking + extractors) capsule — diagnosis pinned to "edge-extraction".`,
			};
		default: {
			// Exhaustive switch — TS will flag if a new FailureLayer is added.
			const _exhaustive: never = dominantLayer;
			return _exhaustive;
		}
	}
}

/**
 * Assert that a capsule's `allowedPaths` does not overlap any Tier 0 frozen
 * path. Defensive — the selector should never produce one, but a regression
 * here is silent failure of the human-only invariant.
 */
export function assertNoFrozenLeak(capsule: PatchCapsule): void {
	for (const p of capsule.allowedPaths) {
		for (const frozen of TIER_0_FROZEN_PATHS) {
			if (p.startsWith(frozen) || frozen.startsWith(p)) {
				throw new Error(
					`patch-capsule: Tier 0 frozen path leak — capsule for layer "${capsule.dominantLayer}" exposes "${p}" which overlaps frozen prefix "${frozen}"`,
				);
			}
		}
	}
}
