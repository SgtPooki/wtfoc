/**
 * CONTRACT: CompositeEdgeExtractor
 *
 * Orchestrates multiple extractors, merges results, deduplicates
 * by canonical key, calibrates confidence, tracks provenance.
 */

import type { Chunk } from "@wtfoc/common";
import type { Edge } from "@wtfoc/common";
import type { EdgeExtractor } from "./edge-extractor.js";

/**
 * Configuration for a registered extractor in the composite pipeline.
 */
export interface ExtractorRegistration {
	/** Unique name for provenance tracking */
	name: string;
	/** The extractor instance */
	extractor: EdgeExtractor;
	/** Whether this extractor is enabled (default: true) */
	enabled?: boolean;
}

/**
 * Canonical dedup key: JSON-stable-stringify of (type, sourceId, targetType, targetId).
 * Uses JSON encoding instead of delimiter to avoid collision when fields contain `|`.
 */
export type EdgeKey = string; // JSON.stringify([type, sourceId, targetType, targetId])

/**
 * Internal merged edge with provenance tracking.
 */
export interface MergedEdge {
	edge: Edge;
	provenance: Set<string>;
	evidenceParts: string[];
}

/**
 * CompositeEdgeExtractor runs all registered extractors,
 * merges their output, and deduplicates.
 *
 * Merge rules:
 * - Canonical key: (type, sourceId, targetType, targetId)
 * - Evidence: merged from all contributors, separated by " | "
 * - Confidence: max(individual) + 0.05 per additional agreeing extractor (capped at 1.0)
 * - Provenance: set of extractor names that found the edge
 */
export interface CompositeEdgeExtractor extends EdgeExtractor {
	/** Register an extractor in the pipeline */
	register(registration: ExtractorRegistration): void;

	/** Extract edges from all registered extractors and merge */
	extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]>;
}
