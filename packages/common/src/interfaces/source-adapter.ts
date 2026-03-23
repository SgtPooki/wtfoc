import type { Chunk } from "../schemas/chunk.js";
import type { Edge } from "../schemas/edge.js";

/**
 * Pluggable source adapter. Ingests data from an external source,
 * produces typed chunks and extracted edges.
 *
 * Generic over TConfig — each adapter defines its own config shape.
 * The CLI/orchestrator passes raw options; the adapter validates
 * them via `parseConfig()` before `ingest()` is called.
 */
export interface SourceAdapter<TConfig = Record<string, unknown>> {
	readonly sourceType: string;
	/** Parse and validate raw options into a typed config. Throws on invalid input. */
	parseConfig(raw: Record<string, unknown>): TConfig;
	ingest(config: TConfig, signal?: AbortSignal): AsyncIterable<Chunk>;
	extractEdges(chunks: Chunk[]): Edge[];
}
