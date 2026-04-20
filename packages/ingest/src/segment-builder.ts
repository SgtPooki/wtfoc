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
			// #220 Session 2 — preserve chunker provenance in metadata so
			// downstream tools (dogfood breakdowns, drift analysis) can tell
			// which chunker produced a given chunk. These fields exist on
			// ChunkerOutput but are not part of the Chunk base schema, so
			// threading them through metadata keeps the segment schema stable.
			//
			// Keys are prefixed with `_chunker` (#220 Session 3) to make them
			// collision-safe against adapter-written metadata — every existing
			// adapter uses unprefixed camelCase keys like `filePath`/`repo`, so
			// the `_chunker` namespace reserves this slice of the metadata
			// space for chunker provenance without risking silent overwrites.
			const chunkerMeta: Record<string, string> = {};
			const co = c.chunk as Chunk & {
				chunkerName?: string;
				chunkerVersion?: string;
				symbolPath?: string;
			};
			if (co.chunkerName) chunkerMeta._chunkerName = co.chunkerName;
			if (co.chunkerVersion) chunkerMeta._chunkerVersion = co.chunkerVersion;
			if (co.symbolPath) chunkerMeta._chunkerSymbolPath = co.symbolPath;

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
				timestampKind: c.chunk.timestampKind,
				metadata: { ...c.chunk.metadata, ...chunkerMeta },
			};
			if (c.signalScores && Object.keys(c.signalScores).length > 0) {
				entry.signalScores = c.signalScores;
			}
			if (c.chunk.documentId) entry.documentId = c.chunk.documentId;
			if (c.chunk.documentVersionId) entry.documentVersionId = c.chunk.documentVersionId;
			if (c.chunk.contentFingerprint) entry.contentFingerprint = c.chunk.contentFingerprint;
			return entry;
		}),
		edges: edges.map((e) => {
			const segEdge: Segment["edges"][number] = {
				type: e.type,
				sourceId: e.sourceId,
				targetType: e.targetType,
				targetId: e.targetId,
				evidence: e.evidence,
				confidence: e.confidence,
			};
			if (e.provenance) segEdge.provenance = e.provenance;
			if (e.structuredEvidence) segEdge.structuredEvidence = e.structuredEvidence;
			return segEdge;
		}),
	};
}

/**
 * Compute a deterministic ID for a segment (SHA-256 of serialized JSON).
 * Useful for dedup — same chunks + edges = same segment ID.
 */
/**
 * Convert a stored segment chunk entry back to a SegmentChunk for rebuilding.
 * Single source of truth — prevents field-dropping bugs when new optional
 * fields are added to Chunk (see #233).
 */
export function storedChunkToSegmentChunk(c: Segment["chunks"][number]): SegmentChunk {
	return {
		chunk: {
			id: c.id,
			content: c.content,
			sourceType: c.sourceType,
			source: c.source,
			sourceUrl: c.sourceUrl,
			timestamp: c.timestamp,
			timestampKind: c.timestampKind,
			chunkIndex: 0,
			totalChunks: 0,
			metadata: c.metadata,
			documentId: c.documentId,
			documentVersionId: c.documentVersionId,
			contentFingerprint: c.contentFingerprint,
		},
		embedding: c.embedding,
		terms: c.terms,
		signalScores: c.signalScores,
	};
}

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
	let minMs = Number.POSITIVE_INFINITY;
	let maxMs = Number.NEGATIVE_INFINITY;
	let minIso = "";
	let maxIso = "";
	const repos = new Set<string>();

	for (const c of chunks) {
		const ts = c.timestamp ?? c.metadata.updatedAt ?? c.metadata.createdAt ?? "";
		if (ts) {
			const ms = Date.parse(ts);
			if (!Number.isNaN(ms)) {
				if (ms < minMs) {
					minMs = ms;
					minIso = ts;
				}
				if (ms > maxMs) {
					maxMs = ms;
					maxIso = ts;
				}
			}
		}

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

	const timeRange = minIso && maxIso ? { from: minIso, to: maxIso } : undefined;
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
