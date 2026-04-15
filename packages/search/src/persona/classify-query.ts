/**
 * Query → persona classifier (#259).
 *
 * Rule-based per Codex review — deterministic and small-taxonomy. Each
 * persona maps to include/exclude source-type filters that callers pass
 * to `query()` or `trace()` to focus retrieval. Unmatched queries fall
 * back to the `open-ended` persona (no filter) so every query gets a
 * fair, unfiltered baseline.
 *
 * Design principles (Codex review):
 *   - Start with a small persona count.
 *   - Always keep an unfiltered fallback.
 *   - Deterministic: same input → same output, no time-dependent state.
 *   - Rules encode RETRIEVAL intent, not ANSWER intent.
 */

export type QueryPersona = "technical" | "discussion" | "changes" | "docs" | "open-ended";

export interface PersonaClassification {
	persona: QueryPersona;
	/**
	 * Legacy hard-filter — kept for back-compat and explicit opt-in. Callers
	 * that want never-drop soft routing should use `sourceTypeBoosts` instead.
	 */
	includeSourceTypes?: string[];
	/** Legacy hard-filter (see includeSourceTypes note). */
	excludeSourceTypes?: string[];
	/**
	 * Soft-routing multipliers per source type (#265). Passed to `query()` /
	 * `trace()` as `sourceTypeBoosts`. Results are never dropped — boosts
	 * just reorder the top-k. Missing source types default to 1.0.
	 */
	sourceTypeBoosts?: Record<string, number>;
	/** Short human-readable rationale for observability. */
	reason: string;
}

// Rule order matters — more specific persona rules should come first so they
// win over more general ones (e.g. "what do the docs SAY ABOUT X" should
// classify as docs, not discussion, even though the discussion rule has a
// "say about" matcher).
const RULES: Array<{
	persona: Exclude<QueryPersona, "open-ended">;
	matchers: RegExp[];
	includeSourceTypes?: string[];
	excludeSourceTypes?: string[];
	/** #265 — soft routing multipliers (preferred path). */
	sourceTypeBoosts?: Record<string, number>;
}> = [
	{
		persona: "docs",
		matchers: [
			/\bdocs? (?:say|describe|explain|cover)\b/i,
			/\bwhat do the docs\b/i,
			/\bdocumentation (?:for|on|about)\b/i,
			/\bin the documentation\b/i,
			/\brefer(?:ence)? docs?\b/i,
		],
		includeSourceTypes: ["doc-page", "markdown"],
		sourceTypeBoosts: { "doc-page": 1.3, markdown: 1.2 },
	},
	{
		persona: "discussion",
		matchers: [
			/\bdiscuss(?:ed|es|ing|ion|ions)?\b/i,
			/\bdebate(?:d|s)?\b/i,
			/\bargu(?:e|ed|es|ing|ments?)\b/i,
			/\bconversation\b/i,
			/\bpeople (?:say|said|think)\b/i,
			/\bsay(?:ing)? about\b/i,
			/\bopinions?\b/i,
		],
		includeSourceTypes: [
			"github-issue",
			"github-pr",
			"github-pr-comment",
			"github-discussion",
			"slack-message",
			"discord-message",
		],
		sourceTypeBoosts: {
			"github-pr-comment": 1.4,
			"github-issue": 1.3,
			"github-discussion": 1.3,
			"slack-message": 1.2,
			"discord-message": 1.2,
			"doc-page": 0.7,
		},
	},
	{
		persona: "changes",
		matchers: [
			/\bwhat changed\b/i,
			/\bwhat (?:was|were) (?:changed|modified|updated)\b/i,
			/\brecent(?:ly)? (?:chang|updat)/i,
			/\bfix(?:ed|es)?\b/i,
			/\bbug (?:fixes?|fixed)\b/i,
			/\breleases?\b/i,
			/\blast release\b/i,
			/\bchangelog\b/i,
		],
		includeSourceTypes: ["github-pr", "github-issue", "markdown", "code"],
		sourceTypeBoosts: {
			"github-pr": 1.3,
			"github-pr-comment": 1.1,
			markdown: 1.1,
			"doc-page": 0.8,
		},
	},
	{
		persona: "technical",
		matchers: [
			/\bhow does?\b/i,
			/\bhow is\b/i,
			/\bhow do\b/i,
			/\bimplement(?:ed|ation|s)?\b/i,
			/\bfunction(?:s|ality)?\b/i,
			/\balgorithm\b/i,
			/\barchitect(?:ure|ed)\b/i,
			/\bcode (?:work|path|flow)\b/i,
		],
		includeSourceTypes: ["code", "markdown"],
		excludeSourceTypes: ["doc-page"],
		sourceTypeBoosts: { code: 1.3, markdown: 1.1, "doc-page": 0.6 },
	},
];

export function classifyQueryPersona(queryText: string): PersonaClassification {
	const text = queryText.trim();
	for (const rule of RULES) {
		for (const matcher of rule.matchers) {
			if (matcher.test(text)) {
				const out: PersonaClassification = {
					persona: rule.persona,
					reason: `matched ${rule.persona} rule: ${matcher.source}`,
				};
				if (rule.includeSourceTypes) out.includeSourceTypes = [...rule.includeSourceTypes];
				if (rule.excludeSourceTypes) out.excludeSourceTypes = [...rule.excludeSourceTypes];
				if (rule.sourceTypeBoosts) out.sourceTypeBoosts = { ...rule.sourceTypeBoosts };
				return out;
			}
		}
	}
	return {
		persona: "open-ended",
		reason: "no rule matched — defaulting to unfiltered retrieval",
	};
}
