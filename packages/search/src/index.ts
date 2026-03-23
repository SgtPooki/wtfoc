// @wtfoc/search — Embedder + vector index + query + trace
// See SPEC.md for search/trace architecture

export type { OpenAIEmbedderOptions } from "./embedders/openai.js";
export { OpenAIEmbedder } from "./embedders/openai.js";
export { TransformersEmbedder } from "./embedders/transformers.js";
