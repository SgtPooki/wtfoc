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
	topK: number;
}

export const FIXTURE_QUERIES: SearchFixtureQuery[] = [
	{
		queryText: "What changes were made recently?",
		expectedSourceTypes: ["github-pr", "github-issue", "code"],
		expectedSourceSubstrings: ["#", "github"],
		topK: 5,
	},
	{
		queryText: "What discussions happened about this project?",
		expectedSourceTypes: ["slack-message", "github-issue", "discord"],
		expectedSourceSubstrings: ["#", "slack", "discord"],
		topK: 5,
	},
	{
		queryText: "How does the code work?",
		expectedSourceTypes: ["code", "markdown", "doc"],
		expectedSourceSubstrings: [".ts", ".js", ".md", "/src/"],
		topK: 5,
	},
];
