/**
 * Gold-standard queries for dogfood evaluation.
 *
 * Schema overhaul tracked in #344 step 1: every query is grounded against the
 * corpora it is evaluated on (`applicableCorpora`) and carries explicit
 * `expectedEvidence` artifact IDs that the catalog-applicability preflight
 * verifies against the corpus catalog before any retrieval happens.
 *
 * Authoring rules:
 * - **`applicableCorpora`** is required and explicit. There is no "all" default.
 *   The catalog-applicability preflight skips queries on corpora not listed
 *   here and excludes them from aggregate scoring (per #344).
 * - **`expectedEvidence[].artifactId`** is the exact stable `documentId` from
 *   the corpus catalog (e.g. `"FilOzone/synapse-sdk/src/foo.ts"`). Suffix /
 *   substring matching is a **migration-only** concern — the runtime grader
 *   compares exact IDs against retrieved `Chunk.documentId` values.
 *
 *   **Step-1 transitional caveat:** the mechanically-migrated fixture still
 *   contains unresolved or too-ambiguous legacy substrings (e.g. `"/src/"`,
 *   `"ingest"`) emitted verbatim as `artifactId`. The preflight surfaces
 *   these as missing-required diagnostics; they are exactly what the
 *   stratified-template recipe in step 3 regenerates. New queries authored
 *   manually before step 3 should still ground to exact catalog IDs.
 * - **`required: true` rows** are the canonical evidence set. The legacy
 *   binary pass/fail used OR semantics across `expectedSourceSubstrings`, and
 *   that is preserved here: a query passes if **at least one** `required:true`
 *   artifact appears in the retrieved results.
 * - **`required: false` rows** are supporting evidence used for recall@K only;
 *   they do not gate pass/fail.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 * @see https://github.com/SgtPooki/wtfoc/issues/343
 */

/**
 * Version of the gold-query fixture set.
 *
 * **2.0.0** — #344 step-1 schema overhaul. Mechanical migration from the
 * legacy 1.9.0 fixture: `category` → `queryType`, `queryText` → `query`,
 * `expectedSourceSubstrings` + `goldSupportingSources` → `expectedEvidence[]`,
 * `collectionScopePattern` → `applicableCorpora`. Grader-rubric fields
 * (`requiredSourceTypes`, `minResults`, `requireEdgeHop`,
 * `requireCrossSourceHops`, `tier`, `paraphrases`, `portability`) are
 * preserved unchanged. Step-3 will regenerate the corpus via stratified-
 * template recipe and supersede mechanically-migrated entries.
 *
 * Bump policy:
 * - **major**: shape change to `GoldQuery` interface
 * - **minor**: add, remove, or re-categorize a query
 * - **patch**: copy edits to `query` text or paraphrases that preserve intent
 */
import { AUTHORED_QUERIES } from "./gold-authored-queries.js";

export const GOLD_STANDARD_QUERIES_VERSION = "2.0.0";

/**
 * One piece of evidence the query expects to see in retrieved results.
 *
 * `artifactId` is the exact `Chunk.documentId` from the corpus catalog. The
 * migrator resolves legacy substrings against the catalog at codegen time and
 * emits exact IDs here. The runtime grader does NOT do substring matching.
 */
export interface ExpectedEvidence {
	/** Exact `Chunk.documentId` from the corpus catalog. */
	artifactId: string;
	/** Optional intra-document anchor (line span, heading slug, etc.). */
	locator?: string;
	/**
	 * `true` — part of the canonical evidence set. Query passes if **any** one
	 * of the `required:true` rows is present in the retrieved results (OR).
	 *
	 * `false` — supporting evidence used for `recall@K` numerator. Does not
	 * gate pass/fail.
	 */
	required: boolean;
}

/**
 * Allowed query types, replacing the legacy `category` enum.
 *
 * Mapping at migration:
 * - `direct-lookup` → `lookup`
 * - `cross-source` → `trace`
 * - `coverage` → `lookup`
 * - `synthesis` → `howto`
 * - `file-level` → `lookup`
 * - `work-lineage` → `trace`
 * - `hard-negative` → `lookup` (carried by `migrationNotes`)
 */
export type QueryType =
	| "lookup"
	| "trace"
	| "compare"
	| "temporal"
	| "causal"
	| "howto"
	| "entity-resolution";

export type Difficulty = "easy" | "medium" | "hard";

export type LayerHint = "chunking" | "embedding" | "edge-extraction" | "ranking" | "trace";

export interface GoldQuery {
	/** Unique identifier. */
	id: string;
	/**
	 * Provenance: the collection this query was authored against. Distinct from
	 * `applicableCorpora`, which lists where the query is **evaluated**. A
	 * query authored against `wtfoc-self` may still be applicable to other
	 * corpora that share the same artifacts.
	 */
	authoredFromCollectionId: string;
	/**
	 * Corpus IDs where this query is valid for evaluation. Required, explicit,
	 * no "all" default. The catalog-applicability preflight verifies each
	 * `expectedEvidence[required:true].artifactId` exists in each listed
	 * corpus's catalog. Queries on corpora not listed here are `skipped` and
	 * excluded from the aggregate.
	 */
	applicableCorpora: string[];
	/** The query text passed to `query()` / `trace()`. */
	query: string;
	queryType: QueryType;
	difficulty: Difficulty;
	/** Hints which pipeline layers a failure on this query likely implicates. */
	targetLayerHints: LayerHint[];
	/** Evidence the query expects in retrieved results. See `ExpectedEvidence`. */
	expectedEvidence: ExpectedEvidence[];
	/**
	 * Free-form factual claims a correct answer should support. Graded against
	 * the synthesis output, not the retrieved evidence list.
	 */
	acceptableAnswerFacts: string[];

	// Preserved grading-rubric fields (orthogonal to evidence/applicability).

	/** Source types that MUST appear in query results OR trace hops to pass. */
	requiredSourceTypes: string[];
	/** Minimum number of results expected from `query()`. */
	minResults: number;
	/** If `true`, trace must traverse ≥1 edge hop (not just semantic). */
	requireEdgeHop?: boolean;
	/** If `true`, trace must reach >1 source type. */
	requireCrossSourceHops?: boolean;
	/**
	 * Demo-readiness tier. `demo-critical` regressions trip per-corpus floors
	 * loudly even when overall pass rate is fine.
	 */
	tier?: "demo-critical" | "diagnostic";
	/**
	 * Phrasing-portability label. Distinct from `applicableCorpora`:
	 * - `portable` — query phrased abstractly; should work on any serious
	 *   corpus of this content shape, no repo-specific names/paths/IDs.
	 * - `corpus-specific` — query names concrete artifacts of one corpus.
	 *
	 * Drives the `portablePassRate` vs `corpusSpecificPassRate` metric split.
	 * Provisional through step 1; step 3 may redefine or drop.
	 */
	portability?: "portable" | "corpus-specific";
	/** Paraphrase variants for invariance testing (#311). */
	paraphrases?: string[];
	/**
	 * `true` when the query is a hard-negative: it should retrieve little or
	 * nothing, testing that the retriever doesn't hallucinate evidence for an
	 * out-of-scope question. Legacy `category: "hard-negative"` round-trips
	 * through this flag because the new `queryType` enum doesn't carry the
	 * hard-negative concept (it is orthogonal to query intent).
	 */
	isHardNegative?: boolean;

	/**
	 * Provisional. Free-form notes from the mechanical #344 step-1 migration —
	 * lossy mappings, ambiguous catalog resolution, etc. Removed when step-3
	 * regenerates the fixture via stratified-template recipe.
	 */
	migrationNotes?: string;
}

// The fixture below was emitted by the one-shot migrator from the legacy
// gold-standard-queries fixture in #345 (step-1 of #344). Step-2 of #344
// replaces these incrementally with stratified-template authored queries
// in `AUTHORED_QUERIES` (see `gold-authored-queries.ts`); the runtime
// `GOLD_STANDARD_QUERIES` export at the bottom of this file is the
// concatenation of the two sources.
const MIGRATED_QUERIES: GoldQuery[] = [
	{
		id: "dl-1",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How does the ingest pipeline process source files?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "/src/",
				required: true,
			},
			{
				artifactId: "ingest",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		paraphrases: [
			"What steps does the ingestion pipeline follow when handling input files?",
			"Walk me through how source documents move through ingest processing.",
			"How are source files read, transformed, and passed along during ingestion?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "ingest" -> 76 matches (cap 20); kept verbatim, will fail preflight; too-ambiguous-required: "/src/" -> 484 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "dl-2",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query: "What is the manifest schema for collections?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "./.release-please-manifest.json",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/manifest-store.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/schemas/manifest.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/manifest/local.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/schema/manifest.ts",
				required: true,
			},
			{
				artifactId: ".ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		paraphrases: [
			"What structure does a collection manifest use?",
			"Describe the schema that defines collection manifests.",
			"Which fields and layout make up the collection manifest format?",
		],
		migrationNotes:
			'ambiguous-required: "manifest" -> 5 matches; too-ambiguous-required: ".ts" -> 485 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "dl-3",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query: "How does edge extraction work?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "/src/",
				required: true,
			},
			{
				artifactId: "edge",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 1,
		paraphrases: [
			"Within this codebase, how are edges derived from ingested content?",
			"What is the local edge-extraction process used by the system?",
			"How does this project extract semantic links from source material?",
		],
		migrationNotes:
			'scope-reason: probes wtfoc-self edge-extractor internals; unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "edge" -> 34 matches (cap 20); kept verbatim, will fail preflight; too-ambiguous-required: "/src/" -> 194 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "cs-1",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What issues discuss edge resolution and how is it implemented?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"Which issues talk about edge resolution, and where was the solution implemented?",
			"Find the issue threads about resolving edges and the code that landed for them.",
			"What issue discussions cover edge resolution, and what implementation files correspond to them?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "cs-2",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What PRs changed the search or trace functionality and what code did they touch?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"Which pull requests modified search or trace behavior, and what files changed in those PRs?",
			"Find PRs that touched search or tracing and list the source files they updated.",
			"What code was affected by pull requests that changed search or trace features?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "cs-3",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Which TypeScript source files implement storage operations described in synapse-sdk documentation?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"Which TypeScript files contain the storage logic described by the synapse-sdk docs?",
			"Map the storage operations in synapse-sdk documentation to the implementing TypeScript source files.",
			"What TS source files implement the storage behaviors documented in synapse-sdk?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "cov-1",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What source types are represented in this collection?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What kinds of sources are included in this collection?",
			"Which source categories show up across the collected material?",
			"What source types does this corpus contain?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "cov-2",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"FilOzone filecoin-services issue: emit event from dataSetDeleted method and signed user auth",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue"],
		minResults: 1,
		requireEdgeHop: true,
		paraphrases: [
			"Find the FilOzone filecoin-services issue about emitting an event from dataSetDeleted and signed user auth.",
			"Which issue in filecoin-services covers a dataSetDeleted event plus signed user authentication?",
			"Locate the Filecoin services issue discussing dataSetDeleted event emission together with signed auth for users.",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "dl-4",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query: "How are chunks stored and indexed for vector search?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "./packages/common/src/interfaces/chunk-scorer.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/chunker.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/schemas/chunk.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/adapters/repo/chunking.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/chunker.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/chunkers/ast-heuristic-chunker.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/chunkers/code-chunker.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/chunkers/index.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/chunkers/markdown-chunker.ts",
				required: true,
			},
			{
				artifactId: "index",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		paraphrases: [
			"How are chunks persisted and made searchable in the vector index?",
			"What is the storage and indexing flow for chunks used in vector search?",
			"How does the system save chunks and register them for embedding-based retrieval?",
		],
		migrationNotes:
			'ambiguous-required: "chunk" -> 9 matches; too-ambiguous-required: "index" -> 56 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "dl-5",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What are the configuration options for the project?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "config",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What configuration settings does the project support?",
			"Which options can be configured in this system?",
			"What are the available project-level configuration knobs?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "config" -> 39 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "cs-4",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What PRs fix bugs in the chunking code and which files did they touch?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"Which PRs fixed chunking bugs, and what files did those fixes modify?",
			"Find pull requests for chunking-related bug fixes and the files they touched.",
			"What bug-fix PRs addressed chunking problems, and where in the code were the changes made?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "cs-5",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Which PR discussions cover dependency updates and their resolution?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr", "github-pr-comment"],
		minResults: 1,
		requireEdgeHop: true,
		portability: "portable",
		paraphrases: [
			"Which PR conversations were about dependency upgrades, and how were those updates resolved?",
			"Find pull request discussions covering dependency bumps and their final resolution.",
			"What PR threads discuss dependency updates, and what outcome did they reach?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "cov-3",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Where is test coverage documented or configured?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"Where is test coverage defined, reported, or documented?",
			"Which files or docs describe how test coverage is configured?",
			"Where can I find coverage configuration or coverage documentation?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "cov-4",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What licenses apply to the code in this collection?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What software licenses govern the code in this collection?",
			"Which licenses apply across the repository contents?",
			"What licensing terms are attached to the code gathered here?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-1",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query: "How does data flow from ingestion through embedding to search results?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireCrossSourceHops: true,
		paraphrases: [
			"In this system, how does content move from ingest through embeddings into search output?",
			"Explain the end-to-end pipeline here from ingestion to embedding generation to returned search results.",
			"What is the local flow from source ingestion, through indexing, to final search responses?",
		],
		migrationNotes:
			"scope-reason: probes wtfoc-self ingest→embed→search pipeline; unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-2",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What is the overall architecture of this system?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What is the high-level system architecture?",
			"Describe the overall design of the platform.",
			"How is the system organized at an architectural level?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-3",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How do edges connect content across different sources?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"How are edges used to link information across multiple source types?",
			"Explain how content from different sources gets connected through edges.",
			"In what way do edges bridge documents or artifacts from separate sources?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-4",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What is the release process and how are versions tagged?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "github-pr"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"How are releases cut, and what is the version-tagging process?",
			"What workflow is used for publishing releases and applying version tags?",
			"Describe the release procedure, including how versions are tagged.",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-5",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How does the system handle errors and failures?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"How does the project deal with errors, exceptions, or failed operations?",
			"What mechanisms are used to handle failures in the system?",
			"How are errors surfaced and managed across the system?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "cov-5",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What CI or GitHub Actions workflows exist?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What CI pipelines or GitHub Actions are defined?",
			"Which automation workflows run in CI for this repository?",
			"What GitHub Actions or other CI workflows exist in the project?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "dl-6",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What does the README describe?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "README",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What information does the README cover?",
			"Summarize the topics explained in the main README.",
			"What does the README say about the project and its usage?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "README" -> 25 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "dl-7",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query: "What are the main dependencies used?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "./apps/web/package.json",
				required: true,
			},
			{
				artifactId: "./docker/sharp-stub/package.json",
				required: true,
			},
			{
				artifactId: "./docker/tree-sitter-parser/package.json",
				required: true,
			},
			{
				artifactId: "./package.json",
				required: true,
			},
			{
				artifactId: "./packages/cli/package.json",
				required: true,
			},
			{
				artifactId: "./packages/common/package.json",
				required: true,
			},
			{
				artifactId: "./packages/config/package.json",
				required: true,
			},
			{
				artifactId: "./packages/ingest/package.json",
				required: true,
			},
			{
				artifactId: "./packages/mcp-server/package.json",
				required: true,
			},
			{
				artifactId: "./packages/search/package.json",
				required: true,
			},
			{
				artifactId: "./packages/store/package.json",
				required: true,
			},
			{
				artifactId: "./packages/wtfoc/package.json",
				required: true,
			},
			{
				artifactId: "dependencies",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 1,
		paraphrases: [
			"In the FilOz/Synapse materials, what are the primary dependencies in use?",
			"What main libraries and packages does the FilOz-scoped codebase rely on?",
			"Which core dependencies appear across the FilOz-related repository content?",
		],
		migrationNotes:
			'scope-reason: requires ingested package.json manifest files; ambiguous-required: "package.json" -> 12 matches; unresolved-required: "dependencies"',
	},
	{
		id: "dl-8",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What recent pull requests changed PDP, proof set, or proof verification behavior?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "PDP",
				required: true,
			},
			{
				artifactId: "proof",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr"],
		minResults: 2,
		paraphrases: [
			"What recent PRs changed PDP, proof sets, or proof verification logic?",
			"Find the latest pull requests that altered PDP or proof verification behavior.",
			"Which recent PRs touched proof-set handling or PDP-related verification?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "PDP" -> 25 matches (cap 20); kept verbatim, will fail preflight; unresolved-required: "proof"',
	},
	{
		id: "cs-6",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How does synapse-sdk integrate with filecoin-pin or delegated storage services when publishing data?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "filecoin-pin",
				required: true,
			},
			{
				artifactId: "synapse-sdk",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr", "github-pr-comment"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"How does synapse-sdk publish data using filecoin-pin or delegated storage services?",
			"What is the integration path between synapse-sdk and filecoin-pin or delegated storage when publishing content?",
			"Explain how publishing data from synapse-sdk hooks into filecoin-pin or delegated storage providers.",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "synapse-sdk" -> 366 matches (cap 20); kept verbatim, will fail preflight; unresolved-required: "filecoin-pin"',
	},
	{
		id: "cs-7",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How is a storage provider or proof service configured in Synapse docs compared with the TypeScript implementation?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"How do Synapse docs describe configuring a storage provider or proof service, and how does the TypeScript code do it?",
			"Compare the provider or proof-service setup in Synapse documentation with the TypeScript implementation.",
			"Where do the Synapse docs and TS implementation differ or align on configuring storage or proof services?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "synapse-sdk" -> 366 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "cov-6",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"What problems or bugs were reported around payment flows in the Filecoin services ecosystem repos?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "filecoin-services",
				required: true,
			},
			{
				artifactId: "synapse-sdk/apps/synapse-playground/src/components/payments-account.tsx",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/apps/synapse-playground/src/components/payments/deposit-and-approve.tsx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/cookbooks/payments-and-storage.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/developer-guides/payments/_meta.yml",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/docs/src/content/docs/developer-guides/payments/payment-operations.mdx",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/docs/src/content/docs/developer-guides/payments/rails-settlement.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/mocks/jsonrpc/payments.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/payments.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/payments/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/payments/use-deposit-and-approve.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/payments/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/payments/service.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "github-pr-comment"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"What bugs or reported issues involved payment flows in the Filecoin services ecosystem repositories?",
			"Find reported problems around payments across the Filecoin services repos.",
			"Which issues describe broken or problematic payment flows in the Filecoin services ecosystem?",
		],
		migrationNotes:
			'unresolved-required: "filecoin-services"; ambiguous-required: "payments" -> 12 matches',
	},
	{
		id: "cov-7",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How does piece.ts implement PieceCID and CommP validation across synapse-core and filecoin-pin?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "CommP",
				required: true,
			},
			{
				artifactId: "piece",
				required: true,
			},
			{
				artifactId: "PieceCID",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"How does piece.ts perform PieceCID and CommP validation in relation to synapse-core and filecoin-pin?",
			"Explain the PieceCID and CommP checks implemented in piece.ts across synapse-core and filecoin-pin.",
			"What validation logic for PieceCID and CommP appears in piece.ts, and how does it relate to synapse-core and filecoin-pin?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "PieceCID"; unresolved-required: "CommP"; too-ambiguous-required: "piece" -> 31 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "syn-6",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What PR discussions and comments argued about the proof set or PDP service contract design in filecoin-services?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "filecoin-services",
				required: true,
			},
			{
				artifactId: "PDP",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr-comment", "github-pr"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		paraphrases: [
			"What PR comments debated the design of the proof set or PDP service contract in filecoin-services?",
			"Find discussion threads in PRs that argued about proof-set or PDP contract design for filecoin-services.",
			"Which pull request discussions challenged or defended the proof set or PDP service contract design?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "filecoin-services"; too-ambiguous-required: "PDP" -> 25 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "syn-7",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How do Curio sector or deal-storage concepts connect to the Synapse client storage workflow?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "curio",
				required: true,
			},
			{
				artifactId: "synapse",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr", "github-pr-comment", "code"],
		minResults: 2,
		requireCrossSourceHops: true,
		paraphrases: [
			"How do Curio ideas like sectors or deal storage relate to the Synapse client storage workflow?",
			"Connect Curio sector or deal-storage concepts to how the Synapse client handles storage.",
			"What is the relationship between Curio storage concepts and the Synapse client’s storage flow?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "curio"; too-ambiguous-required: "synapse" -> 366 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "cov-8",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What official Filecoin documentation pages describe storage providers?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "docs.filecoin.io",
				required: true,
			},
			{
				artifactId: "storage",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["doc-page"],
		minResults: 1,
		paraphrases: [
			"Which official Filecoin docs pages explain storage providers?",
			"Find the canonical Filecoin documentation about storage providers.",
			"What official Filecoin documentation covers storage-provider concepts?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "docs.filecoin.io"; too-ambiguous-required: "storage" -> 60 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "fl-1",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Which file defines the Synapse class or createSynapse factory?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/synapse.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		paraphrases: [
			"Where is the Synapse class or the createSynapse factory defined?",
			"Which file contains the Synapse constructor or factory implementation?",
			"What source file declares Synapse or createSynapse?",
		],
		migrationNotes:
			'too-ambiguous-required: "synapse-sdk" -> 366 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "fl-2",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Which file defines PieceCID and the piece identity logic?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "piece",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		paraphrases: [
			"Which file contains PieceCID and the logic for piece identity?",
			"Where is PieceCID defined along with the piece identity implementation?",
			"What source file owns PieceCID and related piece-identification logic?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "piece" -> 31 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "fl-3",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Which files import PieceCID in the synapse client?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "piece",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		paraphrases: [
			"Which source files in the Synapse client import PieceCID?",
			"Find all Synapse client files that reference PieceCID via import.",
			"Where is PieceCID imported throughout the client code?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "piece" -> 31 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "fl-4",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Which file defines StorageContext in the synapse-sdk?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "storage",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		paraphrases: [
			"What file defines StorageContext in synapse-sdk?",
			"Where is the StorageContext type or interface declared in synapse-sdk?",
			"Which source file contains the StorageContext definition?",
		],
		migrationNotes:
			'too-ambiguous-required: "storage" -> 60 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "wl-1",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Where does PieceCID validation happen and what concerns were raised about it?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "pieceCid",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/piece.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/piece.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/sp/find-piece.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/warm-storage/use-delete-piece.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
				required: false,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr-comment", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "demo-critical",
		paraphrases: [
			"In the FilOz scope, where is PieceCID validated, and what concerns were discussed about that validation?",
			"What code performs PieceCID validation, and what objections or risks were raised about it in FilOz materials?",
			"Locate PieceCID validation and the related concerns discussed around it within the FilOz corpus.",
		],
		migrationNotes: 'ambiguous-required: "piece.ts" -> 4 matches; unresolved-required: "pieceCid"',
	},
	{
		id: "wl-2",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "DataSetStatus enum values and transitions in filecoin services code",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "DataSetStatus",
				required: true,
			},
			{
				artifactId: "filecoin-services",
				required: true,
			},
			{
				artifactId:
					"filecoin-services/service_contracts/abi/FilecoinWarmStorageServiceStateLibrary.abi.json",
				required: false,
			},
			{
				artifactId:
					"filecoin-services/service_contracts/abi/FilecoinWarmStorageServiceStateView.abi.json",
				required: false,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "demo-critical",
		paraphrases: [
			"What are the DataSetStatus enum values in filecoin-services, and how do status changes happen?",
			"List the DataSetStatus enum members and the transitions between them in filecoin-services.",
			"How is DataSetStatus modeled in filecoin-services, including its possible values and state progression?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "DataSetStatus"; unresolved-required: "filecoin-services"; unresolved-supporting: "filecoin-services/service_contracts/abi/FilecoinWarmStorageServiceStateLibrary.abi.json"; unresolved-supporting: "filecoin-services/service_contracts/abi/FilecoinWarmStorageServiceStateView.abi.json"',
	},
	{
		id: "wl-3",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "synapse-sdk payments deposit implementation typescript",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-core",
				required: true,
			},
			{
				artifactId: "synapse-sdk/apps/synapse-playground/src/components/payments-account.tsx",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/apps/synapse-playground/src/components/payments/deposit-and-approve.tsx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/cookbooks/payments-and-storage.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/developer-guides/payments/_meta.yml",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/docs/src/content/docs/developer-guides/payments/payment-operations.mdx",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/docs/src/content/docs/developer-guides/payments/rails-settlement.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/mocks/jsonrpc/payments.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/deposit.ts",
				required: false,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/payments.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/payments/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/payments/use-deposit-and-approve.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/payments/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/payments/service.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 3,
		requireEdgeHop: true,
		tier: "demo-critical",
		paraphrases: [
			"Where is the deposit implementation for payments in synapse-sdk written in TypeScript?",
			"Find the TypeScript code that implements deposits in the synapse-sdk payments flow.",
			"Which synapse-sdk source handles payment deposits?",
		],
		migrationNotes:
			'ambiguous-required: "payments" -> 12 matches; too-ambiguous-required: "synapse-core" -> 164 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "wl-4",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "piece.ts validation logic across synapse-core and filecoin-pin, with PR discussion",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "filecoin-pin",
				required: true,
			},
			{
				artifactId: "filecoin-pin/src/core/utils/validate-ipni-advertisement.ts",
				required: false,
			},
			{
				artifactId: "synapse-sdk",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/piece.ts",
				required: false,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "demo-critical",
		paraphrases: [
			"Within the FilOz materials, show the piece.ts validation logic across synapse-core and filecoin-pin, along with the PR discussion about it.",
			"How does piece.ts validation work across synapse-core and filecoin-pin, and what did the related PR discussion say?",
			"Find both the cross-repo piece.ts validation code and the PR conversation surrounding it in the FilOz scope.",
		],
		migrationNotes:
			'unresolved-required: "filecoin-pin"; too-ambiguous-required: "synapse-sdk" -> 366 matches (cap 20); kept verbatim, will fail preflight; unresolved-supporting: "filecoin-pin/src/core/utils/validate-ipni-advertisement.ts"',
	},
	{
		id: "wl-5",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Payments module deposit function implementation in filecoin-pin with docs context",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "filecoin-pin/src/core/payments/funding.ts",
				required: false,
			},
			{
				artifactId: "filecoin-pin/src/core/payments/index.ts",
				required: false,
			},
			{
				artifactId: "synapse-sdk/apps/synapse-playground/src/components/payments-account.tsx",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/apps/synapse-playground/src/components/payments/deposit-and-approve.tsx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/cookbooks/payments-and-storage.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/developer-guides/payments/_meta.yml",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/docs/src/content/docs/developer-guides/payments/payment-operations.mdx",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/docs/src/content/docs/developer-guides/payments/rails-settlement.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/examples/cli/src/commands/deposit.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/mocks/jsonrpc/payments.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/deposit-with-permit.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/deposit.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/payments.ts",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/warm-storage/calculate-deposit-needed.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/payments/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/payments/use-deposit-and-approve.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/payments/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/payments/service.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireEdgeHop: true,
		tier: "demo-critical",
		paraphrases: [
			"Where is the Payments module deposit function implemented in filecoin-pin, and what docs explain it?",
			"Find the filecoin-pin deposit function in the Payments module together with any documentation context.",
			"Show the filecoin-pin Payments deposit implementation and the docs that describe that behavior.",
		],
		migrationNotes:
			'ambiguous-required: "payments" -> 12 matches; ambiguous-required: "deposit" -> 6 matches; unresolved-supporting: "filecoin-pin/src/core/payments/index.ts"; unresolved-supporting: "filecoin-pin/src/core/payments/funding.ts"',
	},
	{
		id: "wl-6",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How did curio integrate with synapse-sdk PDP layer via issues and PRs?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "github-pr"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "diagnostic",
		paraphrases: [
			"How was Curio connected to the synapse-sdk PDP layer through issues and pull requests?",
			"Trace Curio’s integration with the synapse-sdk PDP layer using the relevant issues and PRs.",
			"Which issues and PRs document Curio integration into the Synapse PDP layer?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "synapse-sdk" -> 366 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "wl-7",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Piece CID v1 to v2 migration discussion across curio and filecoin services PRs",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "curio",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr", "github-pr-comment"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		tier: "diagnostic",
		paraphrases: [
			"What discussions covered migrating Piece CID from v1 to v2 across Curio and filecoin-services PRs?",
			"Find PR conversations about the Piece CID v1-to-v2 migration in Curio and filecoin-services.",
			"How was the Piece CID v1 versus v2 migration debated across Curio and filecoin-services?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "curio"',
	},
	{
		id: "wl-8",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Storage costs and billing concepts documented across synapse-sdk and filecoin-services",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "filecoin-pin",
				required: true,
			},
			{
				artifactId: "synapse-sdk",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		tier: "diagnostic",
		paraphrases: [
			"What storage cost and billing concepts are documented across synapse-sdk and filecoin-services?",
			"Find documentation about pricing, billing, or storage costs in synapse-sdk and filecoin-services.",
			"Which concepts related to storage charges and billing appear across the FilOz Synapse and filecoin-services docs?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; too-ambiguous-required: "synapse-sdk" -> 366 matches (cap 20); kept verbatim, will fail preflight; unresolved-required: "filecoin-pin"',
	},
	{
		id: "port-1",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Find a bug report, the pull request that closed it, and the code that changed.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "github-pr", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Locate an issue for a bug, the PR that fixed it, and the exact code changes involved.",
			"Find a bug report, then trace it to the closing pull request and modified source files.",
			"Can you connect a reported bug to the fixing PR and the implementation diff?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-2",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Trace a recent pull request discussion to the source files it modified.",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-pr", "github-pr-comment", "code"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Follow a recent pull request discussion through to the files it changed.",
			"Take a recent PR thread and map the conversation to the source files modified by that PR.",
			"Trace one of the latest PR discussions back to the code it actually touched.",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-3",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Find documentation sections that describe behavior and the source code that implements them.",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Find docs that describe a behavior and then identify the source code that implements that behavior.",
			"Map documentation statements about behavior to the implementation files behind them.",
			"Which documentation sections explain behavior that can be matched directly to code?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-8",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Explain the system's global retry and backoff strategy for external service dependencies, and identify any documented architectural requirements that the current implementation fails to meet.",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-9",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How is cross-service authentication handled, and what were the primary security concerns or alternative protocols debated in PR reviews during the initial implementation?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr-comment"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-10",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Describe the standard for structured logging and PII scrubbing across the codebase, and summarize the historical incidents mentioned in issues that led to these specific logging rules.",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-issue"],
		minResults: 4,
		requireCrossSourceHops: true,
		portability: "portable",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-11",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What is the end-to-end PieceCID and CommP validation flow, and what improvements to the error reporting UX were suggested in Slack messages to help node operators?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "slack-message"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-12",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Analyze the DataSetStatus state machine: what are the terminal states, and what edge cases were identified in PR reviews that could cause a dataset to become 'stuck'?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-13",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How does the project maintain data isolation and consistency during integration tests, and what challenges with flaky test environments have been reported in recent issues?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-issue"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-14",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Explain the Filecoin Pay deposit lifecycle and how the implementation addresses chain re-orgs or high-latency periods as discussed in community Slack threads.",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "slack-message"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-15",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What is the strategy for secret management and environment configuration, and what was the technical rationale for migrating away from the previous configuration approach?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr-comment", "markdown"],
		minResults: 4,
		requireCrossSourceHops: true,
		portability: "portable",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-16",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How do Curio and the Synapse PDP integration coordinate for proof generation, and what performance bottlenecks were identified during the initial bench-marking discussed in issues?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-issue", "github-pr-comment"],
		minResults: 4,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-17",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Examine the concurrency and locking models used across the repository; where are distributed locks employed versus local mutexes, and what deadlock scenarios have been historically reported?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-issue"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-1",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Where is the GraphQL schema for the public tenant API defined, and how are N+1 queries batched in the resolver layer?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-2",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How does the auth middleware refresh OAuth2 bearer tokens when the upstream IdP session expires?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-3",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What Grafana dashboard JSON shows p95 embedding latency for the retrieval reranker service?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-4",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Which Dockerfile stage cross-compiles the iOS client frameworks to arm64 and signs them with the enterprise distribution certificate?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-5",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Where do we shard the fine-tuned LoRA adapter checkpoints across S3 prefixes for A/B evaluation?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-6",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How does the Kubernetes operator reconcile HPA custom metrics from the Prometheus adapter when the metrics API is throttled?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "portable",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-7",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"In the Slack incident bot, which slash command rolls back a canary deployment and posts the Argo CD diff to the war room channel?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 1,
		portability: "portable",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-8",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How does Filecoin Pay route failed ACH debits through Stripe Radar risk scores before retrying the on-chain deposit?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 2,
		portability: "corpus-specific",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-9",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Where does Curio reject PieceCID values that fail CommD alignment checks during PDP proof aggregation?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "corpus-specific",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-10",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Which synapse-sdk WebSocket channel pushes live DataSetStatus transitions to browser clients without polling?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "corpus-specific",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-11",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How does filecoin-pin enforce per-tenant OIDC group claims when minting scoped API keys for pin jobs?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "corpus-specific",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "hn-12",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Show the helper that converts a PieceCID to a CIDv1 libp2p peer id for gossipsub routing in the storage node.",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: [],
		minResults: 0,
		portability: "corpus-specific",
		isHardNegative: true,
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "dl-9",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Which file implements the multi-provider upload facade that orchestrates store, pull, and commit?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/manager.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What file contains the upload coordinator that fronts multiple providers and drives store, pull, and commit steps?",
			"Where is the multi-provider upload facade implemented that sequences storing, pulling, and committing?",
			"Which source file is responsible for orchestrating store/pull/commit through a unified multi-provider upload layer?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus)',
	},
	{
		id: "dl-10",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Which helper computes runway, buffer, and total deposit required before an upload?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/warm-storage/calculate-deposit-needed.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/warm-storage/get-upload-costs.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"What helper calculates the runway, safety buffer, and full deposit needed before starting an upload?",
			"Which utility figures out required upload funding, including runway, buffer, and total deposit?",
			"Where is the pre-upload deposit calculator that derives runway, buffer, and overall required funds?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus)',
	},
	{
		id: "dl-11",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Which file validates a downloaded blob against an expected PieceCID while streaming?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/download.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
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
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Which typed-data modules sign create-data-set and add-pieces payloads?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/typed-data/sign-add-pieces.ts",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/typed-data/sign-create-dataset-add-pieces.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/typed-data/sign-create-dataset.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"Which typed-data files are used to sign the create-data-set and add-pieces messages?",
			"Where are the EIP-712-style modules for signing create-data-set and add-pieces payloads defined?",
			"What typed-data modules cover signatures for both dataset creation and piece addition requests?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus)',
	},
	{
		id: "dl-13",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Which React hook returns the current service price through react-query?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/warm-storage/use-service-price.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"Which React hook exposes the current service price via react-query?",
			"Where is the hook that fetches and returns the current service price using react-query?",
			"What React hook provides service pricing through a react-query-backed call?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus)',
	},
	{
		id: "dl-14",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Which React hook creates a data set, waits on a status URL, and then invalidates cached data-set queries?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/warm-storage/use-create-data-set.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"Which hook creates a dataset, polls a status URL until completion, and then invalidates cached dataset queries?",
			"Where is the React hook that submits dataset creation, waits on the returned status endpoint, and refreshes dataset cache entries?",
			"What hook handles create-data-set, follows the status URL, and finally invalidates react-query dataset caches?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus)',
	},
	{
		id: "dl-15",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Which provider-selection logic prefers metadata-matching datasets and explicitly skips health checks?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/warm-storage/fetch-provider-selection-input.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/warm-storage/select-providers.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"Which provider-picking logic favors datasets whose metadata matches and deliberately avoids health checks?",
			"Where is the selection flow that prioritizes metadata-aligned datasets while explicitly skipping provider health probes?",
			"What code chooses providers by preferring metadata matches and not running health checks?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus)',
	},
	{
		id: "dl-16",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Which generated Solidity view contract wraps state reads for eth_call, and which script produces it?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "FilecoinWarmStorageServiceStateView.sol",
				required: true,
			},
			{
				artifactId: "generate_view_contract.sh",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"Which generated Solidity reader contract is used for eth_call state access, and what script generates it?",
			"Where is the auto-generated Solidity view wrapper for eth_call reads, and which script builds it?",
			"What generated contract wraps on-chain state reads for eth_call, and what generation script produces that artifact?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "FilecoinWarmStorageServiceStateView.sol"; unresolved-required: "generate_view_contract.sh"',
	},
	{
		id: "dl-17",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Which file defines the Synapse class that wires together payments, providers, warm storage, FilBeam, and StorageManager?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/synapse.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
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
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Where does synapse-core implement getSizeFromPieceCID for PieceCIDv2 inputs?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/piece.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
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
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Which file defines the useFilsnap hook that uses wagmi account effects?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/filsnap.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
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
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Where is EIP-712 metadata hashing and signature recovery implemented for FilecoinWarmStorageService?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "SignatureVerificationLib.sol",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where is EIP-712 metadata hashing plus signature recovery implemented for FilecoinWarmStorageService?",
			"Which file contains the metadata hash and signature recovery logic used by FilecoinWarmStorageService?",
			"What contract-side implementation handles typed-data metadata hashing and signer recovery for FilecoinWarmStorageService?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "SignatureVerificationLib.sol"',
	},
	{
		id: "dl-21",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Which contract owns provider registration plus addProduct, updateProduct, and removeProduct operations?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "ServiceProviderRegistry.sol",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which contract is responsible for provider registration and the addProduct, updateProduct, and removeProduct functions?",
			"Where are provider enrollment and product add/update/remove operations owned on-chain?",
			"What contract manages service provider registration along with addProduct, updateProduct, and removeProduct?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "ServiceProviderRegistry.sol"',
	},
	{
		id: "dl-22",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Where do filecoin-services contracts compute dataset Active versus Inactive status for off-chain readers?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "FilecoinWarmStorageServiceStateLibrary.sol",
				required: true,
			},
			{
				artifactId: "FilecoinWarmStorageServiceStateView.sol",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		portability: "corpus-specific",
		paraphrases: [
			"Where do the filecoin-services contracts derive Active versus Inactive dataset status for off-chain consumers?",
			"Which contract code computes whether a dataset is Active or Inactive for off-chain state readers?",
			"What part of filecoin-services determines dataset Active/Inactive status in state exposed to off-chain readers?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "FilecoinWarmStorageServiceStateLibrary.sol"; unresolved-required: "FilecoinWarmStorageServiceStateView.sol"',
	},
	{
		id: "dl-23",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Which session-key files define the login transaction helper and the default FWSS permission hashes?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/session-key/login.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/session-key/permissions.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
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
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"What release note describes provider selection moving into a core package, and which source files implement the multi-copy selection flow?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-core/CHANGELOG.md",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/warm-storage/select-providers.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/manager.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Which release note says provider selection was moved into a core package, and what files now implement multi-copy provider selection?",
			"Where is the release documentation for provider selection shifting into core, and which source files realize the multi-copy selection path?",
			"What changelog entry covers moving provider choice into the core package, and where is the multi-copy selection flow implemented?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus)',
	},
	{
		id: "cs-9",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"How do the README concepts for data sets, pieces, and payment rails map to the storage context implementation?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/README.md",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/manager.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/README.md",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"How do the README explanations of datasets, pieces, and payment rails correspond to the storage context code?",
			"Map the README concepts around data sets, pieces, and payment rails onto the actual storage context implementation.",
			"Where do the README-level ideas for datasets, pieces, and payment rails show up in storage context code?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus); ambiguous-required: "synapse-sdk/README.md" -> 2 matches',
	},
	{
		id: "cs-10",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How is off-chain contract state reading documented and then implemented through a generated view wrapper and extsload-based libraries?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "FilecoinWarmStorageServiceStateLibrary.sol",
				required: true,
			},
			{
				artifactId: "FilecoinWarmStorageServiceStateView.sol",
				required: true,
			},
			{
				artifactId: "service_contracts/README.md",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"How is off-chain contract state access described in docs, and how is it realized through a generated view wrapper plus extsload libraries?",
			"What documentation explains off-chain contract reads, and how do the generated view contract and extsload-based libraries implement that design?",
			"Trace the path from docs about off-chain state reading to the generated wrapper and extsload libraries that implement it.",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "service_contracts/README.md"; unresolved-required: "FilecoinWarmStorageServiceStateView.sol"; unresolved-required: "FilecoinWarmStorageServiceStateLibrary.sol"',
	},
	{
		id: "cs-11",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"What issue added session keys with viem, and which source files implement the login and permission pieces?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/issues/618",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/session-key/login.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/session-key/permissions.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Which issue introduced viem-based session keys, and what files implement the login flow and permission handling?",
			"What GitHub issue added session-key support with viem, and where are the login and permission components in source?",
			"Which issue tracks viem session keys, and which files contain the resulting login helper and permission logic?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus); unresolved-required: "synapse-sdk/issues/618"',
	},
	{
		id: "cs-12",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Which issue introduced a storage facade with context objects, and where was it implemented?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/issues/153",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/manager.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Which issue added the storage facade built around context objects, and where was that work implemented?",
			"What issue introduced a context-based storage facade, and which source files landed the implementation?",
			"Trace the issue that brought in the storage facade with context objects and identify where it was coded.",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus); unresolved-required: "synapse-sdk/issues/153"',
	},
	{
		id: "cs-13",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "Which issue changed PieceCIDv2 size extraction, and where is that helper implemented?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/issues/283",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/piece.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "code"],
		minResults: 2,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Which issue changed how PieceCIDv2 size extraction works, and where is the updated helper implemented?",
			"What issue covers the PieceCIDv2 size-extraction change, and which file contains the helper now?",
			"Trace the issue that modified PieceCIDv2 size parsing and point to the helper implementation.",
		],
		migrationNotes: 'unresolved-required: "synapse-sdk/issues/283"',
	},
	{
		id: "cs-14",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How is signature verification for typed dataset and add-pieces operations described in docs and implemented in the contract library?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "service_contracts/README.md",
				required: true,
			},
			{
				artifactId: "SignatureVerificationLib.sol",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"How do docs describe signature verification for typed dataset and add-pieces actions, and where is that logic implemented in contract code?",
			"Where is signature verification for dataset creation and piece addition documented, and which contract library actually performs it?",
			"Trace the documented story for typed dataset/add-pieces signature checking into the contract library implementation.",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "service_contracts/README.md"; unresolved-required: "SignatureVerificationLib.sol"',
	},
	{
		id: "cs-15",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"How did synapse-sdk issue #618 land across synapse-core, synapse-sdk, and synapse-react?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/issues/618",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/session-key/login.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/CHANGELOG.md",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How was synapse-sdk issue #618 reflected across synapse-core, synapse-sdk, and synapse-react?",
			"What changed for synapse-sdk issue #618 across the core package, the SDK, and the React layer?",
			"Trace how issue #618 in synapse-sdk landed across synapse-core, synapse-sdk, and synapse-react.",
		],
		migrationNotes: 'unresolved-required: "synapse-sdk/issues/618"',
	},
	{
		id: "cs-16",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"How did synapse-sdk issue #209 add session key support, and which exported session-key modules carry that feature now?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/issues/209",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/session-key/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/CHANGELOG.md",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How did synapse-sdk issue #209 introduce session keys, and which exported session-key modules now carry that functionality?",
			"Trace issue #209 from session-key support design to the currently exported session-key modules.",
			"What was the implementation path for synapse-sdk issue #209, and which session-key exports represent that feature today?",
		],
		migrationNotes: 'unresolved-required: "synapse-sdk/issues/209"',
	},
	{
		id: "cs-17",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query: "How did synapse-sdk issue #489 change StorageContext clientDataSetId caching?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/issues/489",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/CHANGELOG.md",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How did synapse-sdk issue #489 alter StorageContext caching for clientDataSetId?",
			"What changed in StorageContext clientDataSetId caching as part of synapse-sdk issue #489?",
			"Trace the effect of issue #489 on how StorageContext caches clientDataSetId values.",
		],
		migrationNotes: 'unresolved-required: "synapse-sdk/issues/489"',
	},
	{
		id: "cs-18",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"How did synapse-sdk issue #438 remove getClientDataSetsWithDetails from createStorageContext?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/issues/438",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/CHANGELOG.md",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How did synapse-sdk issue #438 remove getClientDataSetsWithDetails from createStorageContext?",
			"What changes from issue #438 caused createStorageContext to stop exposing getClientDataSetsWithDetails?",
			"Trace issue #438 and explain how getClientDataSetsWithDetails was removed from createStorageContext.",
		],
		migrationNotes: 'unresolved-required: "synapse-sdk/issues/438"',
	},
	{
		id: "cs-19",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How do filecoin-services deployment docs and scripts handle linking SignatureVerificationLib into FilecoinWarmStorageService?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "service_contracts/README.md",
				required: true,
			},
			{
				artifactId: "SignatureVerificationLib.sol",
				required: true,
			},
			{
				artifactId: "warm-storage-deploy-all.sh",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How do filecoin-services deployment docs and scripts manage linking SignatureVerificationLib into FilecoinWarmStorageService?",
			"Where do the deployment instructions and scripts show SignatureVerificationLib being linked into FilecoinWarmStorageService?",
			"Trace how documentation and deployment scripts handle library linking for SignatureVerificationLib and FilecoinWarmStorageService.",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "service_contracts/README.md"; unresolved-required: "warm-storage-deploy-all.sh"; unresolved-required: "SignatureVerificationLib.sol"',
	},
	{
		id: "cs-20",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How do filecoin-services upgrade docs and scripts line up with announcePlannedUpgrade and nextUpgrade support in the contracts?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "ServiceProviderRegistry.sol",
				required: true,
			},
			{
				artifactId: "UPGRADE-PROCESS.md",
				required: true,
			},
			{
				artifactId: "warm-storage-announce-upgrade.sh",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How do the filecoin-services upgrade docs and scripts correspond to announcePlannedUpgrade and nextUpgrade support in contracts?",
			"What documentation and scripting around upgrades lines up with the contract support for announcePlannedUpgrade and nextUpgrade?",
			"Trace the relationship between upgrade docs/scripts and the Solidity implementation of announcePlannedUpgrade plus nextUpgrade.",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "UPGRADE-PROCESS.md"; unresolved-required: "warm-storage-announce-upgrade.sh"; unresolved-required: "ServiceProviderRegistry.sol"',
	},
	{
		id: "cs-21",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"How do the Synapse SDK breaking-change notes about Warm Storage, Data Sets, Pieces, and Service Providers map to the actual code layout?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/piece.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/warm-storage/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/warm-storage/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/README.md",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/warm-storage/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/README.md",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown", "code"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How do the Synapse SDK breaking-change notes for Warm Storage, Data Sets, Pieces, and Service Providers map onto the current code layout?",
			"Where do the breaking-change notes about warm storage, datasets, pieces, and service providers show up in actual package structure?",
			"Map the Synapse SDK breaking-change documentation for Warm Storage/Data Sets/Pieces/Service Providers to the real code organization.",
		],
		migrationNotes:
			'ambiguous-required: "synapse-sdk/README.md" -> 2 matches; ambiguous-required: "warm-storage/index.ts" -> 3 matches',
	},
	{
		id: "cs-22",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"How did synapse-sdk issue #156 show up in the Curio CommPv2 compatibility and PieceCID terminology changes?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "synapse-sdk/issues/156",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/piece.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/CHANGELOG.md",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["github-issue", "code"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How did synapse-sdk issue #156 surface in Curio CommPv2 compatibility updates and PieceCID terminology changes?",
			"Trace issue #156 through the CommPv2 compatibility work in Curio and the related PieceCID naming changes.",
			"What code and docs reflect synapse-sdk issue #156 in terms of Curio CommPv2 support and updated PieceCID terminology?",
		],
		migrationNotes: 'unresolved-required: "synapse-sdk/issues/156"',
	},
	{
		id: "cov-9",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What kinds of IPNI advertisement handling logic exist across this corpus, such as validation, publishing, and error handling?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "advertisement",
				required: true,
			},
			{
				artifactId: "ipni",
				required: true,
			},
			{
				artifactId: "validate",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What IPNI advertisement handling themes are present here, including validation, publishing, and error paths?",
			"Survey the corpus for IPNI advertisement logic such as validation rules, publication flows, and failure handling.",
			"Which categories of IPNI advertisement behavior appear across the code and docs, from publish to validation to error management?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "ipni"; unresolved-required: "advertisement"; unresolved-required: "validate"',
	},
	{
		id: "cov-10",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query:
			"What categories of CommP-related logic appear in the corpus, including computation, verification, and format checks?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "./packages/cli/src/commands/verify.ts",
				required: true,
			},
			{
				artifactId: "CommP",
				required: true,
			},
			{
				artifactId: "piece",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		portability: "corpus-specific",
		paraphrases: [
			"What CommP-related logic exists across the corpus, covering calculation, verification, and format validation?",
			"Survey the repository for CommP functionality, including generation, checking, and format-related safeguards.",
			"Which kinds of CommP code paths appear here, from computing values to verifying them and checking representation details?",
		],
		migrationNotes:
			'unresolved-required: "CommP"; too-ambiguous-required: "piece" -> 31 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "cov-11",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"What kinds of PDP artifacts are present, such as proof generation, proof verification, and challenge flow handling?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "pdp",
				required: true,
			},
			{
				artifactId: "proof",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/pdp-verifier/get-next-challenge-epoch.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		portability: "corpus-specific",
		paraphrases: [
			"What PDP artifacts are represented, such as challenge handling, proof generation, and proof verification?",
			"Inventory the PDP-related material in the corpus, including proof creation, proof checking, and challenge-flow logic.",
			"Which PDP components show up across the codebase, covering challenges, proof generation, and verifier-side behavior?",
		],
		migrationNotes:
			'too-ambiguous-required: "pdp" -> 25 matches (cap 20); kept verbatim, will fail preflight; unresolved-required: "proof"',
	},
	{
		id: "cov-12",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What categories of Filecoin service contract artifacts are represented, including Solidity contracts, ABIs, and state/view interfaces?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "./packages/cli/src/commands/unresolved-edges.ts",
				required: true,
			},
			{
				artifactId: "./packages/config/src/resolver.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/edge-resolution.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/eval/edge-resolution-evaluator.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/trace/resolution.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/cid-resolver.ts",
				required: true,
			},
			{
				artifactId: "service_contracts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/erc20.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/resolve-account-state.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/resolve-piece-url.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/capabilities.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/pdp-capabilities.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/scripts/benchmark-provider-resolve.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/scripts/compare-provider-resolve-calls.js",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 3,
		portability: "corpus-specific",
		paraphrases: [
			"What categories of Filecoin service contract artifacts exist here, including Solidity source, ABIs, and view/state interfaces?",
			"Survey the corpus for filecoin-services contract artifacts like Solidity contracts, ABI outputs, and state-reading interfaces.",
			"Which kinds of service-contract deliverables are present, from Solidity implementations to ABI files and view-layer interfaces?",
		],
		migrationNotes:
			'unresolved-required: "service_contracts"; ambiguous-required: "abi" -> 4 matches; ambiguous-required: "sol" -> 10 matches',
	},
	{
		id: "cov-13",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What kinds of dataset lifecycle states and transitions are documented or implemented in this corpus?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "./apps/web/src/components/EmptyState.tsx",
				required: true,
			},
			{
				artifactId: "./apps/web/src/state.ts",
				required: true,
			},
			{
				artifactId: "DataSetStatus",
				required: true,
			},
			{
				artifactId: "synapse-sdk/examples/cli/src/commands/datasets-create.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/examples/cli/src/commands/datasets-terminate.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/examples/cli/src/commands/datasets.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/examples/cli/src/commands/upload-dataset.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/resolve-account-state.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pdp-verifier/get-dataset-size.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/sp/create-dataset-add-pieces.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/sp/create-dataset.ts",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/typed-data/sign-create-dataset-add-pieces.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/typed-data/sign-create-dataset.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/utils/create-dataset.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/utils/delete-empty-datasets.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/utils/diagnose-dataset-deletion.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/utils/list-datasets.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/utils/manual-dataset-deletion.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/utils/settle-dataset-rails.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/utils/terminate-rails-then-dataset.js",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		portability: "corpus-specific",
		paraphrases: [
			"What dataset lifecycle states and state transitions are documented or implemented in this corpus?",
			"Survey the repository for dataset lifecycle stages and the transitions between them, whether described or coded.",
			"Which dataset lifecycle statuses and movement rules appear across docs and implementation?",
		],
		migrationNotes:
			'unresolved-required: "DataSetStatus"; ambiguous-required: "dataset" -> 16 matches; ambiguous-required: "state" -> 3 matches',
	},
	{
		id: "cov-14",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"What categories of billing rail behavior exist, such as deposits, funding, charging, and settlement-related operations?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "billing",
				required: true,
			},
			{
				artifactId: "funding",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/apps/synapse-playground/src/components/payments/deposit-and-approve.tsx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/examples/cli/src/commands/deposit.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/deposit-with-permit.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/deposit.ts",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/warm-storage/calculate-deposit-needed.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/payments/use-deposit-and-approve.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-issue"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What billing rail behaviors appear in the corpus, including deposit, funding, charging, and settlement flows?",
			"Survey the codebase for payment-rail mechanics such as funding, deposits, charge application, and settlement-related steps.",
			"Which categories of billing-rail logic are represented here, from prefunding through charging and settlement?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[filoz-ecosystem-2026-04-v12] (single corpus); unresolved-required: "billing"; ambiguous-required: "deposit" -> 6 matches; unresolved-required: "funding"',
	},
	{
		id: "cov-15",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What kinds of retry and resilience patterns appear in the codebase, such as retries, backoff, and circuit-breaker-like guards?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "backoff",
				required: true,
			},
			{
				artifactId: "circuit",
				required: true,
			},
			{
				artifactId: "retry",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr-comment"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What retry and resilience patterns show up in the codebase, including retries, backoff, and circuit-breaker-style protections?",
			"Survey the repository for transient-failure handling patterns such as retry loops, backoff strategies, and guardrails around repeated failures.",
			"Which kinds of resilience logic are implemented across the code, including retry semantics, delay policies, and breaker-like checks?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "retry"; unresolved-required: "backoff"; unresolved-required: "circuit"',
	},
	{
		id: "cov-16",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What categories of indexer integration behavior are represented, including advertisement ingestion, lookup, and synchronization?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "indexer",
				required: true,
			},
			{
				artifactId: "ipni",
				required: true,
			},
			{
				artifactId: "sync",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What categories of indexer integration behavior are present, including ad ingestion, lookup flows, and synchronization?",
			"Survey the corpus for indexer-related logic such as advertisement ingestion, query/lookup behavior, and sync processes.",
			"Which kinds of indexer integration appear across the repo, from advertisement intake to lookup and synchronization handling?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "indexer"; unresolved-required: "ipni"; unresolved-required: "sync"',
	},
	{
		id: "cov-17",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"What kinds of cross-language boundaries exist between TypeScript and Solidity artifacts in this corpus?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "service_contracts",
				required: true,
			},
			{
				artifactId: "synapse-core",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/erc20.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/capabilities.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/pdp-capabilities.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		portability: "corpus-specific",
		paraphrases: [
			"What cross-language boundaries between TypeScript and Solidity artifacts exist in this corpus?",
			"Survey where TypeScript code interfaces with Solidity outputs or contracts across the repository.",
			"Which parts of the corpus sit at the TS/Solidity boundary, such as generated artifacts, ABI use, or contract wrappers?",
		],
		migrationNotes:
			'too-ambiguous-required: "synapse-core" -> 164 matches (cap 20); kept verbatim, will fail preflight; unresolved-required: "service_contracts"; ambiguous-required: "abi" -> 4 matches',
	},
	{
		id: "cov-18",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What categories of sector and deal validation logic are present, including checks around sectors, deals, and proof preconditions?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "deal",
				required: true,
			},
			{
				artifactId: "sector",
				required: true,
			},
			{
				artifactId: "validate",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr"],
		minResults: 3,
		portability: "portable",
		paraphrases: [
			"What sector and deal validation logic is present, including checks on sectors, deals, and proof prerequisites?",
			"Survey the repository for validation around sectors and deals, including preconditions needed before proofs can proceed.",
			"Which categories of sector/deal checking appear here, from acceptance validation to proof-related prerequisite checks?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "sector"; unresolved-required: "deal"; unresolved-required: "validate"',
	},
	{
		id: "cov-19",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"What kinds of contract upgrade mechanisms or upgrade discussions exist across the service contracts and related implementation code?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "service_contracts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/resources/contracts.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/contract-errors.ts",
				required: true,
			},
			{
				artifactId: "upgrade",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		minResults: 2,
		portability: "corpus-specific",
		paraphrases: [
			"What contract upgrade mechanisms or upgrade-related discussions exist across the service contracts and surrounding code?",
			"Survey the corpus for upgrade patterns in contracts and any related implementation or documentation about upgrades.",
			"Which kinds of contract-upgrade support and upgrade discussion are represented across service contracts and their tooling?",
		],
		migrationNotes:
			'unresolved-required: "upgrade"; ambiguous-required: "contract" -> 2 matches; unresolved-required: "service_contracts"',
	},
	{
		id: "cov-20",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query:
			"What categories of staking or slot-leasing mechanics are represented in contracts and surrounding implementation artifacts?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "./.release-please-manifest.json",
				required: true,
			},
			{
				artifactId: "./release-please-config.json",
				required: true,
			},
			{
				artifactId: "slot",
				required: true,
			},
			{
				artifactId: "stake",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-issue"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"What staking or slot-leasing mechanics are represented in contracts and adjacent implementation artifacts?",
			"Survey the code and docs for staking behavior or slot-leasing rules and their supporting implementation.",
			"Which categories of staking and leasing mechanics appear across the repository, both on-chain and in surrounding code?",
		],
		migrationNotes:
			'portability-mismatch: portability="portable" but applicableCorpora=[wtfoc-dogfood-2026-04-v3] (single corpus); unresolved-required: "stake"; unresolved-required: "slot"; ambiguous-required: "lease" -> 2 matches',
	},
	{
		id: "wl-9",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Where is IPNI advertisement validation implemented, and which PR or issue discussions explain why those validation checks were added?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "advertisement",
				required: true,
			},
			{
				artifactId: "ipni",
				required: true,
			},
			{
				artifactId: "validate-ipni-advertisement",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
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
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "validate-ipni-advertisement"; unresolved-required: "ipni"; unresolved-required: "advertisement"',
	},
	{
		id: "wl-10",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query:
			"Trace the implementation lineage for CommP verification in code and the PR comment trail that debated correctness or edge cases.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "./packages/cli/src/commands/verify.ts",
				required: true,
			},
			{
				artifactId: "CommP",
				required: true,
			},
			{
				artifactId: "piece",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
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
		migrationNotes:
			'unresolved-required: "CommP"; too-ambiguous-required: "piece" -> 31 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "wl-11",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How does the dataset lifecycle state machine get implemented in filecoin-services code, and what issue or PR threads document transition rationale?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "DataSetStatus",
				required: true,
			},
			{
				artifactId: "service_contracts",
				required: true,
			},
			{
				artifactId: "transition",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
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
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "DataSetStatus"; unresolved-required: "service_contracts"; unresolved-required: "transition"',
	},
	{
		id: "wl-12",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query:
			"Show the cross-org lineage from curio PDP proof verification code to the PRs that discuss verifier behavior and failure handling.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "./packages/cli/src/commands/verify.ts",
				required: true,
			},
			{
				artifactId: "curio",
				required: true,
			},
			{
				artifactId: "pdp",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
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
		migrationNotes:
			'unresolved-required: "curio"; too-ambiguous-required: "pdp" -> 25 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "wl-13",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Which TypeScript components in synapse-core consume contract ABI or service contract interfaces, and what PR/issue history explains those boundaries?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "service_contracts",
				required: true,
			},
			{
				artifactId: "synapse-core",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/erc20.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/capabilities.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/pdp-capabilities.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Which synapse-core TypeScript modules consume contract ABIs or service-contract interfaces, and what PR or issue history explains those integration points?",
			"Trace the TypeScript modules in synapse-core that depend on contract ABIs or service interfaces, along with the issue/PR rationale for those boundaries.",
			"What TS components in synapse-core sit on contract-interface boundaries, and which PRs or issues explain why they are structured that way?",
		],
		migrationNotes:
			'too-ambiguous-required: "synapse-core" -> 164 matches (cap 20); kept verbatim, will fail preflight; ambiguous-required: "abi" -> 4 matches; unresolved-required: "service_contracts"',
	},
	{
		id: "wl-14",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Trace indexer integration work from implementation files to the PR discussions that mention IPNI/indexer synchronization behavior.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "indexer",
				required: true,
			},
			{
				artifactId: "ipni",
				required: true,
			},
			{
				artifactId: "sync",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Trace indexer integration work from implementation files to the PR discussions that mention IPNI/indexer sync behavior.",
			"Where is indexer synchronization implemented, and which PR or issue threads talk about IPNI sync expectations?",
			"Follow the code path for indexer integration into the review history that discusses synchronization with IPNI or indexers.",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "indexer"; unresolved-required: "ipni"; unresolved-required: "sync"',
	},
	{
		id: "wl-15",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Where are retry or backoff behaviors implemented for external calls, and what issue or PR comment history explains those resilience choices?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "./apps/web/src/components/ErrorBanner.tsx",
				required: true,
			},
			{
				artifactId: "./packages/common/src/errors.ts",
				required: true,
			},
			{
				artifactId: "backoff",
				required: true,
			},
			{
				artifactId: "retry",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/base.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/chains.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/erc20.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/pay.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/pdp-verifier.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/pdp.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/piece.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/pull.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/errors/warm-storage.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/contract-errors.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/decode-pdp-errors.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/errors/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/errors/storage.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/src/utils/errors.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Where are retry or backoff patterns implemented for external calls, and what PR or issue history explains those resilience decisions?",
			"Trace network-call retry and backoff code to the discussions that justify the chosen resilience behavior.",
			"Which files implement retries around external interactions, and what issue or PR commentary explains the backoff strategy?",
		],
		migrationNotes:
			'unresolved-required: "retry"; unresolved-required: "backoff"; ambiguous-required: "error" -> 17 matches',
	},
	{
		id: "wl-16",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How did contract upgrade changes move from Solidity/ABI implementation to PR review discussion, and what concerns were raised about migration safety?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "./packages/cli/src/commands/unresolved-edges.ts",
				required: true,
			},
			{
				artifactId: "./packages/config/src/resolver.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/edge-resolution.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/eval/edge-resolution-evaluator.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/trace/resolution.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/cid-resolver.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/erc20.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/resolve-account-state.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/resolve-piece-url.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/capabilities.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/pdp-capabilities.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/scripts/benchmark-provider-resolve.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/scripts/compare-provider-resolve-calls.js",
				required: true,
			},
			{
				artifactId: "upgrade",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"How did contract upgrade work move from Solidity and ABI changes into PR review, and what migration-safety concerns came up?",
			"Trace contract upgrade support from implementation artifacts to review discussions that raised migration or upgrade safety risks.",
			"Where do the contract upgrade changes land in code, and what PR comments discuss safe migration concerns?",
		],
		migrationNotes:
			'unresolved-required: "upgrade"; ambiguous-required: "abi" -> 4 matches; ambiguous-required: "sol" -> 10 matches',
	},
	{
		id: "wl-17",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Trace deal lifecycle validation from curio-side code paths to related issue/PR threads that discuss invalid deal or sector edge cases.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "curio",
				required: true,
			},
			{
				artifactId: "deal",
				required: true,
			},
			{
				artifactId: "sector",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Trace deal-lifecycle validation from curio code paths to the issues or PRs that discuss invalid deal and sector edge cases.",
			"Where is deal validation implemented on the curio side, and which review threads discuss rejected deals or sector-related corner cases?",
			"Follow curio's deal-validation paths into the issue/PR history that covers invalid-deal and sector edge-case handling.",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "curio"; unresolved-required: "deal"; unresolved-required: "sector"',
	},
	{
		id: "wl-18",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Where is billing rail logic implemented for funding/deposit flows, and what PR/issue discussions explain charging or settlement behavior changes?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "billing",
				required: true,
			},
			{
				artifactId: "funding",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/apps/synapse-playground/src/components/payments/deposit-and-approve.tsx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/examples/cli/src/commands/deposit.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/deposit-with-permit.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/deposit.ts",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/warm-storage/calculate-deposit-needed.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-react/src/payments/use-deposit-and-approve.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Where is billing-rail logic for funding and deposit flows implemented, and what PR or issue discussions explain charging or settlement changes?",
			"Trace deposit/funding code for the billing rail back to issue or PR commentary about charging and settlement behavior.",
			"Which implementation files handle billing funding flows, and what review history explains shifts in charge or settlement semantics?",
		],
		migrationNotes:
			'unresolved-required: "billing"; unresolved-required: "funding"; ambiguous-required: "deposit" -> 6 matches',
	},
	{
		id: "wl-19",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Which PDP challenge-generation or challenge-validation code changes can be linked to PR comments discussing proof reliability and operator impact?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "pdp",
				required: true,
			},
			{
				artifactId: "proof",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/pdp-verifier/get-next-challenge-epoch.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Which PDP challenge-generation or validation changes can be tied to PR comments about proof reliability and operator impact?",
			"Trace PDP challenge creation or checking changes to review discussions focused on proof robustness and operational consequences.",
			"What code changes around PDP challenge generation/validation line up with PR commentary about verifier reliability or operator burden?",
		],
		migrationNotes:
			'too-ambiguous-required: "pdp" -> 25 matches (cap 20); kept verbatim, will fail preflight; unresolved-required: "proof"',
	},
	{
		id: "wl-20",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Trace how service contract state/view interfaces are used in implementation code and connected to issues/PRs that clarified contract semantics.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "./apps/web/src/components/EmptyState.tsx",
				required: true,
			},
			{
				artifactId: "./apps/web/src/components/SearchView.tsx",
				required: true,
			},
			{
				artifactId: "./apps/web/src/components/TraceView.tsx",
				required: true,
			},
			{
				artifactId: "./apps/web/src/state.ts",
				required: true,
			},
			{
				artifactId: "service_contracts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/core-concepts/filecoin-pay-overview.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/core-concepts/fwss-overview.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/core-concepts/pdp-overview.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/resolve-account-state.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Trace how service-contract state and view interfaces are consumed in implementation code and connected to issues or PRs clarifying contract semantics.",
			"Where are state/view interfaces from the service contracts used, and which issue or review threads explain what those interfaces mean?",
			"Follow the use of service-contract read interfaces in code back to PRs or issues that clarified their semantics.",
		],
		migrationNotes:
			'unresolved-required: "service_contracts"; ambiguous-required: "State" -> 3 matches; ambiguous-required: "View" -> 5 matches',
	},
	{
		id: "wl-21",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query:
			"Where are slot leasing mechanics implemented, and what PR or issue history explains leasing rules, limits, or arbitration behavior?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "./.release-please-manifest.json",
				required: true,
			},
			{
				artifactId: "./release-please-config.json",
				required: true,
			},
			{
				artifactId: "service_contracts",
				required: true,
			},
			{
				artifactId: "slot",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Where are slot-leasing mechanics implemented, and what PR or issue history explains the leasing rules, limits, or arbitration?",
			"Trace slot-leasing code to the issue or PR discussions that define limits, rule enforcement, or dispute handling.",
			"Which files implement slot leasing, and what review history explains how leasing constraints or arbitration are supposed to work?",
		],
		migrationNotes:
			'unresolved-required: "slot"; ambiguous-required: "lease" -> 2 matches; unresolved-required: "service_contracts"',
	},
	{
		id: "wl-22",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12"],
		query:
			"Trace staking mechanics from contract code to issue/PR commentary that discusses stake requirements, slashing risk, or incentive alignment.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "service_contracts",
				required: true,
			},
			{
				artifactId: "stake",
				required: true,
			},
			{
				artifactId: "synapse-sdk/docs/src/content/docs/resources/contracts.mdx",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/contract-errors.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Trace staking mechanics from contract implementation to issue or PR commentary about stake requirements, slashing exposure, or incentives.",
			"Where is staking behavior coded, and which PR or issue discussions cover required stake levels, slashing risk, or incentive design?",
			"Follow staking-related contracts and code into the review history that discusses stake sizing, slashing, and incentive alignment.",
		],
		migrationNotes:
			'unresolved-required: "stake"; ambiguous-required: "contract" -> 2 matches; unresolved-required: "service_contracts"',
	},
	{
		id: "wl-23",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How did indexer advertisement ingestion evolve from code changes to issue/PR discussions about malformed advertisement handling?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "advertisement",
				required: true,
			},
			{
				artifactId: "indexer",
				required: true,
			},
			{
				artifactId: "malformed",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"How did indexer advertisement ingestion evolve from code changes to issue or PR discussion about malformed advertisements?",
			"Trace the implementation history of advertisement ingestion into review threads focused on malformed IPNI ads.",
			"Where are indexer ad-ingestion changes implemented, and what PR or issue commentary discusses bad or malformed advertisement handling?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "indexer"; unresolved-required: "advertisement"; unresolved-required: "malformed"',
	},
	{
		id: "wl-24",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Which curio PDP implementation files map to cross-org PRs that reference filecoin-services contract assumptions, and what was resolved in review comments?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "curio",
				required: true,
			},
			{
				artifactId: "filecoin-services",
				required: true,
			},
			{
				artifactId: "pdp",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-pr-comment"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Which curio PDP implementation files correspond to cross-org PRs referencing filecoin-services contract assumptions, and what was resolved in review?",
			"Trace curio PDP files to external or cross-org PR discussions that depended on filecoin-services contract assumptions, and summarize what review settled.",
			"What curio PDP source changes map to PRs mentioning filecoin-services contract assumptions, and what conclusions came out of review comments?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "curio"; too-ambiguous-required: "pdp" -> 25 matches (cap 20); kept verbatim, will fail preflight; unresolved-required: "filecoin-services"',
	},
	{
		id: "wl-25",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Trace TypeScript-to-Solidity boundary work where SDK code paths were updated alongside contract artifacts, including the issue/PR lineage for those changes.",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "./packages/cli/src/commands/unresolved-edges.ts",
				required: true,
			},
			{
				artifactId: "./packages/config/src/resolver.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/edge-resolution.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/eval/edge-resolution-evaluator.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/trace/resolution.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/cid-resolver.ts",
				required: true,
			},
			{
				artifactId: "synapse-core",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/erc20.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/abis/index.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/pay/resolve-account-state.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/piece/resolve-piece-url.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/capabilities.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/pdp-capabilities.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/scripts/benchmark-provider-resolve.js",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-sdk/scripts/compare-provider-resolve-calls.js",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Trace TypeScript-to-Solidity boundary changes where SDK code paths were updated alongside contract artifacts, including the issue and PR lineage.",
			"Where did TS SDK code and Solidity artifacts change together, and what issue/PR trail documents that boundary work?",
			"Follow updates that touched both SDK TypeScript paths and contract artifacts, along with the linked issue and PR history.",
		],
		migrationNotes:
			'too-ambiguous-required: "synapse-core" -> 164 matches (cap 20); kept verbatim, will fail preflight; ambiguous-required: "abi" -> 4 matches; ambiguous-required: "sol" -> 10 matches',
	},
	{
		id: "wl-26",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Where do sector validation checks in curio connect to issue and PR discussion trails about deal acceptance criteria and proof preconditions?",
		queryType: "trace",
		difficulty: "hard",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [
			{
				artifactId: "curio",
				required: true,
			},
			{
				artifactId: "deal",
				required: true,
			},
			{
				artifactId: "sector",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "github-pr", "github-issue"],
		minResults: 3,
		requireEdgeHop: true,
		requireCrossSourceHops: true,
		portability: "corpus-specific",
		paraphrases: [
			"Where do curio sector-validation checks connect to issue and PR discussion about deal acceptance criteria and proof prerequisites?",
			"Trace curio's sector validation logic to the issue or review history covering deal-admission rules and proof preconditions.",
			"Which curio sector-checking files line up with PR or issue discussions about acceptance criteria for deals and required proof conditions?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "curio"; unresolved-required: "sector"; unresolved-required: "deal"',
	},
	{
		id: "port-4",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How is the command line interface structured and where are subcommands defined?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-5",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What are the common error patterns used across the codebase and how are they handled?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"What recurring error-handling patterns does the codebase use, and how are those errors processed?",
			"Survey the common error styles in the project and explain how failures are handled.",
			"How does this codebase typically model and respond to errors across modules?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-6",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Describe the project's dependency injection or service registration pattern.",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 2,
		requireEdgeHop: true,
		portability: "portable",
		paraphrases: [
			"What dependency-injection or service-registration pattern does the project use?",
			"How are services wired together in this system; is there a DI or registration mechanism?",
			"Describe how components are instantiated and registered if the codebase uses dependency injection or a service container.",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-7",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How are secrets and sensitive environment variables managed and validated?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"How are secrets and sensitive env vars validated and managed?",
			"What is the pattern for handling confidential configuration values and checking that required environment variables are present?",
			"Where does the system define and validate secrets or sensitive environment-based settings?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-8",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What is the strategy for handling asynchronous tasks or background jobs?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-9",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Which documentation files provide the best overview of the system's architecture?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		portability: "portable",
		paraphrases: [
			"Which docs are the best entry points for understanding the overall architecture?",
			"What documentation files give the clearest high-level system overview?",
			"If I want the architectural big picture, which docs should I read first?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-10",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Are there any mentions of performance bottlenecks or optimization goals in the documentation or issues?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Do the docs or issues mention any known performance bottlenecks or optimization targets?",
			"Where are performance concerns or optimization goals called out in documentation or issue history?",
			"Are there documented hotspots, scaling concerns, or stated optimization priorities anywhere in the repo?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-11",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How does the code interact with external APIs or third-party services?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-12",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "What logging levels are supported and where is the logger initialized?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"What log levels exist, and where is the logger configured or created?",
			"Which logging severities are supported by the project, and where does logger initialization happen?",
			"How is logging set up, including the available levels and the code that boots the logger?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-13",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How is data persistence handled and what database or storage engine is used?",
		queryType: "trace",
		difficulty: "medium",
		targetLayerHints: ["edge-extraction", "trace"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-14",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What is the test coverage strategy for new features according to the development guidelines?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 1,
		portability: "portable",
		paraphrases: [
			"What do the development guidelines say about test coverage for new features?",
			"How are contributors expected to test new functionality according to the project's guidelines?",
			"What is the stated testing expectation for newly added features?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-15",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Are there any unimplemented features or TODOs mentioned in the source code or issues?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "TODO",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 3,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Are there any TODOs or known-unimplemented features mentioned in code or issue discussions?",
			"Where does the repo call out unfinished work, whether as TODO comments or open issue notes?",
			"What unimplemented features or pending tasks are explicitly mentioned in source or issue history?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "TODO"',
	},
	{
		id: "port-16",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What are the core types or data structures that represent the primary entities in this system?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 3,
		requireEdgeHop: true,
		portability: "portable",
		paraphrases: [
			"What are the main entity types or core data structures in the system?",
			"Which types or structs model the primary concepts this project revolves around?",
			"Describe the foundational data structures that represent the system's key entities.",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-17",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "How is the CI/CD pipeline configured and what are the main build stages?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["markdown"],
		minResults: 2,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"How is CI/CD set up, and what are the major build or test stages?",
			"What does the pipeline configuration look like, including the main steps for build, test, and delivery?",
			"Where is the CI/CD workflow defined, and what are its principal stages?",
		],
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "port-18",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Are there any deprecated functions or modules that should no longer be used?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["ranking", "chunking"],
		expectedEvidence: [
			{
				artifactId: "@deprecated",
				required: true,
			},
			{
				artifactId: "deprecated",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code", "markdown"],
		minResults: 1,
		requireCrossSourceHops: true,
		portability: "portable",
		paraphrases: [
			"Are any functions or modules marked as deprecated or no longer recommended?",
			"What parts of the codebase are considered deprecated and should be avoided?",
			"Does the repository identify any APIs or modules as obsolete?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "@deprecated"; unresolved-required: "deprecated"',
	},
	{
		id: "fl-5",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Which file defines the HierarchicalCodeChunker class?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "HierarchicalCodeChunker",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file contains the HierarchicalCodeChunker class definition?",
			"Where is HierarchicalCodeChunker implemented?",
			"What source file declares the HierarchicalCodeChunker class?",
		],
		migrationNotes:
			'unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates; unresolved-required: "HierarchicalCodeChunker"',
	},
	{
		id: "fl-6",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Where is the implementation of the main entry point for the CLI?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "./apps/web/src/main.tsx",
				required: true,
			},
			{
				artifactId: "cli",
				required: true,
			},
			{
				artifactId: "synapse-sdk/apps/synapse-playground/src/main.tsx",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where is the CLI's main entry point implemented?",
			"Which file contains the primary startup code for the command-line interface?",
			"What source file serves as the main entry point for the CLI?",
		],
		migrationNotes:
			'too-ambiguous-required: "cli" -> 62 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "fl-7",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Which file contains the configuration schema or interface definitions?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "./packages/common/src/schemas/chunk.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/schemas/edge.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/schemas/eval.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/schemas/manifest.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/schema.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/schema/manifest.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/schema/segment.ts",
				required: true,
			},
			{
				artifactId: "./packages/store/src/schema/shared.ts",
				required: true,
			},
			{
				artifactId: "config",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/devnet/schema.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/utils/schemas.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file defines the configuration schema or interfaces?",
			"Where are the project's config types or schema definitions located?",
			"What source file contains the configuration interface or validation schema?",
		],
		migrationNotes:
			'too-ambiguous-required: "config" -> 39 matches (cap 20); kept verbatim, will fail preflight; ambiguous-required: "schema" -> 10 matches',
	},
	{
		id: "fl-8",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Where is the code that handles GitHub API integration and event processing?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "./packages/ingest/src/adapters/github/adapter.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/adapters/github/auth.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/adapters/github/http-transport.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/adapters/github/index.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/adapters/github/jwt.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/adapters/github/transport.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/edges/llm-client.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/edges/tree-sitter-client.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/examples/cli/src/client.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/warm-storage/get-client-data-set-ids.ts",
				required: true,
			},
			{
				artifactId:
					"synapse-sdk/packages/synapse-core/src/warm-storage/get-client-data-sets-length.ts",
				required: true,
			},
			{
				artifactId: "synapse-sdk/packages/synapse-core/src/warm-storage/get-client-data-sets.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where is GitHub API integration and event handling implemented?",
			"Which file manages GitHub API calls along with event-processing logic?",
			"What source file contains the code for GitHub integration and incoming event handling?",
		],
		migrationNotes:
			'ambiguous-required: "github" -> 6 matches; ambiguous-required: "client" -> 6 matches',
	},
	{
		id: "fl-9",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query: "Which file defines the storage interface for the Fact Oriented Codebase?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "./packages/common/src/interfaces/chunk-scorer.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/chunker.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/clusterer.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/edge-extractor.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/embedder.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/manifest-store.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/source-adapter.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/storage-backend.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/vector-index.ts",
				required: true,
			},
			{
				artifactId: "store",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file defines the storage interface for the Fact Oriented Codebase?",
			"Where is the core storage contract for the Fact Oriented Codebase declared?",
			"What file contains the storage interface used by the Fact Oriented Codebase?",
		],
		migrationNotes:
			'too-ambiguous-required: "store" -> 27 matches (cap 20); kept verbatim, will fail preflight; ambiguous-required: "interface" -> 9 matches',
	},
	{
		id: "fl-10",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query: "Where is the implementation of the RAG pipeline's embedding logic?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "./apps/web/server/collections/embedder-helper.ts",
				required: true,
			},
			{
				artifactId: "./docs/embedding-audit-trail.md",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/embedder.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/embedders/openai.ts",
				required: true,
			},
			{
				artifactId: "./packages/search/src/embedders/transformers.ts",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where is the embedding logic for the RAG pipeline implemented?",
			"Which file contains the code that generates embeddings in the RAG flow?",
			"What source file handles embedding generation for the retrieval pipeline?",
		],
		migrationNotes: 'ambiguous-required: "embed" -> 5 matches',
	},
	{
		id: "fl-11",
		authoredFromCollectionId: "wtfoc-dogfood-2026-04-v3",
		applicableCorpora: ["wtfoc-dogfood-2026-04-v3"],
		query: "Which file manages the ingestion of Slack or chat messages?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "./packages/ingest/src/adapters/chat-utils.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/adapters/slack.ts",
				required: true,
			},
			{
				artifactId: "ingest",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Which file is responsible for ingesting Slack or chat messages?",
			"Where is the code that processes Slack or other chat-message ingestion?",
			"What source file manages chat-message ingestion, including Slack data?",
		],
		migrationNotes:
			'too-ambiguous-required: "ingest" -> 76 matches (cap 20); kept verbatim, will fail preflight',
	},
	{
		id: "fl-12",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query: "Where are the constants and utility functions for edge extraction defined?",
		queryType: "lookup",
		difficulty: "medium",
		targetLayerHints: ["chunking"],
		expectedEvidence: [
			{
				artifactId: "./docs/demos/edge-extraction/README.md",
				required: true,
			},
			{
				artifactId: "./packages/cli/src/commands/extract-edges.ts",
				required: true,
			},
			{
				artifactId: "./packages/cli/src/extractor-config.ts",
				required: true,
			},
			{
				artifactId: "./packages/common/src/interfaces/edge-extractor.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/edges/extraction-status.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/edges/extractor.ts",
				required: true,
			},
			{
				artifactId: "./packages/ingest/src/eval/edge-extraction-evaluator.ts",
				required: true,
			},
			{
				artifactId: "edge",
				required: true,
			},
			{
				artifactId: "synapse-sdk/utils/example-leaf-count-extraction.js",
				required: true,
			},
		],
		acceptableAnswerFacts: [],
		requiredSourceTypes: ["code"],
		minResults: 1,
		portability: "corpus-specific",
		paraphrases: [
			"Where are the edge-extraction constants and helper utilities defined?",
			"Which file contains shared constants and utility functions used for edge extraction?",
			"What source file defines the reusable helpers and constants for extracting edges?",
		],
		migrationNotes:
			'too-ambiguous-required: "edge" -> 35 matches (cap 20); kept verbatim, will fail preflight; ambiguous-required: "extract" -> 8 matches',
	},
	{
		id: "syn-18",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What is the observability strategy, including logging patterns and any telemetry or tracing instrumentation?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-19",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How are error retry semantics and transient failure handling implemented across network-bound components?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-20",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Analyze the security threat model: how does the system handle untrusted input during ingestion and how are cross-tenant boundaries enforced?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-21",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"What is the data migration story? Describe how schema changes are handled and how historical facts are re-indexed.",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-22",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Describe the testing strategy, distinguishing between unit, integration, and e2e tests, and how they are verified in CI.",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-23",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"How is the dependency injection or plugin architecture structured to allow for extensible ingestion sources?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
	{
		id: "syn-24",
		authoredFromCollectionId: "filoz-ecosystem-2026-04-v12",
		applicableCorpora: ["filoz-ecosystem-2026-04-v12", "wtfoc-dogfood-2026-04-v3"],
		query:
			"Are there specific performance benchmarks or scalability triggers documented, and how does the code address these limits?",
		queryType: "howto",
		difficulty: "hard",
		targetLayerHints: ["ranking"],
		expectedEvidence: [],
		acceptableAnswerFacts: [],
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
		migrationNotes:
			"unresolved-all-substrings: no legacy substring matched any candidate catalog; falling back to scope-pattern candidates",
	},
];

/**
 * Runtime gold fixture. Authored queries (step 2) come first so step-2
 * coverage of a stratum naturally shadows the lower-quality migrated
 * entry on id collisions; downstream uniqueness checks still apply.
 */
export const GOLD_STANDARD_QUERIES: GoldQuery[] = [...AUTHORED_QUERIES, ...MIGRATED_QUERIES];
