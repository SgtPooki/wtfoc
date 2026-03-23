import type { Chunk, Edge } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { buildSegment, type SegmentChunk, segmentId } from "./segment-builder.js";

const defaultOptions = {
	embeddingModel: "Xenova/all-MiniLM-L6-v2",
	embeddingDimensions: 384,
};

function makeChunk(overrides?: Partial<Chunk>): Chunk {
	return {
		id: "test-chunk-id",
		content: "hello world test content",
		sourceType: "markdown",
		source: "test.md",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
		...overrides,
	};
}

function makeEdge(overrides?: Partial<Edge>): Edge {
	return {
		type: "references",
		sourceId: "chunk-1",
		targetType: "issue",
		targetId: "FilOzone/synapse-sdk#42",
		evidence: "#42 in text",
		confidence: 1.0,
		...overrides,
	};
}

describe("buildSegment", () => {
	it("creates a segment with schemaVersion 1", () => {
		const segment = buildSegment([], [], defaultOptions);
		expect(segment.schemaVersion).toBe(1);
	});

	it("includes embedding model metadata", () => {
		const segment = buildSegment([], [], defaultOptions);
		expect(segment.embeddingModel).toBe("Xenova/all-MiniLM-L6-v2");
		expect(segment.embeddingDimensions).toBe(384);
	});

	it("maps chunks with embeddings into segment format", () => {
		const chunks: SegmentChunk[] = [
			{ chunk: makeChunk({ id: "a", source: "file1.md" }), embedding: [0.1, 0.2, 0.3] },
			{ chunk: makeChunk({ id: "b", source: "file2.md" }), embedding: [0.4, 0.5, 0.6] },
		];
		const segment = buildSegment(chunks, [], defaultOptions);

		expect(segment.chunks).toHaveLength(2);
		expect(segment.chunks[0]!.id).toBe("a");
		expect(segment.chunks[0]!.embedding).toEqual([0.1, 0.2, 0.3]);
		expect(segment.chunks[1]!.source).toBe("file2.md");
	});

	it("maps edges into segment format", () => {
		const edges = [makeEdge({ type: "references" }), makeEdge({ type: "closes" })];
		const segment = buildSegment([], edges, defaultOptions);

		expect(segment.edges).toHaveLength(2);
		expect(segment.edges[0]!.type).toBe("references");
		expect(segment.edges[1]!.type).toBe("closes");
	});

	it("extracts BM25 terms from content when not provided", () => {
		const chunks: SegmentChunk[] = [
			{ chunk: makeChunk({ content: "upload timeout error large files" }), embedding: [1] },
		];
		const segment = buildSegment(chunks, [], defaultOptions);

		expect(segment.chunks[0]!.terms).toContain("upload");
		expect(segment.chunks[0]!.terms).toContain("timeout");
		expect(segment.chunks[0]!.terms).toContain("error");
	});

	it("uses provided terms when available", () => {
		const chunks: SegmentChunk[] = [
			{ chunk: makeChunk(), embedding: [1], terms: ["custom", "terms"] },
		];
		const segment = buildSegment(chunks, [], defaultOptions);

		expect(segment.chunks[0]!.terms).toEqual(["custom", "terms"]);
	});

	it("preserves sourceType and sourceUrl on chunks", () => {
		const chunks: SegmentChunk[] = [
			{
				chunk: makeChunk({
					sourceType: "github-issue",
					sourceUrl: "https://github.com/FilOzone/synapse-sdk/issues/42",
				}),
				embedding: [1],
			},
		];
		const segment = buildSegment(chunks, [], defaultOptions);

		expect(segment.chunks[0]!.sourceType).toBe("github-issue");
		expect(segment.chunks[0]!.sourceUrl).toBe("https://github.com/FilOzone/synapse-sdk/issues/42");
	});

	it("handles empty chunks and edges", () => {
		const segment = buildSegment([], [], defaultOptions);
		expect(segment.chunks).toEqual([]);
		expect(segment.edges).toEqual([]);
	});
});

describe("segmentId", () => {
	it("produces deterministic ID for same content", () => {
		const chunks: SegmentChunk[] = [{ chunk: makeChunk({ id: "a" }), embedding: [1, 2, 3] }];
		const segment1 = buildSegment(chunks, [], defaultOptions);
		const segment2 = buildSegment(chunks, [], defaultOptions);

		expect(segmentId(segment1)).toBe(segmentId(segment2));
	});

	it("produces different ID for different content", () => {
		const segment1 = buildSegment(
			[{ chunk: makeChunk({ id: "a" }), embedding: [1] }],
			[],
			defaultOptions,
		);
		const segment2 = buildSegment(
			[{ chunk: makeChunk({ id: "b" }), embedding: [2] }],
			[],
			defaultOptions,
		);

		expect(segmentId(segment1)).not.toBe(segmentId(segment2));
	});
});
