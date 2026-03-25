// @wtfoc/search — Embedder + vector index + query + trace
// See SPEC.md for search/trace architecture

export type { EdgeResolutionStats, SourceIndex } from "./edge-resolution.js";
export { analyzeEdgeResolution, buildSourceIndex, resolves } from "./edge-resolution.js";
export type { OpenAIEmbedderOptions } from "./embedders/openai.js";
export { OpenAIEmbedder } from "./embedders/openai.js";
export { TransformersEmbedder } from "./embedders/transformers.js";
export { InMemoryVectorIndex } from "./index/in-memory.js";
export type { MountedCollection, MountOptions } from "./mount.js";
export { mountCollection } from "./mount.js";
export type { QueryOptions, QueryResult } from "./query.js";
export { query } from "./query.js";
export type { TraceHop, TraceOptions, TraceResult } from "./trace/index.js";
export { trace } from "./trace/index.js";
