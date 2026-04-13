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

export const FIXTURE_QUERIES: SearchFixtureQuery[] = [
	{
		queryText: "What changes were made recently?",
		expectedSourceTypes: ["github-pr", "github-issue", "code"],
		expectedSourceSubstrings: ["#", "github"],
		expectedSourceIdentity: ["#"],
		requireTraceEvidence: true,
		topK: 5,
	},
	{
		queryText: "What discussions happened about this project?",
		expectedSourceTypes: ["slack-message", "github-issue", "discord"],
		expectedSourceSubstrings: ["#", "slack", "discord"],
		expectedSourceIdentity: ["#", "slack", "discord"],
		requireTraceEvidence: true,
		topK: 5,
	},
	{
		queryText: "How does the code work?",
		expectedSourceTypes: ["code", "markdown", "doc"],
		expectedSourceSubstrings: [".ts", ".js", ".md", "/src/"],
		expectedSourceIdentity: ["/src/", ".ts"],
		requireTraceEvidence: true,
		topK: 5,
	},
];
