/**
 * Gold standard queries for the filoz-ecosystem-2026-04 collection.
 * Spans: direct lookup, cross-source tracing, gap detection, and synthesis.
 * Used by the quality-queries dogfood stage to measure search quality.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/232
 */

export interface GoldStandardQuery {
	/** Unique identifier for this query */
	id: string;
	/** The query text to search/trace */
	queryText: string;
	/** Category: direct-lookup | cross-source | gap-detection | synthesis */
	category: "direct-lookup" | "cross-source" | "gap-detection" | "synthesis";
	/** Source types that MUST appear in results for the query to pass */
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
		queryText: "What is the CollectionHead manifest schema?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["manifest", ".ts"],
		minResults: 1,
	},
	{
		id: "dl-3",
		queryText: "How does edge extraction work with tree-sitter?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["tree-sitter", "edge"],
		minResults: 1,
	},

	// ── Cross-source tracing ──────────────────────────────────
	{
		id: "cs-1",
		queryText: "What GitHub issues discuss edge resolution and how is it implemented in code?",
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
		requiredSourceTypes: ["doc-page"],
		minResults: 2,
		requireCrossSourceHops: true,
	},

	// ── Gap detection ─────────────────────────────────────────
	{
		id: "gd-1",
		queryText: "What parts of the codebase have no documentation?",
		category: "gap-detection",
		requiredSourceTypes: ["code"],
		minResults: 1,
	},
	{
		id: "gd-2",
		queryText: "Which GitHub issues have no corresponding code changes?",
		category: "gap-detection",
		requiredSourceTypes: ["github-issue"],
		minResults: 1,
	},

	// ── Synthesis ─────────────────────────────────────────────
	{
		id: "syn-1",
		queryText: "How does data flow from ingestion through embedding to search results?",
		category: "synthesis",
		requiredSourceTypes: ["code"],
		minResults: 3,
		requireCrossSourceHops: true,
	},
	{
		id: "syn-2",
		queryText: "What is the architecture of the wtfoc knowledge graph system?",
		category: "synthesis",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["/src/"],
		minResults: 3,
	},
];
