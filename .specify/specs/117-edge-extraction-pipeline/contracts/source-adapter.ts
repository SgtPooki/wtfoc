/**
 * CONTRACT: Updated SourceAdapter interface
 *
 * Breaking change: extractEdges() becomes async.
 */

import type { Chunk } from "@wtfoc/common";
import type { Edge } from "@wtfoc/common";

/**
 * Pluggable source adapter. Ingests data from an external source,
 * produces typed chunks and extracted edges.
 *
 * extractEdges() returns source-specific edges only (e.g. PR changed-file edges).
 * Pattern-based extraction (regex, heuristic, LLM) is handled by CompositeEdgeExtractor.
 * Adapters that previously delegated to RegexEdgeExtractor should return [].
 */
export interface SourceAdapter<TConfig = Record<string, unknown>> {
	readonly sourceType: string;
	parseConfig(raw: Record<string, unknown>): TConfig;
	ingest(config: TConfig, signal?: AbortSignal): AsyncIterable<Chunk>;
	extractEdges(chunks: Chunk[]): Promise<Edge[]>;
}
