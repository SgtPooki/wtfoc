import type { Chunk } from "../schemas/chunk.js";
import type { Edge } from "../schemas/edge.js";

/**
 * Pluggable edge extractor. Analyzes chunks to find cross-source
 * connections (issue references, PR closing keywords, changed files, etc.).
 */
export interface EdgeExtractor {
	extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]>;
}
