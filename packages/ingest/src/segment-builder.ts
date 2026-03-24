import { createHash } from "node:crypto";
import type { Chunk, Edge, Segment } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION } from "@wtfoc/common";

export interface SegmentBuilderOptions {
	embeddingModel: string;
	embeddingDimensions: number;
}

export interface SegmentChunk {
	chunk: Chunk;
	embedding: number[];
	/** BM25 terms extracted from content (optional for MVP) */
	terms?: string[];
}

/**
 * Builds an immutable segment from chunks + embeddings + edges.
 * Segments are the write-once storage unit in the manifest chain.
 */
export function buildSegment(
	chunks: SegmentChunk[],
	edges: Edge[],
	options: SegmentBuilderOptions,
): Segment {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		embeddingModel: options.embeddingModel,
		embeddingDimensions: options.embeddingDimensions,
		chunks: chunks.map((c) => ({
			id: c.chunk.id,
			storageId: c.chunk.id,
			content: c.chunk.content,
			embedding: c.embedding,
			terms: c.terms ?? extractTerms(c.chunk.content),
			source: c.chunk.source,
			sourceType: c.chunk.sourceType,
			sourceUrl: c.chunk.sourceUrl,
			timestamp: c.chunk.timestamp,
			metadata: c.chunk.metadata,
		})),
		edges: edges.map((e) => ({
			type: e.type,
			sourceId: e.sourceId,
			targetType: e.targetType,
			targetId: e.targetId,
			evidence: e.evidence,
			confidence: e.confidence,
		})),
	};
}

/**
 * Compute a deterministic ID for a segment (SHA-256 of serialized JSON).
 * Useful for dedup — same chunks + edges = same segment ID.
 */
export function segmentId(segment: Segment): string {
	const serialized = JSON.stringify(segment);
	return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Extract simple BM25-style terms from text.
 * Lowercased, split on whitespace/punctuation, deduplicated.
 */
function extractTerms(text: string): string[] {
	const words = text
		.toLowerCase()
		.split(/[\s\p{P}]+/u)
		.filter((w) => w.length > 2);
	return [...new Set(words)];
}
