// @wtfoc/search — Embedder + vector index + query + trace
// See SPEC.md for search/trace architecture

export type { OpenAIEmbedderOptions } from "./embedders/openai.js";
export { OpenAIEmbedder } from "./embedders/openai.js";
export { TransformersEmbedder } from "./embedders/transformers.js";
export { InMemoryVectorIndex } from "./index/in-memory.js";
export type { QueryOptions, QueryResult } from "./query.js";
export { query } from "./query.js";
export type { TraceHop, TraceOptions, TraceResult } from "./trace.js";
export { trace } from "./trace.js";
