/**
 * @deprecated Legacy gold-standard fixture preserved during the #344 step-1
 * schema overhaul. The new schema lives in `gold-standard-queries.ts` with the
 * `GoldQuery` interface. The migrator at
 * `scripts/autoresearch/migrate-gold-queries.ts` reads this module as input
 * and emits the new fixture; this file is deleted when migration is ratified.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */
export const LEGACY_GOLD_STANDARD_QUERIES_VERSION = "1.9.0";

export interface LegacyGoldStandardQuery {
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

export const LEGACY_GOLD_STANDARD_QUERIES: LegacyGoldStandardQuery[] = [
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
		paraphrases: [
			"What file contains the upload coordinator that fronts multiple providers and drives store, pull, and commit steps?",
			"Where is the multi-provider upload facade implemented that sequences storing, pulling, and committing?",
			"Which source file is responsible for orchestrating store/pull/commit through a unified multi-provider upload layer?",
		],
	},
	{
		id: "dl-10",
		queryText: "Which helper computes runway, buffer, and total deposit required before an upload?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["calculate-deposit-needed.ts", "get-upload-costs.ts"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"What helper calculates the runway, safety buffer, and full deposit needed before starting an upload?",
			"Which utility figures out required upload funding, including runway, buffer, and total deposit?",
			"Where is the pre-upload deposit calculator that derives runway, buffer, and overall required funds?",
		],
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
		paraphrases: [
			"Which file performs streaming validation of a downloaded blob against a target PieceCID?",
			"Where is downloaded content checked on the fly to ensure it matches the expected PieceCID?",
			"What source file verifies a streamed download against an expected PieceCID while reading it?",
		],
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
		paraphrases: [
			"Which typed-data files are used to sign the create-data-set and add-pieces messages?",
			"Where are the EIP-712-style modules for signing create-data-set and add-pieces payloads defined?",
			"What typed-data modules cover signatures for both dataset creation and piece addition requests?",
		],
	},
	{
		id: "dl-13",
		queryText: "Which React hook returns the current service price through react-query?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["use-service-price.ts"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"Which React hook exposes the current service price via react-query?",
			"Where is the hook that fetches and returns the current service price using react-query?",
			"What React hook provides service pricing through a react-query-backed call?",
		],
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
		paraphrases: [
			"Which hook creates a dataset, polls a status URL until completion, and then invalidates cached dataset queries?",
			"Where is the React hook that submits dataset creation, waits on the returned status endpoint, and refreshes dataset cache entries?",
			"What hook handles create-data-set, follows the status URL, and finally invalidates react-query dataset caches?",
		],
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
		paraphrases: [
			"Which provider-picking logic favors datasets whose metadata matches and deliberately avoids health checks?",
			"Where is the selection flow that prioritizes metadata-aligned datasets while explicitly skipping provider health probes?",
			"What code chooses providers by preferring metadata matches and not running health checks?",
		],
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
		paraphrases: [
			"Which generated Solidity reader contract is used for eth_call state access, and what script generates it?",
			"Where is the auto-generated Solidity view wrapper for eth_call reads, and which script builds it?",
			"What generated contract wraps on-chain state reads for eth_call, and what generation script produces that artifact?",
		],
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
		paraphrases: [
			"Which file declares the Synapse class that composes payments, providers, warm storage, FilBeam, and StorageManager?",
			"Where is the main Synapse class defined that wires together payment handling, provider logic, warm storage, FilBeam, and the storage manager?",
			"What source file contains the Synapse class integrating payments, providers, warm storage, FilBeam, and StorageManager?",
		],
	},
	{
		id: "dl-18",
		queryText: "Where does synapse-core implement getSizeFromPieceCID for PieceCIDv2 inputs?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["piece/piece.ts"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where in synapse-core is getSizeFromPieceCID implemented for PieceCIDv2 values?",
			"Which synapse-core file contains the PieceCIDv2-specific getSizeFromPieceCID logic?",
			"What location in synapse-core handles size extraction from PieceCIDv2 through getSizeFromPieceCID?",
		],
	},
	{
		id: "dl-19",
		queryText: "Which file defines the useFilsnap hook that uses wagmi account effects?",
		category: "direct-lookup",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["filsnap.ts"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file defines the useFilsnap hook built around wagmi account effects?",
			"Where is the React hook useFilsnap implemented with wagmi account effect handling?",
			"What source file contains the useFilsnap hook that reacts to wagmi account changes?",
		],
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
		paraphrases: [
			"Where is EIP-712 metadata hashing plus signature recovery implemented for FilecoinWarmStorageService?",
			"Which file contains the metadata hash and signature recovery logic used by FilecoinWarmStorageService?",
			"What contract-side implementation handles typed-data metadata hashing and signer recovery for FilecoinWarmStorageService?",
		],
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
		paraphrases: [
			"Which contract is responsible for provider registration and the addProduct, updateProduct, and removeProduct functions?",
			"Where are provider enrollment and product add/update/remove operations owned on-chain?",
			"What contract manages service provider registration along with addProduct, updateProduct, and removeProduct?",
		],
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
		paraphrases: [
			"Where do the filecoin-services contracts derive Active versus Inactive dataset status for off-chain consumers?",
			"Which contract code computes whether a dataset is Active or Inactive for off-chain state readers?",
			"What part of filecoin-services determines dataset Active/Inactive status in state exposed to off-chain readers?",
		],
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
		paraphrases: [
			"Which session-key files contain the login transaction helper and the default FWSS permission hash definitions?",
			"Where are the login helper for session keys and the default FWSS permission hashes implemented?",
			"What session-key source files define both the login transaction utility and the default FWSS permission hash set?",
		],
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
		paraphrases: [
			"Which release note says provider selection was moved into a core package, and what files now implement multi-copy provider selection?",
			"Where is the release documentation for provider selection shifting into core, and which source files realize the multi-copy selection path?",
			"What changelog entry covers moving provider choice into the core package, and where is the multi-copy selection flow implemented?",
		],
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
		paraphrases: [
			"How do the README explanations of datasets, pieces, and payment rails correspond to the storage context code?",
			"Map the README concepts around data sets, pieces, and payment rails onto the actual storage context implementation.",
			"Where do the README-level ideas for datasets, pieces, and payment rails show up in storage context code?",
		],
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
		paraphrases: [
			"How is off-chain contract state access described in docs, and how is it realized through a generated view wrapper plus extsload libraries?",
			"What documentation explains off-chain contract reads, and how do the generated view contract and extsload-based libraries implement that design?",
			"Trace the path from docs about off-chain state reading to the generated wrapper and extsload libraries that implement it.",
		],
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
		paraphrases: [
			"Which issue introduced viem-based session keys, and what files implement the login flow and permission handling?",
			"What GitHub issue added session-key support with viem, and where are the login and permission components in source?",
			"Which issue tracks viem session keys, and which files contain the resulting login helper and permission logic?",
		],
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
		paraphrases: [
			"Which issue added the storage facade built around context objects, and where was that work implemented?",
			"What issue introduced a context-based storage facade, and which source files landed the implementation?",
			"Trace the issue that brought in the storage facade with context objects and identify where it was coded.",
		],
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
		paraphrases: [
			"Which issue changed how PieceCIDv2 size extraction works, and where is the updated helper implemented?",
			"What issue covers the PieceCIDv2 size-extraction change, and which file contains the helper now?",
			"Trace the issue that modified PieceCIDv2 size parsing and point to the helper implementation.",
		],
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
		paraphrases: [
			"How do docs describe signature verification for typed dataset and add-pieces actions, and where is that logic implemented in contract code?",
			"Where is signature verification for dataset creation and piece addition documented, and which contract library actually performs it?",
			"Trace the documented story for typed dataset/add-pieces signature checking into the contract library implementation.",
		],
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
		paraphrases: [
			"How was synapse-sdk issue #618 reflected across synapse-core, synapse-sdk, and synapse-react?",
			"What changed for synapse-sdk issue #618 across the core package, the SDK, and the React layer?",
			"Trace how issue #618 in synapse-sdk landed across synapse-core, synapse-sdk, and synapse-react.",
		],
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
		paraphrases: [
			"How did synapse-sdk issue #209 introduce session keys, and which exported session-key modules now carry that functionality?",
			"Trace issue #209 from session-key support design to the currently exported session-key modules.",
			"What was the implementation path for synapse-sdk issue #209, and which session-key exports represent that feature today?",
		],
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
		paraphrases: [
			"How did synapse-sdk issue #489 alter StorageContext caching for clientDataSetId?",
			"What changed in StorageContext clientDataSetId caching as part of synapse-sdk issue #489?",
			"Trace the effect of issue #489 on how StorageContext caches clientDataSetId values.",
		],
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
		paraphrases: [
			"How did synapse-sdk issue #438 remove getClientDataSetsWithDetails from createStorageContext?",
			"What changes from issue #438 caused createStorageContext to stop exposing getClientDataSetsWithDetails?",
			"Trace issue #438 and explain how getClientDataSetsWithDetails was removed from createStorageContext.",
		],
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
		paraphrases: [
			"How do filecoin-services deployment docs and scripts manage linking SignatureVerificationLib into FilecoinWarmStorageService?",
			"Where do the deployment instructions and scripts show SignatureVerificationLib being linked into FilecoinWarmStorageService?",
			"Trace how documentation and deployment scripts handle library linking for SignatureVerificationLib and FilecoinWarmStorageService.",
		],
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
		paraphrases: [
			"How do the filecoin-services upgrade docs and scripts correspond to announcePlannedUpgrade and nextUpgrade support in contracts?",
			"What documentation and scripting around upgrades lines up with the contract support for announcePlannedUpgrade and nextUpgrade?",
			"Trace the relationship between upgrade docs/scripts and the Solidity implementation of announcePlannedUpgrade plus nextUpgrade.",
		],
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
		paraphrases: [
			"How do the Synapse SDK breaking-change notes for Warm Storage, Data Sets, Pieces, and Service Providers map onto the current code layout?",
			"Where do the breaking-change notes about warm storage, datasets, pieces, and service providers show up in actual package structure?",
			"Map the Synapse SDK breaking-change documentation for Warm Storage/Data Sets/Pieces/Service Providers to the real code organization.",
		],
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
		paraphrases: [
			"How did synapse-sdk issue #156 surface in Curio CommPv2 compatibility updates and PieceCID terminology changes?",
			"Trace issue #156 through the CommPv2 compatibility work in Curio and the related PieceCID naming changes.",
			"What code and docs reflect synapse-sdk issue #156 in terms of Curio CommPv2 support and updated PieceCID terminology?",
		],
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
		paraphrases: [
			"What IPNI advertisement handling themes are present here, including validation, publishing, and error paths?",
			"Survey the corpus for IPNI advertisement logic such as validation rules, publication flows, and failure handling.",
			"Which categories of IPNI advertisement behavior appear across the code and docs, from publish to validation to error management?",
		],
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
		paraphrases: [
			"What CommP-related logic exists across the corpus, covering calculation, verification, and format validation?",
			"Survey the repository for CommP functionality, including generation, checking, and format-related safeguards.",
			"Which kinds of CommP code paths appear here, from computing values to verifying them and checking representation details?",
		],
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
		paraphrases: [
			"What PDP artifacts are represented, such as challenge handling, proof generation, and proof verification?",
			"Inventory the PDP-related material in the corpus, including proof creation, proof checking, and challenge-flow logic.",
			"Which PDP components show up across the codebase, covering challenges, proof generation, and verifier-side behavior?",
		],
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
		paraphrases: [
			"What categories of Filecoin service contract artifacts exist here, including Solidity source, ABIs, and view/state interfaces?",
			"Survey the corpus for filecoin-services contract artifacts like Solidity contracts, ABI outputs, and state-reading interfaces.",
			"Which kinds of service-contract deliverables are present, from Solidity implementations to ABI files and view-layer interfaces?",
		],
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
		paraphrases: [
			"What dataset lifecycle states and state transitions are documented or implemented in this corpus?",
			"Survey the repository for dataset lifecycle stages and the transitions between them, whether described or coded.",
			"Which dataset lifecycle statuses and movement rules appear across docs and implementation?",
		],
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
		paraphrases: [
			"What billing rail behaviors appear in the corpus, including deposit, funding, charging, and settlement flows?",
			"Survey the codebase for payment-rail mechanics such as funding, deposits, charge application, and settlement-related steps.",
			"Which categories of billing-rail logic are represented here, from prefunding through charging and settlement?",
		],
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
		paraphrases: [
			"What retry and resilience patterns show up in the codebase, including retries, backoff, and circuit-breaker-style protections?",
			"Survey the repository for transient-failure handling patterns such as retry loops, backoff strategies, and guardrails around repeated failures.",
			"Which kinds of resilience logic are implemented across the code, including retry semantics, delay policies, and breaker-like checks?",
		],
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
		paraphrases: [
			"What categories of indexer integration behavior are present, including ad ingestion, lookup flows, and synchronization?",
			"Survey the corpus for indexer-related logic such as advertisement ingestion, query/lookup behavior, and sync processes.",
			"Which kinds of indexer integration appear across the repo, from advertisement intake to lookup and synchronization handling?",
		],
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
		paraphrases: [
			"What cross-language boundaries between TypeScript and Solidity artifacts exist in this corpus?",
			"Survey where TypeScript code interfaces with Solidity outputs or contracts across the repository.",
			"Which parts of the corpus sit at the TS/Solidity boundary, such as generated artifacts, ABI use, or contract wrappers?",
		],
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
		paraphrases: [
			"What sector and deal validation logic is present, including checks on sectors, deals, and proof prerequisites?",
			"Survey the repository for validation around sectors and deals, including preconditions needed before proofs can proceed.",
			"Which categories of sector/deal checking appear here, from acceptance validation to proof-related prerequisite checks?",
		],
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
		paraphrases: [
			"What contract upgrade mechanisms or upgrade-related discussions exist across the service contracts and surrounding code?",
			"Survey the corpus for upgrade patterns in contracts and any related implementation or documentation about upgrades.",
			"Which kinds of contract-upgrade support and upgrade discussion are represented across service contracts and their tooling?",
		],
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
		paraphrases: [
			"What staking or slot-leasing mechanics are represented in contracts and adjacent implementation artifacts?",
			"Survey the code and docs for staking behavior or slot-leasing rules and their supporting implementation.",
			"Which categories of staking and leasing mechanics appear across the repository, both on-chain and in surrounding code?",
		],
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
		tier: "diagnostic",
		portability: "corpus-specific",
		paraphrases: [
			"Where is IPNI advertisement validation coded, and which PRs or issues explain why those checks were introduced?",
			"Trace IPNI advertisement validation from implementation files back to the PR or issue discussions that justified it.",
			"What source implements IPNI ad validation, and what issue or PR commentary explains the reasoning for those validations?",
		],
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
		tier: "diagnostic",
		portability: "corpus-specific",
		paraphrases: [
			"Trace CommP verification from the implementation to the PR comment history that discussed correctness and edge cases.",
			"Where is CommP verification implemented, and what PR discussion debated whether it handled corner cases correctly?",
			"Follow the lineage of CommP verification in code and identify the review threads that argued about correctness details.",
		],
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
		tier: "diagnostic",
		portability: "corpus-specific",
		paraphrases: [
			"How is the dataset lifecycle state machine implemented in filecoin-services, and what issue or PR discussions explain the transition decisions?",
			"Trace dataset lifecycle state handling in filecoin-services code back to issue or review threads that justify the state transitions.",
			"Where does filecoin-services implement dataset state transitions, and which PRs or issues document the rationale behind them?",
		],
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
		tier: "diagnostic",
		portability: "corpus-specific",
		paraphrases: [
			"Show how curio PDP proof-verification code connects to PRs discussing verifier behavior and failure handling.",
			"Trace curio's PDP verifier implementation to the PR threads that talk about failure modes and verifier semantics.",
			"Which curio proof-verification files map to PR discussions about PDP verifier behavior and handling verification failures?",
		],
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
		paraphrases: [
			"Which synapse-core TypeScript modules consume contract ABIs or service-contract interfaces, and what PR or issue history explains those integration points?",
			"Trace the TypeScript modules in synapse-core that depend on contract ABIs or service interfaces, along with the issue/PR rationale for those boundaries.",
			"What TS components in synapse-core sit on contract-interface boundaries, and which PRs or issues explain why they are structured that way?",
		],
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
		paraphrases: [
			"Trace indexer integration work from implementation files to the PR discussions that mention IPNI/indexer sync behavior.",
			"Where is indexer synchronization implemented, and which PR or issue threads talk about IPNI sync expectations?",
			"Follow the code path for indexer integration into the review history that discusses synchronization with IPNI or indexers.",
		],
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
		paraphrases: [
			"Where are retry or backoff patterns implemented for external calls, and what PR or issue history explains those resilience decisions?",
			"Trace network-call retry and backoff code to the discussions that justify the chosen resilience behavior.",
			"Which files implement retries around external interactions, and what issue or PR commentary explains the backoff strategy?",
		],
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
		paraphrases: [
			"How did contract upgrade work move from Solidity and ABI changes into PR review, and what migration-safety concerns came up?",
			"Trace contract upgrade support from implementation artifacts to review discussions that raised migration or upgrade safety risks.",
			"Where do the contract upgrade changes land in code, and what PR comments discuss safe migration concerns?",
		],
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
		paraphrases: [
			"Trace deal-lifecycle validation from curio code paths to the issues or PRs that discuss invalid deal and sector edge cases.",
			"Where is deal validation implemented on the curio side, and which review threads discuss rejected deals or sector-related corner cases?",
			"Follow curio's deal-validation paths into the issue/PR history that covers invalid-deal and sector edge-case handling.",
		],
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
		paraphrases: [
			"Where is billing-rail logic for funding and deposit flows implemented, and what PR or issue discussions explain charging or settlement changes?",
			"Trace deposit/funding code for the billing rail back to issue or PR commentary about charging and settlement behavior.",
			"Which implementation files handle billing funding flows, and what review history explains shifts in charge or settlement semantics?",
		],
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
		paraphrases: [
			"Which PDP challenge-generation or validation changes can be tied to PR comments about proof reliability and operator impact?",
			"Trace PDP challenge creation or checking changes to review discussions focused on proof robustness and operational consequences.",
			"What code changes around PDP challenge generation/validation line up with PR commentary about verifier reliability or operator burden?",
		],
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
		paraphrases: [
			"Trace how service-contract state and view interfaces are consumed in implementation code and connected to issues or PRs clarifying contract semantics.",
			"Where are state/view interfaces from the service contracts used, and which issue or review threads explain what those interfaces mean?",
			"Follow the use of service-contract read interfaces in code back to PRs or issues that clarified their semantics.",
		],
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
		paraphrases: [
			"Where are slot-leasing mechanics implemented, and what PR or issue history explains the leasing rules, limits, or arbitration?",
			"Trace slot-leasing code to the issue or PR discussions that define limits, rule enforcement, or dispute handling.",
			"Which files implement slot leasing, and what review history explains how leasing constraints or arbitration are supposed to work?",
		],
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
		paraphrases: [
			"Trace staking mechanics from contract implementation to issue or PR commentary about stake requirements, slashing exposure, or incentives.",
			"Where is staking behavior coded, and which PR or issue discussions cover required stake levels, slashing risk, or incentive design?",
			"Follow staking-related contracts and code into the review history that discusses stake sizing, slashing, and incentive alignment.",
		],
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
		paraphrases: [
			"How did indexer advertisement ingestion evolve from code changes to issue or PR discussion about malformed advertisements?",
			"Trace the implementation history of advertisement ingestion into review threads focused on malformed IPNI ads.",
			"Where are indexer ad-ingestion changes implemented, and what PR or issue commentary discusses bad or malformed advertisement handling?",
		],
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
		paraphrases: [
			"Which curio PDP implementation files correspond to cross-org PRs referencing filecoin-services contract assumptions, and what was resolved in review?",
			"Trace curio PDP files to external or cross-org PR discussions that depended on filecoin-services contract assumptions, and summarize what review settled.",
			"What curio PDP source changes map to PRs mentioning filecoin-services contract assumptions, and what conclusions came out of review comments?",
		],
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
		paraphrases: [
			"Trace TypeScript-to-Solidity boundary changes where SDK code paths were updated alongside contract artifacts, including the issue and PR lineage.",
			"Where did TS SDK code and Solidity artifacts change together, and what issue/PR trail documents that boundary work?",
			"Follow updates that touched both SDK TypeScript paths and contract artifacts, along with the linked issue and PR history.",
		],
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
		paraphrases: [
			"Where do curio sector-validation checks connect to issue and PR discussion about deal acceptance criteria and proof prerequisites?",
			"Trace curio's sector validation logic to the issue or review history covering deal-admission rules and proof preconditions.",
			"Which curio sector-checking files line up with PR or issue discussions about acceptance criteria for deals and required proof conditions?",
		],
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
		paraphrases: [
			"How is the CLI organized, and where are its subcommands declared?",
			"What is the structure of the command-line interface, and in which files are command definitions registered?",
			"Where can I see how the CLI is assembled and where each subcommand gets defined?",
		],
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
		paraphrases: [
			"What recurring error-handling patterns does the codebase use, and how are those errors processed?",
			"Survey the common error styles in the project and explain how failures are handled.",
			"How does this codebase typically model and respond to errors across modules?",
		],
	},
	{
		id: "port-6",
		queryText: "Describe the project's dependency injection or service registration pattern.",
		category: "synthesis",
		requiredSourceTypes: ["code"],
		minResults: 2,
		requireEdgeHop: true,
		portability: "portable",
		paraphrases: [
			"What dependency-injection or service-registration pattern does the project use?",
			"How are services wired together in this system; is there a DI or registration mechanism?",
			"Describe how components are instantiated and registered if the codebase uses dependency injection or a service container.",
		],
	},
	{
		id: "port-7",
		queryText: "How are secrets and sensitive environment variables managed and validated?",
		category: "synthesis",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"How are secrets and sensitive env vars validated and managed?",
			"What is the pattern for handling confidential configuration values and checking that required environment variables are present?",
			"Where does the system define and validate secrets or sensitive environment-based settings?",
		],
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
		paraphrases: [
			"What approach does the project take for async work or background-job processing?",
			"How are asynchronous tasks and background jobs modeled and executed in the system?",
			"Describe the strategy for running deferred or background work across the codebase.",
		],
	},
	{
		id: "port-9",
		queryText: "Which documentation files provide the best overview of the system's architecture?",
		category: "cross-source",
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"Which docs are the best entry points for understanding the overall architecture?",
			"What documentation files give the clearest high-level system overview?",
			"If I want the architectural big picture, which docs should I read first?",
		],
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
		paraphrases: [
			"Do the docs or issues mention any known performance bottlenecks or optimization targets?",
			"Where are performance concerns or optimization goals called out in documentation or issue history?",
			"Are there documented hotspots, scaling concerns, or stated optimization priorities anywhere in the repo?",
		],
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
		paraphrases: [
			"How does the codebase integrate with external APIs or third-party services?",
			"What are the main patterns for calling outside services and third-party APIs?",
			"Where and how does the system talk to external platforms or vendor APIs?",
		],
	},
	{
		id: "port-12",
		queryText: "What logging levels are supported and where is the logger initialized?",
		category: "cross-source",
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"What log levels exist, and where is the logger configured or created?",
			"Which logging severities are supported by the project, and where does logger initialization happen?",
			"How is logging set up, including the available levels and the code that boots the logger?",
		],
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
		paraphrases: [
			"How is persistence handled, and what database or storage backend does the system use?",
			"What storage engine or database underlies the application, and how does the code manage persistence?",
			"Describe the project's data persistence layer and the backing database or storage mechanism it relies on.",
		],
	},
	{
		id: "port-14",
		queryText:
			"What is the test coverage strategy for new features according to the development guidelines?",
		category: "coverage",
		requiredSourceTypes: ["markdown"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What do the development guidelines say about test coverage for new features?",
			"How are contributors expected to test new functionality according to the project's guidelines?",
			"What is the stated testing expectation for newly added features?",
		],
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
		paraphrases: [
			"Are there any TODOs or known-unimplemented features mentioned in code or issue discussions?",
			"Where does the repo call out unfinished work, whether as TODO comments or open issue notes?",
			"What unimplemented features or pending tasks are explicitly mentioned in source or issue history?",
		],
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
		paraphrases: [
			"What are the main entity types or core data structures in the system?",
			"Which types or structs model the primary concepts this project revolves around?",
			"Describe the foundational data structures that represent the system's key entities.",
		],
	},
	{
		id: "port-17",
		queryText: "How is the CI/CD pipeline configured and what are the main build stages?",
		category: "coverage",
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"How is CI/CD set up, and what are the major build or test stages?",
			"What does the pipeline configuration look like, including the main steps for build, test, and delivery?",
			"Where is the CI/CD workflow defined, and what are its principal stages?",
		],
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
		paraphrases: [
			"Are any functions or modules marked as deprecated or no longer recommended?",
			"What parts of the codebase are considered deprecated and should be avoided?",
			"Does the repository identify any APIs or modules as obsolete?",
		],
	},
	{
		id: "fl-5",
		queryText: "Which file defines the HierarchicalCodeChunker class?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["HierarchicalCodeChunker"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file contains the HierarchicalCodeChunker class definition?",
			"Where is HierarchicalCodeChunker implemented?",
			"What source file declares the HierarchicalCodeChunker class?",
		],
	},
	{
		id: "fl-6",
		queryText: "Where is the implementation of the main entry point for the CLI?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["cli", "main"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where is the CLI's main entry point implemented?",
			"Which file contains the primary startup code for the command-line interface?",
			"What source file serves as the main entry point for the CLI?",
		],
	},
	{
		id: "fl-7",
		queryText: "Which file contains the configuration schema or interface definitions?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["config", "schema"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file defines the configuration schema or interfaces?",
			"Where are the project's config types or schema definitions located?",
			"What source file contains the configuration interface or validation schema?",
		],
	},
	{
		id: "fl-8",
		queryText: "Where is the code that handles GitHub API integration and event processing?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["github", "client"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where is GitHub API integration and event handling implemented?",
			"Which file manages GitHub API calls along with event-processing logic?",
			"What source file contains the code for GitHub integration and incoming event handling?",
		],
	},
	{
		id: "fl-9",
		queryText: "Which file defines the storage interface for the Fact Oriented Codebase?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["store", "interface"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file defines the storage interface for the Fact Oriented Codebase?",
			"Where is the core storage contract for the Fact Oriented Codebase declared?",
			"What file contains the storage interface used by the Fact Oriented Codebase?",
		],
	},
	{
		id: "fl-10",
		queryText: "Where is the implementation of the RAG pipeline's embedding logic?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["embed", "embedding"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where is the embedding logic for the RAG pipeline implemented?",
			"Which file contains the code that generates embeddings in the RAG flow?",
			"What source file handles embedding generation for the retrieval pipeline?",
		],
	},
	{
		id: "fl-11",
		queryText: "Which file manages the ingestion of Slack or chat messages?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["slack", "chat", "ingest"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file is responsible for ingesting Slack or chat messages?",
			"Where is the code that processes Slack or other chat-message ingestion?",
			"What source file manages chat-message ingestion, including Slack data?",
		],
	},
	{
		id: "fl-12",
		queryText: "Where are the constants and utility functions for edge extraction defined?",
		category: "file-level",
		requiredSourceTypes: ["code"],
		expectedSourceSubstrings: ["edge", "extract"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where are the edge-extraction constants and helper utilities defined?",
			"Which file contains shared constants and utility functions used for edge extraction?",
			"What source file defines the reusable helpers and constants for extracting edges?",
		],
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
		paraphrases: [
			"What is the system's observability approach, including logging conventions and any telemetry or tracing hooks?",
			"Describe how observability is handled here, covering logs, metrics, traces, or instrumentation if present.",
			"How does the project approach observability across logging patterns and any telemetry or tracing support?",
		],
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
		paraphrases: [
			"How are retry policies and transient-failure handling implemented across components that make network calls?",
			"Describe the way network-bound modules deal with temporary failures, including retries and related semantics.",
			"What are the retry and transient-error strategies used by components that depend on remote services?",
		],
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
		paraphrases: [
			"Analyze the threat model: how does ingestion treat untrusted input, and how are tenant boundaries enforced?",
			"What security model governs untrusted ingested data and isolation between tenants?",
			"How does the system defend against malicious input during ingestion while preserving cross-tenant separation?",
		],
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
		paraphrases: [
			"What is the migration strategy for schema evolution, and how are older facts re-indexed?",
			"Describe how the project handles schema changes over time and reprocessing of historical indexed data.",
			"How do data migrations work here, including schema updates and re-indexing past facts?",
		],
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
		paraphrases: [
			"Describe the testing strategy across unit, integration, and end-to-end levels, and how CI verifies each layer.",
			"How does the project split testing between unit, integration, and e2e coverage, and what does CI run to enforce it?",
			"What is the overall test approach, distinguishing unit/integration/e2e work and the way those tests are checked in CI?",
		],
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
		paraphrases: [
			"How is dependency injection or the plugin architecture structured to support extensible ingestion sources?",
			"What architecture lets the system add new ingestion-source plugins or injected services?",
			"Describe how the codebase is organized so ingestion sources can be extended through plugins or dependency wiring.",
		],
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
		paraphrases: [
			"Are performance benchmarks or scalability thresholds documented, and how does the implementation respond to those limits?",
			"What documented benchmarks, scale triggers, or capacity thresholds exist, and what code addresses them?",
			"Does the project spell out performance or scalability tripwires, and how are those concerns handled in implementation?",
		],
	},
];
