/**
 * Gold standard queries for dogfood evaluation.
 * Spans: direct lookup, cross-source tracing, coverage analysis, and synthesis.
 * Designed to work across collections (wtfoc, filoz-ecosystem, etc.).
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/232
 */

export interface GoldStandardQuery {
	/** Unique identifier for this query */
	id: string;
	/** The query text to search/trace */
	queryText: string;
	/** Category: direct-lookup | cross-source | coverage | synthesis */
	category: "direct-lookup" | "cross-source" | "coverage" | "synthesis";
	/** Source types that MUST appear in query results OR trace hops for the query to pass */
	requiredSourceTypes: string[];
	/** Substrings that should appear in at least one result source */
	expectedSourceSubstrings?: string[];
	/** Minimum number of results expected */
	minResults: number;
	/** If true, trace must find at least one edge hop (not just semantic) */
	requireEdgeHop?: boolean;
	/** If true, trace should reach multiple source types */
	requireCrossSourceHops?: boolean;
}

export const GOLD_STANDARD_QUERIES: GoldStandardQuery[] = [
	// ── Direct lookup ─────────────────────────────────────────
	{
		id: "dl-1",
		queryText: "How does the ingest pipeline process source files?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["ingest", "/src/"],
		minResults: 2,
	},
	{
		id: "dl-2",
		queryText: "What is the manifest schema for collections?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["manifest", ".ts"],
		minResults: 1,
	},
	{
		id: "dl-3",
		queryText: "How does edge extraction work?",
		category: "direct-lookup",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["edge", "/src/"],
		minResults: 1,
	},

	// ── Cross-source tracing ──────────────────────────────────
	{
		id: "cs-1",
		queryText: "What issues discuss edge resolution and how is it implemented?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "cs-2",
		queryText: "What PRs changed the search or trace functionality and what code did they touch?",
		category: "cross-source",
		requiredSourceTypes: ["github-pr"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "cs-3",
		queryText: "What documentation covers the storage layer and how does the code implement it?",
		category: "cross-source",
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
	},

	// ── Coverage (positive presence queries, not absence) ─────
	{
		id: "cov-1",
		queryText: "What source types are represented in this collection?",
		category: "coverage",
		requiredSourceTypes: ["code"],
		minResults: 3,
	},
	{
		id: "cov-2",
		queryText: "What GitHub issues reference code changes or PRs?",
		category: "coverage",
		requiredSourceTypes: ["github-issue"],
		minResults: 1,
		requireEdgeHop: true,
	},

	{
		id: "dl-4",
		queryText: "How are chunks stored and indexed for vector search?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["chunk", "index"],
		minResults: 1,
	},
	{
		id: "dl-5",
		queryText: "What are the configuration options for the project?",
		category: "direct-lookup",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: ["config"],
		minResults: 1,
	},

	// ── Cross-source tracing ──────────────────────────────────
	{
		id: "cs-4",
		queryText: "What PRs fix bugs in the chunking code and which files did they touch?",
		category: "cross-source",
		requiredSourceTypes: ["github-pr"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "cs-5",
		queryText: "Which issues discuss dependency updates and their resolution?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "github-pr"],
		minResults: 1,
		requireEdgeHop: true,
	},

	// ── Coverage ──────────────────────────────────────────────
	{
		id: "cov-3",
		queryText: "Where is test coverage documented or configured?",
		category: "coverage",
		requiredSourceTypes: ["markdown", "code"],
		minResults: 1,
	},
	{
		id: "cov-4",
		queryText: "What licenses apply to the code in this collection?",
		category: "coverage",
		requiredSourceTypes: ["markdown"],
		minResults: 1,
	},

	// ── Synthesis ─────────────────────────────────────────────
	{
		id: "syn-1",
		queryText: "How does data flow from ingestion through embedding to search results?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireCrossSourceHops: true,
	},
	{
		id: "syn-2",
		queryText: "What is the overall architecture of this system?",
		category: "synthesis",
		requiredSourceTypes: ["markdown"],
		minResults: 3,
	},
	{
		id: "syn-3",
		queryText: "How do edges connect content across different sources?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "syn-4",
		queryText: "What is the release process and how are versions tagged?",
		category: "synthesis",
		requiredSourceTypes: ["markdown", "github-pr"],
		minResults: 2,
	},
	{
		id: "syn-5",
		queryText: "How does the system handle errors and failures?",
		category: "synthesis",
		requiredSourceTypes: ["code"],
		minResults: 2,
	},

	// ── Coverage extras ───────────────────────────────────────
	{
		id: "cov-5",
		queryText: "What CI or GitHub Actions workflows exist?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 1,
	},

	// ── Direct lookup extras ──────────────────────────────────
	{
		id: "dl-6",
		queryText: "What does the README describe?",
		category: "direct-lookup",
		requiredSourceTypes: ["markdown"],
		expectedSourceSubstrings: ["README"],
		minResults: 1,
	},
	{
		id: "dl-7",
		queryText: "What are the main dependencies used?",
		category: "direct-lookup",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["package.json", "dependencies"],
		minResults: 1,
	},
];
