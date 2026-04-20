// @wtfoc/search — Embedder + vector index + query + trace
// See SPEC.md for search/trace architecture

export type { RerankCandidate, Reranker, RerankResult } from "@wtfoc/common";
export { centroid, dot, extractLabel, GreedyClusterer, normalize } from "./clustering/index.js";
export type { EdgeResolutionStats, SourceIndex } from "./edge-resolution.js";
export { analyzeEdgeResolution, buildSourceIndex, resolves } from "./edge-resolution.js";
export type { OpenAIEmbedderOptions } from "./embedders/openai.js";
export { OpenAIEmbedder } from "./embedders/openai.js";
export type { TransformersEmbedderOptions } from "./embedders/transformers.js";
export { TransformersEmbedder } from "./embedders/transformers.js";
// Eval evaluators
export { evaluateEdgeResolution } from "./eval/edge-resolution-evaluator.js";
export type { AggregateLineageMetrics, LineageMetrics } from "./eval/lineage-metrics.js";
export { aggregateLineageMetrics, computeLineageMetrics } from "./eval/lineage-metrics.js";
export { evaluateQualityQueries } from "./eval/quality-queries-evaluator.js";
export { evaluateSearch } from "./eval/search-evaluator.js";
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
