/**
 * Test queries for search/trace evaluation.
 * Each query defines expected result properties using source substring matching
 * rather than exact chunk IDs (which change across ingests).
 */
export interface SearchFixtureQuery {
	queryText: string;
	/** At least one of these source types should appear in top-K results */
	expectedSourceTypes: string[];
	/** At least one result's source should contain one of these substrings */
	expectedSourceSubstrings?: string[];
	/**
	 * Specific source identity patterns — at least one result source must match.
	 * More precise than expectedSourceSubstrings: targets specific repos, issues, or files.
	 */
	expectedSourceIdentity?: string[];
	/**
	 * If true, at least one trace hop must have non-empty evidence.
	 * Catches regressions where edges lose provenance metadata.
	 */
	requireTraceEvidence?: boolean;
	topK: number;
}

/**
 * Note on expectedSourceTypes: values MUST match the sourceType strings
 * actually emitted by ingest adapters. Drift here silently produces
 * MRR=0 in dogfood runs and hides retrieval regressions (#255).
 *
 * Current emitted source types (keep this list in sync with adapters):
 *   Repo/file: code, markdown, tombstone
 *   GitHub:    github-issue, github-pr, github-pr-comment, github-discussion
 *   Chat:      slack-message, discord-message
 *   Web:       doc-page
 *   News:      hn-story, hn-comment
 */
export const FIXTURE_QUERIES: SearchFixtureQuery[] = [
	{
		queryText: "What changes were made recently?",
		expectedSourceTypes: ["github-pr", "github-pr-comment", "github-issue", "code", "markdown"],
		expectedSourceSubstrings: ["#", "github"],
		expectedSourceIdentity: ["#"],
		requireTraceEvidence: true,
		topK: 5,
	},
	{
		queryText: "What discussions happened about this project?",
		expectedSourceTypes: [
			"github-issue",
			"github-pr",
			"github-pr-comment",
			"github-discussion",
			"slack-message",
			"discord-message",
		],
		expectedSourceSubstrings: ["#", "slack", "discord"],
		expectedSourceIdentity: ["#", "slack", "discord"],
		requireTraceEvidence: true,
		topK: 5,
	},
	{
		queryText: "How does the code work?",
		expectedSourceTypes: ["code", "markdown", "doc-page"],
		expectedSourceSubstrings: [".ts", ".js", ".md", "/src/"],
		expectedSourceIdentity: ["/src/", ".ts"],
		requireTraceEvidence: true,
		topK: 5,
	},
];
