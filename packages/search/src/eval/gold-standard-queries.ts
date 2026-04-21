/**
 * Gold standard queries for dogfood evaluation.
 * Spans: direct lookup, cross-source tracing, coverage analysis, and synthesis.
 *
 * Primary target: `filoz-ecosystem-*` collections (FilOzone + filecoin-project
 * repos + docs.filecoin.io). Several queries are ecosystem-specific (PDP,
 * PieceCID/CommP, Filecoin Pay, Curio ↔ Synapse). These pass on wtfoc-self
 * collections only incidentally via generic substrings.
 *
 * Per-collection fixture splitting is tracked in the dogfood reliability epic
 * (#247).
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/232
 * @see https://github.com/SgtPooki/wtfoc/issues/261
 */

/**
 * Version of the gold-standard query fixture set (#261).
 *
 * Bump policy:
 * - **major**: shape change to `GoldStandardQuery` interface
 * - **minor**: add, remove, or re-categorize a query
 * - **patch**: copy edits to existing `queryText` / `expectedSourceSubstrings`
 *   that preserve intent (typo fixes, rewording without changing what's asked)
 *
 * Surfaced in the quality-queries stage metrics as `goldQueriesVersion` so
 * dogfood reports record which fixture revision scored what. Do not let two
 * separate changes coincide on the same version — a new change always gets
 * a fresh bump.
 */
export const GOLD_STANDARD_QUERIES_VERSION = "1.2.0";

export interface GoldStandardQuery {
	/** Unique identifier for this query */
	id: string;
	/** The query text to search/trace */
	queryText: string;
	/**
	 * Query category:
	 * - `direct-lookup` — ask about a specific thing; result should contain it
	 * - `cross-source` — trace must span multiple source types
	 * - `coverage` — positive-presence checks across the collection
	 * - `synthesis` — open-ended; result quality matters more than exact match
	 * - `file-level` — file-scoped questions that should surface file-summary
	 *   chunks emitted by `HierarchicalCodeChunker` (#252). Uses the same
	 *   pass/fail rubric as other categories — the separation exists so the
	 *   dogfood report can measure file-summary retrieval independently.
	 * - `work-lineage` — flagship cross-org demo category (US-015, added in
	 *   v1.2.0). Asks questions where a good answer surfaces BOTH the
	 *   implementation (code) AND the discussion/design trail (issues,
	 *   PRs, PR comments, docs) linked via `closes` / `references` /
	 *   `contains` / `imports` edges. The dogfood report tracks this
	 *   category separately so flagship demo readiness is measurable
	 *   without the ecosystem-specific queries drowning the signal.
	 */
	category:
		| "direct-lookup"
		| "cross-source"
		| "coverage"
		| "synthesis"
		| "file-level"
		| "work-lineage";
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
	/**
	 * Demo-readiness tier (added in v1.2.0).
	 * - `demo-critical` — must pass for the June 7 flagship demo to be safe.
	 *   Dogfood report flags a regression loud when any demo-critical query
	 *   fails, even if overall pass rate is fine.
	 * - `diagnostic` — probes a weaker path (lineage-only, edge-heavy,
	 *   single-repo). Still counted in overall pass rate but a failure is
	 *   informative rather than demo-blocking.
	 * Unset defaults to `diagnostic` in the report.
	 */
	tier?: "demo-critical" | "diagnostic";
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

	// ── Ecosystem-specific queries (filoz-ecosystem primary target) ──
	// These exercise cross-repo tracing, decision/rationale retrieval from
	// PR comments, temporal/recency intent, synonym coverage, and docs/code
	// consistency — gaps the original 22-query set didn't cover.

	{
		id: "dl-8",
		queryText: "What recent pull requests changed PDP, proof set, or proof verification behavior?",
		category: "direct-lookup",
		requiredSourceTypes: ["github-pr"],
		expectedSourceSubstrings: ["PDP", "proof"],
		minResults: 2,
	},

	{
		id: "cs-6",
		queryText:
			"How does synapse-sdk integrate with filecoin-pin or delegated storage services when publishing data?",
		category: "cross-source",
		requiredSourceTypes: ["github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["synapse-sdk", "filecoin-pin"],
		minResults: 2,
		requireCrossSourceHops: true,
	},
	{
		id: "cs-7",
		queryText:
			"How is a storage provider or proof service configured in Synapse docs compared with the TypeScript implementation?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: ["synapse-sdk"],
		minResults: 2,
		requireCrossSourceHops: true,
	},

	{
		id: "cov-6",
		queryText:
			"What problems or bugs were reported around Filecoin Pay payment flows in the ecosystem repos?",
		category: "coverage",
		requiredSourceTypes: ["github-issue", "github-pr-comment"],
		expectedSourceSubstrings: ["filecoin-pay", "pay"],
		minResults: 2,
		requireCrossSourceHops: true,
	},
	{
		id: "cov-7",
		queryText:
			"Where is piece commitment handled, including PieceCID, CommP, or piece CID terminology?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["PieceCID", "CommP", "piece"],
		minResults: 2,
		requireCrossSourceHops: true,
	},

	{
		id: "syn-6",
		queryText:
			"Why did the Filecoin services work settle on the current proof set or PDP service contract design?",
		category: "synthesis",
		requiredSourceTypes: ["github-pr-comment", "github-pr"],
		expectedSourceSubstrings: ["filecoin-services", "PDP"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "syn-7",
		queryText:
			"How do Curio sector or deal-storage concepts connect to the Synapse client storage workflow?",
		category: "synthesis",
		requiredSourceTypes: ["github-pr", "github-pr-comment", "code"],
		expectedSourceSubstrings: ["curio", "synapse"],
		minResults: 2,
		requireCrossSourceHops: true,
	},

	{
		id: "cov-8",
		queryText: "What official Filecoin documentation pages describe storage providers?",
		category: "coverage",
		requiredSourceTypes: ["doc-page"],
		expectedSourceSubstrings: ["docs.filecoin.io", "storage"],
		minResults: 1,
	},

	// ── File-level (#252 / #286) ──────────────────────────────
	// These intentionally ask file-scoped questions so the file-level
	// summary chunks emitted by HierarchicalCodeChunker have a reason to
	// rank. Package-level wording ("what does X do") is avoided — docs/
	// README usually answer those better. See #252 for rationale.

	{
		id: "fl-1",
		queryText: "Which file defines the Synapse class or createSynapse factory?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["synapse.ts", "synapse-sdk"],
		minResults: 1,
	},
	{
		id: "fl-2",
		queryText: "Which file defines PieceCID and the piece identity logic?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["piece"],
		minResults: 1,
	},
	{
		id: "fl-3",
		queryText: "Which files import PieceCID in the synapse client?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["piece"],
		minResults: 2,
	},
	{
		id: "fl-4",
		queryText: "Which file defines StorageContext in the synapse-sdk?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["context.ts", "storage"],
		minResults: 1,
	},

	// ── Work-lineage (flagship, #264 / US-015, added v1.2.0) ──
	// These queries are hand-picked from verified artifacts in
	// `filoz-ecosystem-2026-04-v11`. Each demo-critical query surfaces BOTH
	// the implementation code and the discussion trail (issue/PR/PR comment)
	// linked via edges, proving trace reconstructs cross-org work across
	// FilOzone + filecoin-project repos. Diagnostic queries probe
	// lineage-only paths (edge-heavy but code doesn't surface semantically)
	// so we can tell the difference between "retrieval is weak" and "this is
	// fundamentally a coordination question without a single code answer".

	{
		id: "wl-1",
		queryText: "Where does PieceCID validation happen and what concerns were raised about it?",
		category: "work-lineage",
		tier: "demo-critical",
		requiredSourceTypes: ["code", "github-pr-comment", "markdown"],
		expectedSourceSubstrings: ["piece.ts", "pieceCid"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "wl-2",
		queryText: "DataSetStatus enum values and transitions in filecoin services code",
		category: "work-lineage",
		tier: "demo-critical",
		requiredSourceTypes: ["code", "github-issue", "github-pr", "github-pr-comment", "markdown"],
		expectedSourceSubstrings: ["DataSetStatus", "filecoin-services"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "wl-3",
		queryText:
			"Payment flow from client deposit to storage provider payout in contract code and docs",
		category: "work-lineage",
		tier: "demo-critical",
		requiredSourceTypes: ["code", "markdown", "github-pr-comment"],
		expectedSourceSubstrings: ["payment", "deposit"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "wl-4",
		queryText: "piece.ts validation logic across synapse-core and filecoin-pin, with PR discussion",
		category: "work-lineage",
		tier: "demo-critical",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["piece", "validate"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "wl-5",
		queryText: "Payments module deposit function implementation in filecoin-pin with docs context",
		category: "work-lineage",
		tier: "demo-critical",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["payments", "deposit"],
		minResults: 3,
		requireEdgeHop: true,
	},

	// Diagnostic — lineage-only, no expectation of code surfacing
	{
		id: "wl-6",
		queryText: "How did curio integrate with synapse-sdk PDP layer via issues and PRs?",
		category: "work-lineage",
		tier: "diagnostic",
		requiredSourceTypes: ["github-issue", "github-pr"],
		expectedSourceSubstrings: ["curio", "pdp"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "wl-7",
		queryText: "Piece CID v1 to v2 migration discussion across curio and filecoin services PRs",
		category: "work-lineage",
		tier: "diagnostic",
		requiredSourceTypes: ["github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["v2", "piece"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
	},
	{
		id: "wl-8",
		queryText:
			"Storage costs and billing concepts documented across synapse-sdk and filecoin-services",
		category: "work-lineage",
		tier: "diagnostic",
		requiredSourceTypes: ["markdown"],
		expectedSourceSubstrings: ["storage", "cost"],
		minResults: 2,
	},
];
