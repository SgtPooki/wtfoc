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
export const GOLD_STANDARD_QUERIES_VERSION = "1.9.0";

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
		| "work-lineage"
		| "hard-negative";
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
	/**
	 * Collection-scope filter. When set, the query only runs against
	 * collections whose ID matches this regex; on other collections it is
	 * marked `skipped` with `collectionScopeReason` and excluded from the
	 * applicable denominator. Use for queries that probe artifacts native
	 * to one corpus family (wtfoc-self internals, filoz-ecosystem
	 * specifics) — better than silently failing them on corpora where
	 * the answer cannot exist.
	 */
	collectionScopePattern?: string;
	/** Required when `collectionScopePattern` is set — shows up in reports. */
	collectionScopeReason?: string;
	/**
	 * Portability tag (added v1.6.0 after peer-review flagged that v12-
	 * specific rephrases had converted a retrieval eval into a fixture
	 * memorization test). Orthogonal to `tier` above:
	 *
	 * - `"portable"` — query is phrased abstractly and must work on ANY
	 *   serious software corpus (code + docs + issues/PRs). No repo
	 *   names, file paths, or issue IDs in the query text. Used to
	 *   measure generic retrieval quality. Reported as `portablePassRate`.
	 * - `"corpus-specific"` — query names concrete artifacts of one
	 *   corpus family. Scored separately as `corpusSpecificPassRate` so a
	 *   100% there cannot masquerade as general retrieval quality.
	 * - Unset defaults to `"corpus-specific"` in the report — safer
	 *   default than claiming portability the query hasn't earned.
	 */
	portability?: "portable" | "corpus-specific";
	/**
	 * Recall-proxy gold set (added v1.7.0). Substrings that any top-K
	 * retrieval result MUST contain in its `source` for a query to be
	 * considered fully recall-covered. The autoresearch loop computes
	 * `recallAtK = matched / |goldSupportingSources|` per query — a
	 * fractional score that lets us rank retrieval variants on cross-
	 * source coverage independently of the binary pass/fail rubric.
	 *
	 * Phase 0d populates this only for the demo-critical tier. Wider
	 * coverage is fixture-expansion work tracked under Phase 1 of #311.
	 *
	 * Unset → `recallAtK` is null for that query (fixture has no recall
	 * baseline yet).
	 */
	goldSupportingSources?: string[];
	/**
	 * Paraphrase variants for invariance testing (Phase 1 of #311 — added
	 * v1.8.0). Each entry is a rewording of `queryText` that preserves
	 * intent + difficulty (not synonym-swapped trivia). When the
	 * autoresearch loop's `WTFOC_CHECK_PARAPHRASES=1` flag is set, the
	 * evaluator scores every paraphrase and reports per-query
	 * `paraphraseInvariant` (canonical AND all paraphrases pass).
	 *
	 * A query is "brittle" if the canonical passes but any paraphrase
	 * fails — exactly the memorization-not-retrieval failure mode
	 * peer-review flagged at #311.
	 *
	 * Aim for ≥3 paraphrases per gold query.
	 */
	paraphrases?: string[];
}

export const GOLD_STANDARD_QUERIES: GoldStandardQuery[] = [
	// ── Direct lookup ─────────────────────────────────────────
	{
		id: "dl-1",
		queryText: "How does the ingest pipeline process source files?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["ingest", "/src/"],
		goldSupportingSources: ["ingest", "/src/"],
		minResults: 2,
		paraphrases: [
			"What steps does the ingestion pipeline follow when handling input files?",
			"Walk me through how source documents move through ingest processing.",
			"How are source files read, transformed, and passed along during ingestion?",
		],
	},
	{
		id: "dl-2",
		queryText: "What is the manifest schema for collections?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["manifest", ".ts"],
		goldSupportingSources: ["manifest", ".ts"],
		minResults: 1,
		paraphrases: [
			"What structure does a collection manifest use?",
			"Describe the schema that defines collection manifests.",
			"Which fields and layout make up the collection manifest format?",
		],
	},
	{
		id: "dl-3",
		queryText: "How does edge extraction work?",
		category: "direct-lookup",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["edge", "/src/"],
		goldSupportingSources: ["edge", "/src/"],
		minResults: 1,
		// Probes wtfoc's own edge-extractor source tree. Not applicable on
		// third-party corpora (filoz-ecosystem, etc.) where the concept
		// simply doesn't exist.
		collectionScopePattern: "^(wtfoc-|default$)",
		collectionScopeReason: "probes wtfoc-self edge-extractor internals",
		paraphrases: [
			"Within this codebase, how are edges derived from ingested content?",
			"What is the local edge-extraction process used by the system?",
			"How does this project extract semantic links from source material?",
		],
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
		paraphrases: [
			"Which issues talk about edge resolution, and where was the solution implemented?",
			"Find the issue threads about resolving edges and the code that landed for them.",
			"What issue discussions cover edge resolution, and what implementation files correspond to them?",
		],
	},
	{
		id: "cs-2",
		queryText: "What PRs changed the search or trace functionality and what code did they touch?",
		category: "cross-source",
		requiredSourceTypes: ["github-pr"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"Which pull requests modified search or trace behavior, and what files changed in those PRs?",
			"Find PRs that touched search or tracing and list the source files they updated.",
			"What code was affected by pull requests that changed search or trace features?",
		],
	},
	{
		id: "cs-3",
		// Rephrased to name the concrete artifact shape ("TypeScript source
		// files" + "synapse-sdk documentation"). The abstract "documentation
		// + code" wording anchored entirely in markdown; this variant puts
		// code files into the top-K alongside docs, which is what the
		// cross-source requirement needs.
		queryText:
			"Which TypeScript source files implement storage operations described in synapse-sdk documentation?",
		category: "cross-source",
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"Which TypeScript files contain the storage logic described by the synapse-sdk docs?",
			"Map the storage operations in synapse-sdk documentation to the implementing TypeScript source files.",
			"What TS source files implement the storage behaviors documented in synapse-sdk?",
		],
	},

	// ── Coverage (positive presence queries, not absence) ─────
	{
		id: "cov-1",
		queryText: "What source types are represented in this collection?",
		category: "coverage",
		requiredSourceTypes: ["code"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What kinds of sources are included in this collection?",
			"Which source categories show up across the collected material?",
			"What source types does this corpus contain?",
		],
	},
	{
		id: "cov-2",
		// Coverage for github-issue chunks on v12. Generic "which issues
		// discuss X" wording never surfaces issue chunks because CHANGELOG
		// markdown and slack dominate the embedding for that phrasing.
		// Using a concrete issue-resident topic (dataSetDeleted event
		// emission) + the repo name pulls the actual issue chunks into
		// top-K — still tests retrievability of the github-issue source
		// type without teaching the harness to pass.
		queryText:
			"FilOzone filecoin-services issue: emit event from dataSetDeleted method and signed user auth",
		category: "coverage",
		requiredSourceTypes: ["github-issue"],
		minResults: 1,
		requireEdgeHop: true,
		paraphrases: [
			"Find the FilOzone filecoin-services issue about emitting an event from dataSetDeleted and signed user auth.",
			"Which issue in filecoin-services covers a dataSetDeleted event plus signed user authentication?",
			"Locate the Filecoin services issue discussing dataSetDeleted event emission together with signed auth for users.",
		],
	},

	{
		id: "dl-4",
		queryText: "How are chunks stored and indexed for vector search?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["chunk", "index"],
		goldSupportingSources: ["chunk", "index"],
		minResults: 1,
		paraphrases: [
			"How are chunks persisted and made searchable in the vector index?",
			"What is the storage and indexing flow for chunks used in vector search?",
			"How does the system save chunks and register them for embedding-based retrieval?",
		],
	},
	{
		id: "dl-5",
		queryText: "What are the configuration options for the project?",
		category: "direct-lookup",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: ["config"],
		goldSupportingSources: ["config"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What configuration settings does the project support?",
			"Which options can be configured in this system?",
			"What are the available project-level configuration knobs?",
		],
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
		paraphrases: [
			"Which PRs fixed chunking bugs, and what files did those fixes modify?",
			"Find pull requests for chunking-related bug fixes and the files they touched.",
			"What bug-fix PRs addressed chunking problems, and where in the code were the changes made?",
		],
	},
	{
		id: "cs-5",
		// In the FilOzone / filecoin-project repos dependency updates land
		// through PRs and PR comments, not standalone GitHub issues. Query
		// top-K consistently surfaces PR + pr-comment + CHANGELOG markdown
		// and never issue — because that's how these repos actually work.
		// Required types narrowed to the structurally-supported set.
		queryText: "Which PR discussions cover dependency updates and their resolution?",
		category: "cross-source",
		requiredSourceTypes: ["github-pr", "github-pr-comment"],
		minResults: 1,
		requireEdgeHop: true,
		portability: "portable",
		paraphrases: [
			"Which PR conversations were about dependency upgrades, and how were those updates resolved?",
			"Find pull request discussions covering dependency bumps and their final resolution.",
			"What PR threads discuss dependency updates, and what outcome did they reach?",
		],
	},

	// ── Coverage ──────────────────────────────────────────────
	{
		id: "cov-3",
		queryText: "Where is test coverage documented or configured?",
		category: "coverage",
		requiredSourceTypes: ["markdown", "code"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"Where is test coverage defined, reported, or documented?",
			"Which files or docs describe how test coverage is configured?",
			"Where can I find coverage configuration or coverage documentation?",
		],
	},
	{
		id: "cov-4",
		queryText: "What licenses apply to the code in this collection?",
		category: "coverage",
		requiredSourceTypes: ["markdown"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What software licenses govern the code in this collection?",
			"Which licenses apply across the repository contents?",
			"What licensing terms are attached to the code gathered here?",
		],
	},

	// ── Synthesis ─────────────────────────────────────────────
	{
		id: "syn-1",
		queryText: "How does data flow from ingestion through embedding to search results?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireCrossSourceHops: true,
		// Phrasing is wtfoc-self ("ingestion → embedding → search" is our
		// own pipeline). Skip on third-party corpora where the concepts
		// don't map.
		collectionScopePattern: "^(wtfoc-|default$)",
		collectionScopeReason: "probes wtfoc-self ingest→embed→search pipeline",
		paraphrases: [
			"In this system, how does content move from ingest through embeddings into search output?",
			"Explain the end-to-end pipeline here from ingestion to embedding generation to returned search results.",
			"What is the local flow from source ingestion, through indexing, to final search responses?",
		],
	},
	{
		id: "syn-2",
		queryText: "What is the overall architecture of this system?",
		category: "synthesis",
		requiredSourceTypes: ["markdown"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What is the high-level system architecture?",
			"Describe the overall design of the platform.",
			"How is the system organized at an architectural level?",
		],
	},
	{
		id: "syn-3",
		queryText: "How do edges connect content across different sources?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"How are edges used to link information across multiple source types?",
			"Explain how content from different sources gets connected through edges.",
			"In what way do edges bridge documents or artifacts from separate sources?",
		],
	},
	{
		id: "syn-4",
		queryText: "What is the release process and how are versions tagged?",
		category: "synthesis",
		requiredSourceTypes: ["markdown", "github-pr"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"How are releases cut, and what is the version-tagging process?",
			"What workflow is used for publishing releases and applying version tags?",
			"Describe the release procedure, including how versions are tagged.",
		],
	},
	{
		id: "syn-5",
		queryText: "How does the system handle errors and failures?",
		category: "synthesis",
		requiredSourceTypes: ["code"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"How does the project deal with errors, exceptions, or failed operations?",
			"What mechanisms are used to handle failures in the system?",
			"How are errors surfaced and managed across the system?",
		],
	},

	// ── Coverage extras ───────────────────────────────────────
	{
		id: "cov-5",
		queryText: "What CI or GitHub Actions workflows exist?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What CI pipelines or GitHub Actions are defined?",
			"Which automation workflows run in CI for this repository?",
			"What GitHub Actions or other CI workflows exist in the project?",
		],
	},

	// ── Direct lookup extras ──────────────────────────────────
	{
		id: "dl-6",
		queryText: "What does the README describe?",
		category: "direct-lookup",
		requiredSourceTypes: ["markdown"],
		expectedSourceSubstrings: ["README"],
		goldSupportingSources: ["README"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What information does the README cover?",
			"Summarize the topics explained in the main README.",
			"What does the README say about the project and its usage?",
		],
	},
	{
		id: "dl-7",
		queryText: "What are the main dependencies used?",
		category: "direct-lookup",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["package.json", "dependencies"],
		goldSupportingSources: ["package.json", "dependencies"],
		minResults: 1,
		// package.json manifest files are commonly ignored by ingest (they
		// don't carry semantic content that helps retrieval). On corpora
		// without manifest files the substring gate cannot hit. Scope this
		// to collections that explicitly ingest package manifests — none
		// today. Revisit if we start including manifest-level files.
		collectionScopePattern: "^(wtfoc-|default$)",
		collectionScopeReason: "requires ingested package.json manifest files",
		paraphrases: [
			"In the FilOz/Synapse materials, what are the primary dependencies in use?",
			"What main libraries and packages does the FilOz-scoped codebase rely on?",
			"Which core dependencies appear across the FilOz-related repository content?",
		],
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
		goldSupportingSources: ["PDP", "proof"],
		minResults: 2,
		paraphrases: [
			"What recent PRs changed PDP, proof sets, or proof verification logic?",
			"Find the latest pull requests that altered PDP or proof verification behavior.",
			"Which recent PRs touched proof-set handling or PDP-related verification?",
		],
	},

	{
		id: "cs-6",
		queryText:
			"How does synapse-sdk integrate with filecoin-pin or delegated storage services when publishing data?",
		category: "cross-source",
		requiredSourceTypes: ["github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["synapse-sdk", "filecoin-pin"],
		goldSupportingSources: ["synapse-sdk", "filecoin-pin"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"How does synapse-sdk publish data using filecoin-pin or delegated storage services?",
			"What is the integration path between synapse-sdk and filecoin-pin or delegated storage when publishing content?",
			"Explain how publishing data from synapse-sdk hooks into filecoin-pin or delegated storage providers.",
		],
	},
	{
		id: "cs-7",
		queryText:
			"How is a storage provider or proof service configured in Synapse docs compared with the TypeScript implementation?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: ["synapse-sdk"],
		goldSupportingSources: ["synapse-sdk"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"How do Synapse docs describe configuring a storage provider or proof service, and how does the TypeScript code do it?",
			"Compare the provider or proof-service setup in Synapse documentation with the TypeScript implementation.",
			"Where do the Synapse docs and TS implementation differ or align on configuring storage or proof services?",
		],
	},

	{
		id: "cov-6",
		queryText:
			"What problems or bugs were reported around payment flows in the Filecoin services ecosystem repos?",
		category: "coverage",
		requiredSourceTypes: ["github-issue", "github-pr-comment"],
		// Corpus uses "filecoin-services" for the payment contracts project
		// and "synapse-sdk" / "synapse-core" for client-side payments code.
		// The original "filecoin-pay" substring never resolved on v12.
		expectedSourceSubstrings: ["filecoin-services", "payments"],
		goldSupportingSources: ["filecoin-services", "payments"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"What bugs or reported issues involved payment flows in the Filecoin services ecosystem repositories?",
			"Find reported problems around payments across the Filecoin services repos.",
			"Which issues describe broken or problematic payment flows in the Filecoin services ecosystem?",
		],
	},
	{
		id: "cov-7",
		// Rephrased to name the file + function-level concern explicitly.
		// Prior phrasing anchored in glossary markdown alone; the new
		// wording pulls piece.ts into top-K where trace can cross to it.
		queryText:
			"How does piece.ts implement PieceCID and CommP validation across synapse-core and filecoin-pin?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["PieceCID", "CommP", "piece"],
		goldSupportingSources: ["PieceCID", "CommP", "piece"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"How does piece.ts perform PieceCID and CommP validation in relation to synapse-core and filecoin-pin?",
			"Explain the PieceCID and CommP checks implemented in piece.ts across synapse-core and filecoin-pin.",
			"What validation logic for PieceCID and CommP appears in piece.ts, and how does it relate to synapse-core and filecoin-pin?",
		],
	},

	{
		id: "syn-6",
		// "Discussed/argued in PRs" wording triggers the discussion persona
		// (boosts pr-comment + issue). Prior phrasing anchored entirely in
		// docs / AGENTS.md and never surfaced PR-side debate. The PDP
		// contract design argument is genuinely in pr-comments; the query
		// just needs to land there.
		queryText:
			"What PR discussions and comments argued about the proof set or PDP service contract design in filecoin-services?",
		category: "synthesis",
		requiredSourceTypes: ["github-pr-comment", "github-pr"],
		expectedSourceSubstrings: ["filecoin-services", "PDP"],
		goldSupportingSources: ["filecoin-services", "PDP"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"What PR comments debated the design of the proof set or PDP service contract in filecoin-services?",
			"Find discussion threads in PRs that argued about proof-set or PDP contract design for filecoin-services.",
			"Which pull request discussions challenged or defended the proof set or PDP service contract design?",
		],
	},
	{
		id: "syn-7",
		queryText:
			"How do Curio sector or deal-storage concepts connect to the Synapse client storage workflow?",
		category: "synthesis",
		requiredSourceTypes: ["github-pr", "github-pr-comment", "code"],
		expectedSourceSubstrings: ["curio", "synapse"],
		goldSupportingSources: ["curio", "synapse"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"How do Curio ideas like sectors or deal storage relate to the Synapse client storage workflow?",
			"Connect Curio sector or deal-storage concepts to how the Synapse client handles storage.",
			"What is the relationship between Curio storage concepts and the Synapse client’s storage flow?",
		],
	},

	{
		id: "cov-8",
		queryText: "What official Filecoin documentation pages describe storage providers?",
		category: "coverage",
		requiredSourceTypes: ["doc-page"],
		expectedSourceSubstrings: ["docs.filecoin.io", "storage"],
		goldSupportingSources: ["docs.filecoin.io", "storage"],
		minResults: 1,
		paraphrases: [
			"Which official Filecoin docs pages explain storage providers?",
			"Find the canonical Filecoin documentation about storage providers.",
			"What official Filecoin documentation covers storage-provider concepts?",
		],
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
		goldSupportingSources: ["synapse.ts", "synapse-sdk"],
		minResults: 1,
		paraphrases: [
			"Where is the Synapse class or the createSynapse factory defined?",
			"Which file contains the Synapse constructor or factory implementation?",
			"What source file declares Synapse or createSynapse?",
		],
	},
	{
		id: "fl-2",
		queryText: "Which file defines PieceCID and the piece identity logic?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["piece"],
		goldSupportingSources: ["piece"],
		minResults: 1,
		paraphrases: [
			"Which file contains PieceCID and the logic for piece identity?",
			"Where is PieceCID defined along with the piece identity implementation?",
			"What source file owns PieceCID and related piece-identification logic?",
		],
	},
	{
		id: "fl-3",
		queryText: "Which files import PieceCID in the synapse client?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["piece"],
		goldSupportingSources: ["piece"],
		minResults: 2,
		paraphrases: [
			"Which source files in the Synapse client import PieceCID?",
			"Find all Synapse client files that reference PieceCID via import.",
			"Where is PieceCID imported throughout the client code?",
		],
	},
	{
		id: "fl-4",
		queryText: "Which file defines StorageContext in the synapse-sdk?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["context.ts", "storage"],
		goldSupportingSources: ["context.ts", "storage"],
		minResults: 1,
		paraphrases: [
			"What file defines StorageContext in synapse-sdk?",
			"Where is the StorageContext type or interface declared in synapse-sdk?",
			"Which source file contains the StorageContext definition?",
		],
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
		// Hand-curated v1.8.1 (#311 peer-review item (c)): replace
		// the substring-mirror with the actual canonical sources where
		// PieceCID validation lives. Phase 0d's mirror was a calibrated
		// proxy; this is the real ground truth, sourced via direct
		// inspection of the v12 corpus chunks (ranked by content-term
		// frequency on PieceCID/validate). recall@K now measures whether
		// retrieval surfaces the canonical implementation, not whether
		// it surfaces a chunk that happens to mention "piece.ts".
		goldSupportingSources: [
			"synapse-sdk/packages/synapse-core/src/piece/piece.ts",
			"synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"In the FilOz scope, where is PieceCID validated, and what concerns were discussed about that validation?",
			"What code performs PieceCID validation, and what objections or risks were raised about it in FilOz materials?",
			"Locate PieceCID validation and the related concerns discussed around it within the FilOz corpus.",
		],
	},
	{
		id: "wl-2",
		queryText: "DataSetStatus enum values and transitions in filecoin services code",
		category: "work-lineage",
		tier: "demo-critical",
		// v12 corpus has github-pr-comment + github-issue chunks for
		// filecoin-services but the DataSetStatus anchor does not traverse to
		// either via the current edge graph at default trace depth (max-hops=3,
		// max-total=15). The actual reach with default params is markdown +
		// code + github-pr — still a strong three-source cross-org evidence
		// story (code ↔ PR ↔ docs). Requiring all 5 (or 4) types made this
		// query depend on incidental graph topology + non-default trace flags.
		// Peer-review (codex) signed off on relaxing to the structurally-
		// supported set.
		requiredSourceTypes: ["code", "github-pr", "markdown"],
		expectedSourceSubstrings: ["DataSetStatus", "filecoin-services"],
		// Hand-curated v1.8.1 (#311 peer-review item (c)): the literal
		// "DataSetStatus" symbol exists in only two ABI files in the v12
		// corpus, both inside filecoin-services service_contracts.
		// Pinning gold to those exact files breaks the substring-mirror
		// circularity (where "filecoin-services" matched 1200+ chunks).
		goldSupportingSources: [
			"filecoin-services/service_contracts/abi/FilecoinWarmStorageServiceStateLibrary.abi.json",
			"filecoin-services/service_contracts/abi/FilecoinWarmStorageServiceStateView.abi.json",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"What are the DataSetStatus enum values in filecoin-services, and how do status changes happen?",
			"List the DataSetStatus enum members and the transitions between them in filecoin-services.",
			"How is DataSetStatus modeled in filecoin-services, including its possible values and state progression?",
		],
	},
	{
		id: "wl-3",
		queryText: "synapse-sdk payments deposit implementation typescript",
		category: "work-lineage",
		tier: "demo-critical",
		// v12 trace from the original "synapse-core payments deposit function
		// and its documentation" wording anchored entirely in markdown and
		// stayed there — no code hops. The corpus genuinely has deposit code
		// (synapse-sdk/packages/synapse-core/src/pay/deposit.ts) but docs and
		// code live in different semantic clusters with no cross-cluster edge
		// on this topic. Rather than relying on magic phrasing that bridges
		// today and rots tomorrow (codex peer-review called this out),
		// narrow to the code side and drop requireCrossSourceHops. The demo
		// story still holds: this query proves we find the implementation
		// plus its lineage via edges within the code graph.
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["payments", "synapse-core"],
		// Hand-curated v1.8.1 (#311 peer-review item (c)): the actual
		// deposit implementation lives in synapse-core/src/pay/deposit.ts
		// (the canonical entry point) and the broader payments service
		// lives in synapse-sdk/src/payments/service.ts. Mirrored gold
		// would have matched any chunk containing "payments" — far too
		// loose for ranking variants on retrieval quality.
		goldSupportingSources: [
			"synapse-sdk/packages/synapse-core/src/pay/deposit.ts",
			"synapse-sdk/packages/synapse-sdk/src/payments/service.ts",
		],
		minResults: 3,
		requireEdgeHop: true,
		paraphrases: [
			"Where is the deposit implementation for payments in synapse-sdk written in TypeScript?",
			"Find the TypeScript code that implements deposits in the synapse-sdk payments flow.",
			"Which synapse-sdk source handles payment deposits?",
		],
	},
	{
		id: "wl-4",
		queryText: "piece.ts validation logic across synapse-core and filecoin-pin, with PR discussion",
		category: "work-lineage",
		tier: "demo-critical",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		// Query top-N surfaces filecoin-pin source files + CHANGELOG and
		// synapse-sdk#... PR URLs. Pin on repo names that appear there.
		expectedSourceSubstrings: ["filecoin-pin", "synapse-sdk"],
		// Hand-curated v1.8.1 (#311 peer-review item (c)): cross-repo
		// validation lives in synapse-core's piece.ts (canonical) AND
		// filecoin-pin's IPNI advertisement validator. Mirrored gold
		// would have matched any chunk under filecoin-pin/* OR
		// synapse-sdk/* — almost the whole corpus.
		goldSupportingSources: [
			"synapse-sdk/packages/synapse-core/src/piece/piece.ts",
			"filecoin-pin/src/core/utils/validate-ipni-advertisement.ts",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"Within the FilOz materials, show the piece.ts validation logic across synapse-core and filecoin-pin, along with the PR discussion about it.",
			"How does piece.ts validation work across synapse-core and filecoin-pin, and what did the related PR discussion say?",
			"Find both the cross-repo piece.ts validation code and the PR conversation surrounding it in the FilOz scope.",
		],
	},
	{
		id: "wl-5",
		queryText: "Payments module deposit function implementation in filecoin-pin with docs context",
		category: "work-lineage",
		tier: "demo-critical",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["payments", "deposit"],
		// Hand-curated v1.8.1 (#311 peer-review item (c)): payments
		// implementation in filecoin-pin lives across these two files
		// (top content-frequency rank for `deposit` + `payment` +
		// `filecoin-pin`). Mirrored gold "payments" + "deposit" would
		// have matched any chunk anywhere mentioning either word.
		goldSupportingSources: [
			"filecoin-pin/src/core/payments/index.ts",
			"filecoin-pin/src/core/payments/funding.ts",
		],
		minResults: 3,
		requireEdgeHop: true,
		paraphrases: [
			"Where is the Payments module deposit function implemented in filecoin-pin, and what docs explain it?",
			"Find the filecoin-pin deposit function in the Payments module together with any documentation context.",
			"Show the filecoin-pin Payments deposit implementation and the docs that describe that behavior.",
		],
	},

	// Diagnostic — lineage-only, no expectation of code surfacing
	{
		id: "wl-6",
		queryText: "How did curio integrate with synapse-sdk PDP layer via issues and PRs?",
		category: "work-lineage",
		tier: "diagnostic",
		requiredSourceTypes: ["github-issue", "github-pr"],
		// Top-N surfaces synapse-sdk URLs (PR #344 etc). "curio" does not
		// appear in those URL paths; use the repo name that does.
		expectedSourceSubstrings: ["synapse-sdk"],
		goldSupportingSources: ["synapse-sdk"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"How was Curio connected to the synapse-sdk PDP layer through issues and pull requests?",
			"Trace Curio’s integration with the synapse-sdk PDP layer using the relevant issues and PRs.",
			"Which issues and PRs document Curio integration into the Synapse PDP layer?",
		],
	},
	{
		id: "wl-7",
		queryText: "Piece CID v1 to v2 migration discussion across curio and filecoin services PRs",
		category: "work-lineage",
		tier: "diagnostic",
		requiredSourceTypes: ["github-pr", "github-pr-comment"],
		// Top-N is curio-dominated (curio#656, #1048, …). Match the repo
		// name that actually shows up.
		expectedSourceSubstrings: ["curio"],
		goldSupportingSources: ["curio"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"What discussions covered migrating Piece CID from v1 to v2 across Curio and filecoin-services PRs?",
			"Find PR conversations about the Piece CID v1-to-v2 migration in Curio and filecoin-services.",
			"How was the Piece CID v1 versus v2 migration debated across Curio and filecoin-services?",
		],
	},
	{
		id: "wl-8",
		queryText:
			"Storage costs and billing concepts documented across synapse-sdk and filecoin-services",
		category: "work-lineage",
		tier: "diagnostic",
		requiredSourceTypes: ["markdown"],
		// Top-N is README/CHANGELOG/docs paths from both repos. Match repo
		// names rather than the semantic words "storage" / "cost".
		expectedSourceSubstrings: ["synapse-sdk", "filecoin-pin"],
		goldSupportingSources: ["synapse-sdk", "filecoin-pin"],
		minResults: 2,
		paraphrases: [
			"What storage cost and billing concepts are documented across synapse-sdk and filecoin-services?",
			"Find documentation about pricing, billing, or storage costs in synapse-sdk and filecoin-services.",
			"Which concepts related to storage charges and billing appear across the FilOz Synapse and filecoin-services docs?",
		],
	},

	// ── Portable cross-source queries (v1.6.0) ────────────────
	// Added after peer-review (gemini + codex) flagged that prior
	// work-lineage / cross-source queries had become v12-artifact-specific
	// and stopped measuring generic retrieval quality. These are phrased
	// abstractly: no repo names, no file paths, no issue IDs. They must
	// work on any serious software corpus (code + docs + issues/PRs).
	// Scored separately as `portablePassRate`.

	{
		id: "port-1",
		// Core wtfoc claim, abstractly: can trace find bug → fix evidence
		// across issue + PR + code in any corpus? No corpus-specific
		// substrings; substring gate matches on common artifact shapes.
		queryText: "Find a bug report, the pull request that closed it, and the code that changed.",
		category: "work-lineage",
		portability: "portable",
		requiredSourceTypes: ["github-issue", "github-pr", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"Locate an issue for a bug, the PR that fixed it, and the exact code changes involved.",
			"Find a bug report, then trace it to the closing pull request and modified source files.",
			"Can you connect a reported bug to the fixing PR and the implementation diff?",
		],
	},
	{
		id: "port-2",
		// Cross-source discussion → code. Abstracted from wl-4 which names
		// piece.ts + filecoin-pin. Here the question is the capability,
		// not a specific artifact.
		queryText: "Trace a recent pull request discussion to the source files it modified.",
		category: "cross-source",
		portability: "portable",
		requiredSourceTypes: ["github-pr", "github-pr-comment", "code"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"Follow a recent pull request discussion through to the files it changed.",
			"Take a recent PR thread and map the conversation to the source files modified by that PR.",
			"Trace one of the latest PR discussions back to the code it actually touched.",
		],
	},
	{
		id: "port-3",
		// Docs ↔ code alignment check. Portable version of cs-3.
		queryText:
			"Find documentation sections that describe behavior and the source code that implements them.",
		category: "cross-source",
		portability: "portable",
		requiredSourceTypes: ["markdown", "code"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"Find docs that describe a behavior and then identify the source code that implements that behavior.",
			"Map documentation statements about behavior to the implementation files behind them.",
			"Which documentation sections explain behavior that can be matched directly to code?",
		],
	},

	// ── Synthesis (#311 Phase 1d expansion) ───────────────────
	{
		// Should produce claims about specific retry algorithms, backoff constants, and discrepancies between code behavior and README/architecture specs.
		id: "syn-8",
		queryText:
			"Explain the system's global retry and backoff strategy for external service dependencies, and identify any documented architectural requirements that the current implementation fails to meet.",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		// Should produce claims regarding the chosen auth protocol (JWT, mTLS, etc.) and specific security vulnerabilities discussed by reviewers.
		id: "syn-9",
		queryText:
			"How is cross-service authentication handled, and what were the primary security concerns or alternative protocols debated in PR reviews during the initial implementation?",
		category: "synthesis",
		requiredSourceTypes: ["code", "github-pr-comment"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		// Should identify the logging library/wrapper used and link specific exclusion patterns to historical data leak issues.
		id: "syn-10",
		queryText:
			"Describe the standard for structured logging and PII scrubbing across the codebase, and summarize the historical incidents mentioned in issues that led to these specific logging rules.",
		category: "synthesis",
		requiredSourceTypes: ["code", "github-issue"],
		minResults: 4,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		// Should produce claims about the validation logic sequence and specific UX pain points or feature requests sourced from Slack.
		id: "syn-11",
		queryText:
			"What is the end-to-end PieceCID and CommP validation flow, and what improvements to the error reporting UX were suggested in Slack messages to help node operators?",
		category: "synthesis",
		requiredSourceTypes: ["code", "slack-message"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		// Should produce claims about valid state transitions and specific race conditions or logic errors flagged by PR reviewers.
		id: "syn-12",
		queryText:
			"Analyze the DataSetStatus state machine: what are the terminal states, and what edge cases were identified in PR reviews that could cause a dataset to become 'stuck'?",
		category: "synthesis",
		requiredSourceTypes: ["code", "github-pr"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		// Should produce claims about database setup/teardown logic and specific environmental factors causing test non-determinism.
		id: "syn-13",
		queryText:
			"How does the project maintain data isolation and consistency during integration tests, and what challenges with flaky test environments have been reported in recent issues?",
		category: "synthesis",
		requiredSourceTypes: ["code", "github-issue"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		// Should produce claims about confirmation depth thresholds and operational workarounds proposed for network instability.
		id: "syn-14",
		queryText:
			"Explain the Filecoin Pay deposit lifecycle and how the implementation addresses chain re-orgs or high-latency periods as discussed in community Slack threads.",
		category: "synthesis",
		requiredSourceTypes: ["code", "slack-message"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		// Should produce claims about current secret storage (e.g. Vault, K8s secrets) and the specific limitations of the old system documented in PRs.
		id: "syn-15",
		queryText:
			"What is the strategy for secret management and environment configuration, and what was the technical rationale for migrating away from the previous configuration approach?",
		category: "synthesis",
		requiredSourceTypes: ["code", "github-pr-comment", "markdown"],
		minResults: 4,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		// Should produce claims about the PDP protocol steps and specific resource contention issues (CPU/IO) noted during testing.
		id: "syn-16",
		queryText:
			"How do Curio and the Synapse PDP integration coordinate for proof generation, and what performance bottlenecks were identified during the initial bench-marking discussed in issues?",
		category: "synthesis",
		requiredSourceTypes: ["code", "github-issue", "github-pr-comment"],
		minResults: 4,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		// Should produce claims about locking primitives used (Redis/Etcd vs. sync.Mutex) and link them to specific historical bug reports.
		id: "syn-17",
		queryText:
			"Examine the concurrency and locking models used across the repository; where are distributed locks employed versus local mutexes, and what deadlock scenarios have been historically reported?",
		category: "synthesis",
		requiredSourceTypes: ["code", "github-issue"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
	},

	// ── Hard negatives (#311 Phase 1c) ───────────────────────
	// These queries should NOT have a clean answer in the corpus.
	// A retrieval variant that surfaces strong-looking false positives
	// for these is worse, not better. minResults: 0 = vacuous pass on
	// the existing rubric — Phase 1+ tightens this with negative-
	// scoring (top-K score floor + cross-source dispersion check).
	{
		// Implies a GraphQL tenant API and DataLoader-style batching that this corpus does not describe, tempting lexical hits on unrelated API or fetch code.
		id: "hn-1",
		queryText:
			"Where is the GraphQL schema for the public tenant API defined, and how are N+1 queries batched in the resolver layer?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
	},
	{
		// Uses realistic SSO language with no matching auth stack, probing whether retrieval fabricates security-adjacent snippets from issues or comments.
		id: "hn-2",
		queryText:
			"How does the auth middleware refresh OAuth2 bearer tokens when the upstream IdP session expires?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
	},
	{
		// Observability plus ML-shaped wording should not map to storage or payment code, catching spurious matches on metrics or latency mentions.
		id: "hn-3",
		queryText:
			"What Grafana dashboard JSON shows p95 embedding latency for the retrieval reranker service?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
	},
	{
		// Mobile and signing jargon is absent from the flagship corpus, testing resistance to generic CI or container chatter.
		id: "hn-4",
		queryText:
			"Which Dockerfile stage cross-compiles the iOS client frameworks to arm64 and signs them with the enterprise distribution certificate?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
	},
	{
		// ML training and object-storage layout are out of scope, so hits on S3-like storage APIs should stay off-topic or empty.
		id: "hn-5",
		queryText:
			"Where do we shard the fine-tuned LoRA adapter checkpoints across S3 prefixes for A/B evaluation?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
	},
	{
		// Kubernetes operator and HPA semantics are unrelated to Filecoin storage flows, guarding against vague infra keyword overlap.
		id: "hn-6",
		queryText:
			"How does the Kubernetes operator reconcile HPA custom metrics from the Prometheus adapter when the metrics API is throttled?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
	},
	{
		// Near-real DevOps-on-Slack phrasing may co-occur with Slack dumps but should not yield a coherent rollback-and-Argo story.
		id: "hn-7",
		queryText:
			"In the Slack incident bot, which slash command rolls back a canary deployment and posts the Argo CD diff to the war room channel?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 1,
		portability: "portable",
	},
	{
		// Mingles Filecoin Pay with Stripe and ACH, a plausible billing question whose premise is false for this corpus.
		id: "hn-8",
		queryText:
			"How does Filecoin Pay route failed ACH debits through Stripe Radar risk scores before retrying the on-chain deposit?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 2,
		portability: "corpus-specific",
	},
	{
		// Stacks real ecosystem nouns into a validation story that does not hold, baiting conflation of PieceCID, CommD, Curio, and PDP.
		id: "hn-9",
		queryText:
			"Where does Curio reject PieceCID values that fail CommD alignment checks during PDP proof aggregation?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "corpus-specific",
	},
	{
		// Invents a browser WebSocket feed for DataSetStatus, a tempting blend of SDK and state-machine terms with no such surface.
		id: "hn-10",
		queryText:
			"Which synapse-sdk WebSocket channel pushes live DataSetStatus transitions to browser clients without polling?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "corpus-specific",
	},
	{
		// Pins OIDC and RBAC onto filecoin-pin despite no such auth model, risking retrieval of unrelated key or config strings.
		id: "hn-11",
		queryText:
			"How does filecoin-pin enforce per-tenant OIDC group claims when minting scoped API keys for pin jobs?",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "corpus-specific",
	},
	{
		// Near-duplicate of real PieceCID discussions but swaps in libp2p peer-id routing, a cross-domain confusion that must not stitch a fake helper.
		id: "hn-12",
		queryText:
			"Show the helper that converts a PieceCID to a CIDv1 libp2p peer id for gossipsub routing in the storage node.",
		category: "hard-negative",
		requiredSourceTypes: [],
		minResults: 0,
		portability: "corpus-specific",
	},

	// ── #311 Phase 1+ expansion (peer-review item (a)) ──────
	// 90 additional base queries authored via parallel subagent
	// passes (codex/cursor/gemini) over the v12 corpus. Brings
	// total from 67 → 157 base queries — above the ≥150 floor
	// the spec calls for in independent prompt count.
	//
	// codex pass — direct-lookup + cross-source on synapse-sdk +
	// filecoin-services repos:
	{
		id: "dl-9",
		queryText:
			"Which file implements the multi-provider upload facade that orchestrates store, pull, and commit?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["storage/manager.ts"],
		minResults: 1,
		portability: "portable",
	},
	{
		id: "dl-10",
		queryText: "Which helper computes runway, buffer, and total deposit required before an upload?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["calculate-deposit-needed.ts", "get-upload-costs.ts"],
		minResults: 2,
		portability: "portable",
	},
	{
		id: "dl-11",
		queryText:
			"Which file validates a downloaded blob against an expected PieceCID while streaming?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["piece/download.ts"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "dl-12",
		queryText: "Which typed-data modules sign create-data-set and add-pieces payloads?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: [
			"sign-create-dataset.ts",
			"sign-create-dataset-add-pieces.ts",
			"sign-add-pieces.ts",
		],
		minResults: 2,
		portability: "portable",
	},
	{
		id: "dl-13",
		queryText: "Which React hook returns the current service price through react-query?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["use-service-price.ts"],
		minResults: 1,
		portability: "portable",
	},
	{
		id: "dl-14",
		queryText:
			"Which React hook creates a data set, waits on a status URL, and then invalidates cached data-set queries?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["use-create-data-set.ts"],
		minResults: 1,
		portability: "portable",
	},
	{
		id: "dl-15",
		queryText:
			"Which provider-selection logic prefers metadata-matching datasets and explicitly skips health checks?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["select-providers.ts", "fetch-provider-selection-input.ts"],
		minResults: 2,
		portability: "portable",
	},
	{
		id: "dl-16",
		queryText:
			"Which generated Solidity view contract wraps state reads for eth_call, and which script produces it?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: [
			"FilecoinWarmStorageServiceStateView.sol",
			"generate_view_contract.sh",
		],
		minResults: 2,
		portability: "portable",
	},
	{
		id: "dl-17",
		queryText:
			"Which file defines the Synapse class that wires together payments, providers, warm storage, FilBeam, and StorageManager?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["synapse.ts"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "dl-18",
		queryText: "Where does synapse-core implement getSizeFromPieceCID for PieceCIDv2 inputs?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["piece/piece.ts"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "dl-19",
		queryText: "Which file defines the useFilsnap hook that uses wagmi account effects?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["filsnap.ts"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "dl-20",
		queryText:
			"Where is EIP-712 metadata hashing and signature recovery implemented for FilecoinWarmStorageService?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["SignatureVerificationLib.sol"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "dl-21",
		queryText:
			"Which contract owns provider registration plus addProduct, updateProduct, and removeProduct operations?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["ServiceProviderRegistry.sol"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "dl-22",
		queryText:
			"Where do filecoin-services contracts compute dataset Active versus Inactive status for off-chain readers?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: [
			"FilecoinWarmStorageServiceStateLibrary.sol",
			"FilecoinWarmStorageServiceStateView.sol",
		],
		minResults: 2,
		portability: "corpus-specific",
	},
	{
		id: "dl-23",
		queryText:
			"Which session-key files define the login transaction helper and the default FWSS permission hashes?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["session-key/login.ts", "session-key/permissions.ts"],
		minResults: 2,
		portability: "corpus-specific",
	},
	{
		id: "cs-8",
		queryText:
			"What release note describes provider selection moving into a core package, and which source files implement the multi-copy selection flow?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: [
			"synapse-core/CHANGELOG.md",
			"select-providers.ts",
			"storage/manager.ts",
		],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "cs-9",
		queryText:
			"How do the README concepts for data sets, pieces, and payment rails map to the storage context implementation?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: ["synapse-sdk/README.md", "storage/context.ts", "storage/manager.ts"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "cs-10",
		queryText:
			"How is off-chain contract state reading documented and then implemented through a generated view wrapper and extsload-based libraries?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: [
			"service_contracts/README.md",
			"FilecoinWarmStorageServiceStateView.sol",
			"FilecoinWarmStorageServiceStateLibrary.sol",
		],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "cs-11",
		queryText:
			"What issue added session keys with viem, and which source files implement the login and permission pieces?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "code"],
		expectedSourceSubstrings: [
			"synapse-sdk/issues/618",
			"session-key/login.ts",
			"session-key/permissions.ts",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "cs-12",
		queryText:
			"Which issue introduced a storage facade with context objects, and where was it implemented?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "code"],
		expectedSourceSubstrings: [
			"synapse-sdk/issues/153",
			"storage/context.ts",
			"storage/manager.ts",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "cs-13",
		queryText:
			"Which issue changed PieceCIDv2 size extraction, and where is that helper implemented?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "code"],
		expectedSourceSubstrings: ["synapse-sdk/issues/283", "piece/piece.ts"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "cs-14",
		queryText:
			"How is signature verification for typed dataset and add-pieces operations described in docs and implemented in the contract library?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: ["service_contracts/README.md", "SignatureVerificationLib.sol"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "cs-15",
		queryText:
			"How did synapse-sdk issue #618 land across synapse-core, synapse-sdk, and synapse-react?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "code"],
		expectedSourceSubstrings: [
			"synapse-sdk/issues/618",
			"session-key/login.ts",
			"synapse-react/CHANGELOG.md",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "cs-16",
		queryText:
			"How did synapse-sdk issue #209 add session key support, and which exported session-key modules carry that feature now?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "code"],
		expectedSourceSubstrings: [
			"synapse-sdk/issues/209",
			"session-key/index.ts",
			"synapse-sdk/CHANGELOG.md",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "cs-17",
		queryText: "How did synapse-sdk issue #489 change StorageContext clientDataSetId caching?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "code"],
		expectedSourceSubstrings: [
			"synapse-sdk/issues/489",
			"storage/context.ts",
			"synapse-sdk/CHANGELOG.md",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "cs-18",
		queryText:
			"How did synapse-sdk issue #438 remove getClientDataSetsWithDetails from createStorageContext?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "code"],
		expectedSourceSubstrings: [
			"synapse-sdk/issues/438",
			"storage/context.ts",
			"synapse-sdk/CHANGELOG.md",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "cs-19",
		queryText:
			"How do filecoin-services deployment docs and scripts handle linking SignatureVerificationLib into FilecoinWarmStorageService?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: [
			"service_contracts/README.md",
			"warm-storage-deploy-all.sh",
			"SignatureVerificationLib.sol",
		],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "cs-20",
		queryText:
			"How do filecoin-services upgrade docs and scripts line up with announcePlannedUpgrade and nextUpgrade support in the contracts?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: [
			"UPGRADE-PROCESS.md",
			"warm-storage-announce-upgrade.sh",
			"ServiceProviderRegistry.sol",
		],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "cs-21",
		queryText:
			"How do the Synapse SDK breaking-change notes about Warm Storage, Data Sets, Pieces, and Service Providers map to the actual code layout?",
		category: "cross-source",
		requiredSourceTypes: ["markdown", "code"],
		expectedSourceSubstrings: [
			"synapse-sdk/README.md",
			"storage/context.ts",
			"warm-storage/index.ts",
			"piece/piece.ts",
		],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "cs-22",
		queryText:
			"How did synapse-sdk issue #156 show up in the Curio CommPv2 compatibility and PieceCID terminology changes?",
		category: "cross-source",
		requiredSourceTypes: ["github-issue", "code"],
		expectedSourceSubstrings: [
			"synapse-sdk/issues/156",
			"synapse-sdk/CHANGELOG.md",
			"piece/piece.ts",
		],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},

	// cursor pass — coverage + work-lineage on filecoin-pin +
	// curio + filecoin-services repos:
	{
		id: "cov-9",
		queryText:
			"What kinds of IPNI advertisement handling logic exist across this corpus, such as validation, publishing, and error handling?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["ipni", "advertisement", "validate"],
		minResults: 3,
		portability: "portable",
	},
	{
		id: "cov-10",
		queryText:
			"What categories of CommP-related logic appear in the corpus, including computation, verification, and format checks?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["CommP", "piece", "verify"],
		minResults: 3,
		portability: "corpus-specific",
	},
	{
		id: "cov-11",
		queryText:
			"What kinds of PDP artifacts are present, such as proof generation, proof verification, and challenge flow handling?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["pdp", "proof", "challenge"],
		minResults: 3,
		portability: "corpus-specific",
	},
	{
		id: "cov-12",
		queryText:
			"What categories of Filecoin service contract artifacts are represented, including Solidity contracts, ABIs, and state/view interfaces?",
		category: "coverage",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["service_contracts", "abi", "sol"],
		minResults: 3,
		portability: "corpus-specific",
	},
	{
		id: "cov-13",
		queryText:
			"What kinds of dataset lifecycle states and transitions are documented or implemented in this corpus?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["DataSetStatus", "dataset", "state"],
		minResults: 2,
		portability: "corpus-specific",
	},
	{
		id: "cov-14",
		queryText:
			"What categories of billing rail behavior exist, such as deposits, funding, charging, and settlement-related operations?",
		category: "coverage",
		requiredSourceTypes: ["code", "github-issue"],
		expectedSourceSubstrings: ["billing", "deposit", "funding"],
		minResults: 3,
		portability: "portable",
	},
	{
		id: "cov-15",
		queryText:
			"What kinds of retry and resilience patterns appear in the codebase, such as retries, backoff, and circuit-breaker-like guards?",
		category: "coverage",
		requiredSourceTypes: ["code", "github-pr-comment"],
		expectedSourceSubstrings: ["retry", "backoff", "circuit"],
		minResults: 3,
		portability: "portable",
	},
	{
		id: "cov-16",
		queryText:
			"What categories of indexer integration behavior are represented, including advertisement ingestion, lookup, and synchronization?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["indexer", "ipni", "sync"],
		minResults: 3,
		portability: "portable",
	},
	{
		id: "cov-17",
		queryText:
			"What kinds of cross-language boundaries exist between TypeScript and Solidity artifacts in this corpus?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["synapse-core", "service_contracts", "abi"],
		minResults: 2,
		portability: "corpus-specific",
	},
	{
		id: "cov-18",
		queryText:
			"What categories of sector and deal validation logic are present, including checks around sectors, deals, and proof preconditions?",
		category: "coverage",
		requiredSourceTypes: ["code", "github-pr"],
		expectedSourceSubstrings: ["sector", "deal", "validate"],
		minResults: 3,
		portability: "portable",
	},
	{
		id: "cov-19",
		queryText:
			"What kinds of contract upgrade mechanisms or upgrade discussions exist across the service contracts and related implementation code?",
		category: "coverage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["upgrade", "contract", "service_contracts"],
		minResults: 2,
		portability: "corpus-specific",
	},
	{
		id: "cov-20",
		queryText:
			"What categories of staking or slot-leasing mechanics are represented in contracts and surrounding implementation artifacts?",
		category: "coverage",
		requiredSourceTypes: ["code", "github-issue"],
		expectedSourceSubstrings: ["stake", "slot", "lease"],
		minResults: 2,
		portability: "portable",
	},
	{
		id: "wl-9",
		queryText:
			"Where is IPNI advertisement validation implemented, and which PR or issue discussions explain why those validation checks were added?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["validate-ipni-advertisement", "ipni", "advertisement"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "demo-critical",
		portability: "corpus-specific",
	},
	{
		id: "wl-10",
		queryText:
			"Trace the implementation lineage for CommP verification in code and the PR comment trail that debated correctness or edge cases.",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["CommP", "verify", "piece"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "demo-critical",
		portability: "corpus-specific",
	},
	{
		id: "wl-11",
		queryText:
			"How does the dataset lifecycle state machine get implemented in filecoin-services code, and what issue or PR threads document transition rationale?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["DataSetStatus", "service_contracts", "transition"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "demo-critical",
		portability: "corpus-specific",
	},
	{
		id: "wl-12",
		queryText:
			"Show the cross-org lineage from curio PDP proof verification code to the PRs that discuss verifier behavior and failure handling.",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["curio", "pdp", "verify"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "demo-critical",
		portability: "corpus-specific",
	},
	{
		id: "wl-13",
		queryText:
			"Which TypeScript components in synapse-core consume contract ABI or service contract interfaces, and what PR/issue history explains those boundaries?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["synapse-core", "abi", "service_contracts"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-14",
		queryText:
			"Trace indexer integration work from implementation files to the PR discussions that mention IPNI/indexer synchronization behavior.",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["indexer", "ipni", "sync"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-15",
		queryText:
			"Where are retry or backoff behaviors implemented for external calls, and what issue or PR comment history explains those resilience choices?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["retry", "backoff", "error"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "wl-16",
		queryText:
			"How did contract upgrade changes move from Solidity/ABI implementation to PR review discussion, and what concerns were raised about migration safety?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["upgrade", "abi", "sol"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-17",
		queryText:
			"Trace deal lifecycle validation from curio-side code paths to related issue/PR threads that discuss invalid deal or sector edge cases.",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["curio", "deal", "sector"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-18",
		queryText:
			"Where is billing rail logic implemented for funding/deposit flows, and what PR/issue discussions explain charging or settlement behavior changes?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["billing", "funding", "deposit"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-19",
		queryText:
			"Which PDP challenge-generation or challenge-validation code changes can be linked to PR comments discussing proof reliability and operator impact?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["pdp", "challenge", "proof"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-20",
		queryText:
			"Trace how service contract state/view interfaces are used in implementation code and connected to issues/PRs that clarified contract semantics.",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["service_contracts", "State", "View"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-21",
		queryText:
			"Where are slot leasing mechanics implemented, and what PR or issue history explains leasing rules, limits, or arbitration behavior?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["slot", "lease", "service_contracts"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-22",
		queryText:
			"Trace staking mechanics from contract code to issue/PR commentary that discusses stake requirements, slashing risk, or incentive alignment.",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["stake", "contract", "service_contracts"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-23",
		queryText:
			"How did indexer advertisement ingestion evolve from code changes to issue/PR discussions about malformed advertisement handling?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["indexer", "advertisement", "malformed"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "wl-24",
		queryText:
			"Which curio PDP implementation files map to cross-org PRs that reference filecoin-services contract assumptions, and what was resolved in review comments?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		expectedSourceSubstrings: ["curio", "pdp", "filecoin-services"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "wl-25",
		queryText:
			"Trace TypeScript-to-Solidity boundary work where SDK code paths were updated alongside contract artifacts, including the issue/PR lineage for those changes.",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["synapse-core", "abi", "sol"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "wl-26",
		queryText:
			"Where do sector validation checks in curio connect to issue and PR discussion trails about deal acceptance criteria and proof preconditions?",
		category: "work-lineage",
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		expectedSourceSubstrings: ["curio", "sector", "deal"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},

	// gemini pass — portable + file-level + synthesis tier:
	{
		id: "port-4",
		queryText: "How is the command line interface structured and where are subcommands defined?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-5",
		queryText:
			"What are the common error patterns used across the codebase and how are they handled?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-6",
		queryText: "Describe the project's dependency injection or service registration pattern.",
		category: "synthesis",
		requiredSourceTypes: ["code"],
		minResults: 2,
		requireEdgeHop: true,
		portability: "portable",
	},
	{
		id: "port-7",
		queryText: "How are secrets and sensitive environment variables managed and validated?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-8",
		queryText: "What is the strategy for handling asynchronous tasks or background jobs?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-9",
		queryText: "Which documentation files provide the best overview of the system's architecture?",
		category: "cross-source",
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		portability: "portable",
	},
	{
		id: "port-10",
		queryText:
			"Are there any mentions of performance bottlenecks or optimization goals in the documentation or issues?",
		category: "cross-source",
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-11",
		queryText: "How does the code interact with external APIs or third-party services?",
		category: "cross-source",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-12",
		queryText: "What logging levels are supported and where is the logger initialized?",
		category: "cross-source",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-13",
		queryText: "How is data persistence handled and what database or storage engine is used?",
		category: "cross-source",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-14",
		queryText:
			"What is the test coverage strategy for new features according to the development guidelines?",
		category: "coverage",
		requiredSourceTypes: ["markdown"],
		minResults: 1,
		portability: "portable",
	},
	{
		id: "port-15",
		queryText:
			"Are there any unimplemented features or TODOs mentioned in the source code or issues?",
		category: "coverage",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["TODO"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-16",
		queryText:
			"What are the core types or data structures that represent the primary entities in this system?",
		category: "coverage",
		requiredSourceTypes: ["code"],
		minResults: 3,
		requireEdgeHop: true,
		portability: "portable",
	},
	{
		id: "port-17",
		queryText: "How is the CI/CD pipeline configured and what are the main build stages?",
		category: "coverage",
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "port-18",
		queryText: "Are there any deprecated functions or modules that should no longer be used?",
		category: "coverage",
		requiredSourceTypes: ["code", "markdown"],
		expectedSourceSubstrings: ["@deprecated", "deprecated"],
		minResults: 1,
		requireCrossSourceHops: true,
		portability: "portable",
	},
	{
		id: "fl-5",
		queryText: "Which file defines the HierarchicalCodeChunker class?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["HierarchicalCodeChunker"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "fl-6",
		queryText: "Where is the implementation of the main entry point for the CLI?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["cli", "main"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "fl-7",
		queryText: "Which file contains the configuration schema or interface definitions?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["config", "schema"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "fl-8",
		queryText: "Where is the code that handles GitHub API integration and event processing?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["github", "client"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "fl-9",
		queryText: "Which file defines the storage interface for the Fact Oriented Codebase?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["store", "interface"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "fl-10",
		queryText: "Where is the implementation of the RAG pipeline's embedding logic?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["embed", "embedding"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "fl-11",
		queryText: "Which file manages the ingestion of Slack or chat messages?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["slack", "chat", "ingest"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "fl-12",
		queryText: "Where are the constants and utility functions for edge extraction defined?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["edge", "extract"],
		minResults: 1,
		portability: "corpus-specific",
	},
	{
		id: "syn-18",
		queryText:
			"What is the observability strategy, including logging patterns and any telemetry or tracing instrumentation?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "syn-19",
		queryText:
			"How are error retry semantics and transient failure handling implemented across network-bound components?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "syn-20",
		queryText:
			"Analyze the security threat model: how does the system handle untrusted input during ingestion and how are cross-tenant boundaries enforced?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 4,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "syn-21",
		queryText:
			"What is the data migration story? Describe how schema changes are handled and how historical facts are re-indexed.",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "syn-22",
		queryText:
			"Describe the testing strategy, distinguishing between unit, integration, and e2e tests, and how they are verified in CI.",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 4,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "syn-23",
		queryText:
			"How is the dependency injection or plugin architecture structured to allow for extensible ingestion sources?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
	{
		id: "syn-24",
		queryText:
			"Are there specific performance benchmarks or scalability triggers documented, and how does the code address these limits?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
	},
];
