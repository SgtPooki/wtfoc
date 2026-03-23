/**
 * Pluggable embedder. Transforms text into vector representations.
 * Built-in: transformers.js (local), OpenAI (API key required).
 */
export interface Embedder {
	embed(text: string, signal?: AbortSignal): Promise<Float32Array>;
	embedBatch(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
	readonly dimensions: number;
}
