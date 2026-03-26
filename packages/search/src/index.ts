// @wtfoc/search — Embedder + vector index + query + trace
// See SPEC.md for search/trace architecture

export { centroid, dot, extractLabel, GreedyClusterer, normalize } from "./clustering/index.js";
export type { EdgeResolutionStats, SourceIndex } from "./edge-resolution.js";
export { analyzeEdgeResolution, buildSourceIndex, resolves } from "./edge-resolution.js";
export type { OpenAIEmbedderOptions } from "./embedders/openai.js";
export { OpenAIEmbedder } from "./embedders/openai.js";
export type { TransformersEmbedderOptions } from "./embedders/transformers.js";
export { TransformersEmbedder } from "./embedders/transformers.js";
export type { VectorBackend, VectorIndexConfig } from "./index/factory.js";
export { createVectorIndex } from "./index/factory.js";
export { InMemoryVectorIndex } from "./index/in-memory.js";
export type { QdrantVectorIndexOptions } from "./index/qdrant.js";
export { QdrantCollectionGc, QdrantVectorIndex } from "./index/qdrant.js";
export type { MountedCollection, MountOptions } from "./mount.js";
export { mountCollection } from "./mount.js";
export type { QueryOptions, QueryResult } from "./query.js";
export { query } from "./query.js";
export type {
	InsightKind,
	TraceHop,
	TraceInsight,
	TraceMode,
	TraceOptions,
	TraceResult,
} from "./trace/index.js";
export { detectInsights, trace } from "./trace/index.js";
