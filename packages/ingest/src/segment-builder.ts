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
	/** Heuristic signal scores for this chunk (optional) */
	signalScores?: Record<string, number>;
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
		chunks: chunks.map((c) => {
			const entry: Segment["chunks"][number] = {
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
			};
			if (c.signalScores && Object.keys(c.signalScores).length > 0) {
				entry.signalScores = c.signalScores;
			}
			return entry;
		}),
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
 * Extract segment-level repo and time metadata from a batch of chunks.
 * Used to populate SegmentSummary.repoIds and SegmentSummary.timeRange.
 */
export function extractSegmentMetadata(chunks: Chunk[]): {
	timeRange?: { from: string; to: string };
	repoIds?: string[];
} {
	// Collect timestamps
	const timestamps: string[] = [];
	const repos = new Set<string>();

	for (const c of chunks) {
		const ts = c.timestamp ?? c.metadata.updatedAt ?? c.metadata.createdAt ?? "";
		if (ts) timestamps.push(ts);

		// Extract repo identity
		if (c.metadata.repo) {
			repos.add(c.metadata.repo);
		} else if (
			c.sourceType.startsWith("github-") ||
			c.sourceType === "code" ||
			c.sourceType === "markdown"
		) {
			const m = c.source.match(/^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/);
			if (m?.[1]) repos.add(m[1]);
		}
	}

	timestamps.sort();
	const first = timestamps[0];
	const last = timestamps[timestamps.length - 1];
	const timeRange = first && last ? { from: first, to: last } : undefined;
	const repoIds = repos.size > 0 ? [...repos].sort() : undefined;

	return { timeRange, repoIds };
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
