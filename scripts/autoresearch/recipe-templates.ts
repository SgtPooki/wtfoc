/**
 * Stratified-template definitions for the gold-query authoring recipe
 * (#344 step 2). Variety comes from strata, not artistry — keep this set
 * intentionally small (12 templates). The recipe sampler pairs each
 * template with stratum-matched artifacts; the LLM then authors candidate
 * queries per pair.
 *
 * Editing rules:
 * - Templates are intent-shaped, not surface-shaped. "Find the
 *   implementation that closes this issue" — NOT "where is X.ts".
 * - `exampleSurface` is for the human reviewer, not the LLM prompt.
 *   Injecting it verbatim primes the model toward that phrasing and
 *   collapses paraphrase invariance.
 * - `appliesToStrata` is a soft filter — a partial-match against
 *   `Stratum`. Empty → applies to every stratum (rare).
 * - Adding a template here does not retroactively change existing gold
 *   queries; step-3 corpus-authoring runs pick up the new set on next run.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import type { QueryTemplate, Stratum } from "@wtfoc/search";

export const RECIPE_TEMPLATES: ReadonlyArray<QueryTemplate> = [
	// ── Lookup family ────────────────────────────────────────────────
	{
		id: "lookup-by-symbol",
		intent:
			"Surface the canonical implementation of a named symbol or concept that lives in a single artifact.",
		queryType: "lookup",
		difficulty: "easy",
		targetLayerHints: ["ranking"],
		appliesToStrata: [{ sourceType: "code" }],
		exampleSurface: "Where is the chunker's deduplication logic?",
	},
	{
		id: "lookup-doc-section",
		intent: "Find a specific topic or section inside a long-form doc.",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking", "ranking"],
		appliesToStrata: [
			{ sourceType: "markdown" },
			{ sourceType: "html" },
		],
		exampleSurface: "What does the spec say about CID encoding limits?",
	},
	{
		id: "lookup-discussion",
		intent:
			"Surface the original discussion thread (issue / PR comment) where a decision was first proposed.",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		appliesToStrata: [
			{ sourceType: "github-issue" },
			{ sourceType: "github-pr-comment" },
			{ sourceType: "slack-message" },
		],
		exampleSurface: "Which thread first proposed deferring re-embedding?",
	},

	// ── Trace family ─────────────────────────────────────────────────
	{
		id: "trace-issue-to-impl",
		intent:
			"Walk from a discussion artifact (issue / PR comment) to the code change that landed for it. Should require ≥1 edge hop.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		appliesToStrata: [
			{ sourceType: "github-issue", edgeType: "closes" },
			{ sourceType: "github-issue", edgeType: "references" },
			{ sourceType: "github-pr", edgeType: "closes" },
		],
		exampleSurface: "Which PR closed the issue about overlay-edge merge order?",
	},
	{
		id: "trace-impl-to-rationale",
		intent:
			"Reverse direction of trace-issue-to-impl: walk from a code artifact back to the discussion that motivated it.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		appliesToStrata: [{ sourceType: "code", edgeType: "closes" }],
		exampleSurface: "Why was this rate-limit constant changed?",
	},
	{
		id: "trace-cross-source",
		intent:
			"Question whose answer requires evidence from ≥2 source types — e.g. a Slack thread referenced in a PR description that closes a GitHub issue.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["trace"],
		exampleSurface:
			"How did the team decide between two competing chunking strategies?",
	},

	// ── Compare ───────────────────────────────────────────────────────
	{
		id: "compare-implementations",
		intent:
			"Compare two competing implementations or approaches that exist in different artifacts. Both must surface for the answer.",
		queryType: "compare",
		difficulty: "hard",
		targetLayerHints: ["ranking", "trace"],
		appliesToStrata: [{ sourceType: "code" }],
		exampleSurface:
			"What's the difference between the in-memory and disk-backed chunkers?",
	},

	// ── Howto / synthesis ─────────────────────────────────────────────
	{
		id: "howto-task",
		intent:
			"Open-ended question whose answer requires reading 2–3 artifacts and synthesizing a procedure.",
		queryType: "howto",
		difficulty: "medium",
		targetLayerHints: ["ranking", "trace"],
		exampleSurface: "How would I add a new SourceAdapter for X?",
	},

	// ── Temporal ──────────────────────────────────────────────────────
	{
		id: "temporal-when-changed",
		intent:
			"When did a documented behavior or contract change? Relies on commit timestamps + edge-extraction across versions.",
		queryType: "temporal",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		appliesToStrata: [{ sourceType: "code" }, { sourceType: "github-pr" }],
		exampleSurface: "When did chunker dedup change to per-segment?",
	},

	// ── Causal ────────────────────────────────────────────────────────
	{
		id: "causal-why",
		intent:
			"Question whose answer requires inferring a cause-effect chain across artifacts (issue → fix → regression note).",
		queryType: "causal",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		exampleSurface:
			"Why did segment-builder start emitting empty segments after the v0.4 release?",
	},

	// ── Entity resolution ─────────────────────────────────────────────
	{
		id: "entity-resolution-canonical",
		intent:
			"Same concept appears in multiple artifacts under different names; resolve which entries refer to the same canonical thing.",
		queryType: "entity-resolution",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		exampleSurface:
			"Which threads, issues, and code paths all refer to the 'piece-cid' concept?",
	},

	// ── Coverage / hard negative scaffold ─────────────────────────────
	{
		id: "lookup-rare-edge",
		intent:
			"Lookup that targets the rare-stratum tail — artifacts that participate in uncommon edge types. Tests that retrieval doesn't ignore the long-tail.",
		queryType: "lookup",
		difficulty: "hard",
		targetLayerHints: ["embedding", "ranking"],
		appliesToStrata: [{ rarity: "rare" }],
		exampleSurface:
			"Where is the encryption-at-rest policy declared for the storage backend?",
	},
];

/**
 * Filter templates that apply to a given stratum. A template applies when
 * its `appliesToStrata` is empty OR when ≥1 partial-match matches the
 * stratum's axis values. Used by the recipe-author driver to pick a
 * template set per sampled artifact.
 */
export function templatesForStratum(
	stratum: Pick<Stratum, "sourceType" | "edgeType" | "rarity">,
): ReadonlyArray<QueryTemplate> {
	return RECIPE_TEMPLATES.filter((t) => {
		if (!t.appliesToStrata || t.appliesToStrata.length === 0) return true;
		return t.appliesToStrata.some((p) => {
			if (p.sourceType && p.sourceType !== stratum.sourceType) return false;
			if (p.edgeType !== undefined && p.edgeType !== stratum.edgeType) return false;
			if (p.rarity && p.rarity !== stratum.rarity) return false;
			return true;
		});
	});
}
