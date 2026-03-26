import type { PrefixFormatter } from "../config-types.js";

/**
 * Pluggable embedder. Transforms text into vector representations.
 * Built-in: transformers.js (local), OpenAI (API key required).
 */
export interface Embedder {
	embed(text: string, signal?: AbortSignal): Promise<Float32Array>;
	embedBatch(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
	readonly dimensions: number;
	/** Model identifier (e.g. "Xenova/all-MiniLM-L6-v2"). Optional for backwards compatibility. */
	readonly model?: string;
	/** Maximum input characters this embedder can handle before truncation. */
	readonly maxInputChars?: number;
	/** Optional prefix formatter for asymmetric query/document embedding. */
	readonly prefix?: PrefixFormatter;
}
