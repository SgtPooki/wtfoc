// @wtfoc/search — Embedder + vector index + query + trace
// See SPEC.md for search/trace architecture

export type { RerankCandidate, Reranker, RerankResult } from "@wtfoc/common";
export { centroid, dot, extractLabel, GreedyClusterer, normalize } from "./clustering/index.js";
export type { EdgeResolutionStats, SourceIndex } from "./edge-resolution.js";
export { analyzeEdgeResolution, buildSourceIndex, resolves } from "./edge-resolution.js";
export { CachingEmbedder, type CachingEmbedderOptions } from "./embedders/caching.js";
export type { OpenAIEmbedderOptions } from "./embedders/openai.js";
export { OpenAIEmbedder } from "./embedders/openai.js";
export type { TransformersEmbedderOptions } from "./embedders/transformers.js";
export { TransformersEmbedder } from "./embedders/transformers.js";
// Eval evaluators
export type {
	PreflightCatalogEntry,
	PreflightCorpusStats,
	PreflightQueryResult,
	PreflightStatus,
	PreflightSummary,
	RunPreflightOptions,
} from "./eval/catalog-applicability-preflight.js";
export {
	renderPreflightMarkdown,
	runPreflight,
} from "./eval/catalog-applicability-preflight.js";
export { evaluateEdgeResolution } from "./eval/edge-resolution-evaluator.js";
export type {
	DiagnoseFailureInput,
	DiagnosisAggregate,
	DiagnosisEvidence,
	DiagnosisScoreInput,
	FailureClass,
	FailureDiagnosis,
	FailureLayer,
} from "./eval/failure-diagnosis.js";
export {
	aggregateDiagnoses,
	diagnoseFailure,
} from "./eval/failure-diagnosis.js";
export type {
	CoverageReport,
	FixtureHealthSignal,
	OperatorFamily,
	SemanticStratumCount,
	SemanticStratumKey,
	StructuralStratumCount,
	StructuralStratumKey,
	UncoveredStratum,
} from "./eval/fixture-health.js";
export {
	buildCoverageReport,
	DEFAULT_GINI_FLOOR,
	DEFAULT_MIN_UNCOVERED_STRATA,
	deriveFixtureHealthSignal,
	estimateHopCount,
	giniCoefficient,
	inferOperatorFamily,
	isCrossSource,
} from "./eval/fixture-health.js";
export {
	type Difficulty,
	type ExpectedEvidence,
	GOLD_STANDARD_QUERIES,
	GOLD_STANDARD_QUERIES_VERSION,
	type GoldQuery,
	type LayerHint,
	type QueryType,
} from "./eval/gold-standard-queries.js";
export type { AggregateLineageMetrics, LineageMetrics } from "./eval/lineage-metrics.js";
export { aggregateLineageMetrics, computeLineageMetrics } from "./eval/lineage-metrics.js";
export {
	evaluateQualityQueries,
	HARD_NEGATIVE_NOISE_FLOOR,
	HARD_NEGATIVE_RESULT_CEILING,
	HARD_NEGATIVE_SCORE_CEILING,
} from "./eval/quality-queries-evaluator.js";
export { evaluateSearch } from "./eval/search-evaluator.js";
export type {
	AdversarialFilterOptions,
	AdversarialFilterResult,
	CandidateQuery,
	CatalogArtifact,
	LengthBucket,
	QueryTemplate,
	RecipeSample,
	RetrieveTopK,
	SamplingOptions,
	Stratum,
} from "./eval/stratified-template-recipe.js";
export {
	applyAdversarialFilter,
	groupByStratum,
	lengthBucketOf,
	sampleStratified,
	stratifyArtifacts,
	stratumKey,
} from "./eval/stratified-template-recipe.js";
export { evaluateThemes } from "./eval/themes-evaluator.js";
export type { VectorBackend, VectorIndexConfig } from "./index/factory.js";
export { createVectorIndex } from "./index/factory.js";
export { InMemoryVectorIndex } from "./index/in-memory.js";
export type { QdrantVectorIndexOptions } from "./index/qdrant.js";
export { QdrantCollectionGc, QdrantVectorIndex } from "./index/qdrant.js";
export type { MountedCollection, MountOptions } from "./mount.js";
export { mountCollection } from "./mount.js";
export type { PersonaClassification, QueryPersona } from "./persona/classify-query.js";
export { classifyQueryPersona } from "./persona/classify-query.js";
export type { QueryOptions, QueryResult } from "./query.js";
export { query } from "./query.js";
export type { BgeRerankerOptions } from "./rerankers/bge.js";
export { BgeReranker } from "./rerankers/bge.js";
export type { CohereRerankerOptions } from "./rerankers/cohere.js";
export { CohereReranker } from "./rerankers/cohere.js";
export type { LlmRerankerOptions } from "./rerankers/llm.js";
export { LlmReranker } from "./rerankers/llm.js";
export { PassthroughReranker } from "./rerankers/passthrough.js";
export type {
	InsightKind,
	LineageChain,
	TraceHop,
	TraceInsight,
	TraceMode,
	TraceOptions,
	TraceResult,
	TraceView,
} from "./trace/index.js";
export {
	buildChronologicalHopIndices,
	detectInsights,
	parseHopTimestampMs,
	trace,
} from "./trace/index.js";
