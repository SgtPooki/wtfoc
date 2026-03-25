/**
 * CONTRACT: Async EdgeExtractor interface
 *
 * Breaking change from sync `extract(chunks: Chunk[]): Edge[]`
 * to async with AbortSignal support.
 *
 * All implementations (Regex, Heuristic, TreeSitter, LLM, Composite)
 * implement this interface.
 */

import type { Chunk } from "@wtfoc/common"; // schemas/chunk.ts
import type { Edge } from "@wtfoc/common"; // schemas/edge.ts

/**
 * Pluggable edge extractor. Analyzes chunks to find cross-source
 * connections (issue references, PR closing keywords, imports, etc.).
 *
 * Implementations:
 * - RegexEdgeExtractor (existing, updated to async)
 * - HeuristicEdgeExtractor (Slack/Jira/markdown patterns)
 * - TreeSitterEdgeExtractor (code imports/dependencies)
 * - LlmEdgeExtractor (optional, background, fail-open)
 * - CompositeEdgeExtractor (orchestrator)
 */
export interface EdgeExtractor {
	extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]>;
}
