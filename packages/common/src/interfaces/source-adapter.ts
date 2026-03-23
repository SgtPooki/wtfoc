import type { Chunk } from "../schemas/chunk.js";
import type { Edge } from "../schemas/edge.js";

/**
 * Configuration for a source adapter.
 */
export interface SourceConfig {
	/** Source type identifier */
	type: string;
	/** Source-specific configuration (file paths, repo names, tokens, etc.) */
	options: Record<string, unknown>;
}

/**
 * Pluggable source adapter. Ingests data from an external source,
 * produces typed chunks and extracted edges.
 */
export interface SourceAdapter {
	readonly sourceType: string;
	ingest(config: SourceConfig, signal?: AbortSignal): AsyncIterable<Chunk>;
	extractEdges(chunks: Chunk[]): Edge[];
}
