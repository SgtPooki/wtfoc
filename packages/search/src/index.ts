// @wtfoc/search — Embedder + vector index + query + trace
// See SPEC.md for search/trace architecture

export type { OpenAIEmbedderOptions } from "./embedders/openai.js";
export { OpenAIEmbedder } from "./embedders/openai.js";
export { TransformersEmbedder } from "./embedders/transformers.js";
export { InMemoryVectorIndex } from "./index/in-memory.js";
export { trace } from "./trace.js";
export type { TraceHop, TraceOptions, TraceResult } from "./trace.js";
