import type { Chunk, Edge, Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import {
	buildSegment,
	extractSegmentMetadata,
	type SegmentChunk,
	segmentId,
	storedChunkToSegmentChunk,
} from "./segment-builder.js";

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
		expect(segment.chunks[0]?.id).toBe("a");
		expect(segment.chunks[0]?.embedding).toEqual([0.1, 0.2, 0.3]);
		expect(segment.chunks[1]?.source).toBe("file2.md");
	});

	it("maps edges into segment format", () => {
		const edges = [makeEdge({ type: "references" }), makeEdge({ type: "closes" })];
		const segment = buildSegment([], edges, defaultOptions);

		expect(segment.edges).toHaveLength(2);
		expect(segment.edges[0]?.type).toBe("references");
		expect(segment.edges[1]?.type).toBe("closes");
	});

	it("extracts BM25 terms from content when not provided", () => {
		const chunks: SegmentChunk[] = [
			{ chunk: makeChunk({ content: "upload timeout error large files" }), embedding: [1] },
		];
		const segment = buildSegment(chunks, [], defaultOptions);

		expect(segment.chunks[0]?.terms).toContain("upload");
		expect(segment.chunks[0]?.terms).toContain("timeout");
		expect(segment.chunks[0]?.terms).toContain("error");
	});

	it("uses provided terms when available", () => {
		const chunks: SegmentChunk[] = [
			{ chunk: makeChunk(), embedding: [1], terms: ["custom", "terms"] },
		];
		const segment = buildSegment(chunks, [], defaultOptions);

		expect(segment.chunks[0]?.terms).toEqual(["custom", "terms"]);
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

		expect(segment.chunks[0]?.sourceType).toBe("github-issue");
		expect(segment.chunks[0]?.sourceUrl).toBe("https://github.com/FilOzone/synapse-sdk/issues/42");
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

describe("extractSegmentMetadata", () => {
	it("returns undefined for chunks with no timestamps or repo info", () => {
		const chunks = [makeChunk({ source: "#general", sourceType: "slack-message" })];
		const result = extractSegmentMetadata(chunks);
		expect(result.timeRange).toBeUndefined();
		expect(result.repoIds).toBeUndefined();
	});

	it("extracts timeRange from chunk timestamps", () => {
		const chunks = [
			makeChunk({ timestamp: "2025-01-15T10:00:00Z" }),
			makeChunk({ timestamp: "2025-01-20T12:00:00Z" }),
			makeChunk({ timestamp: "2025-01-10T08:00:00Z" }),
		];
		const result = extractSegmentMetadata(chunks);
		expect(result.timeRange).toEqual({
			from: "2025-01-10T08:00:00Z",
			to: "2025-01-20T12:00:00Z",
		});
	});

	it("skips invalid timestamps and still computes range from valid ones", () => {
		const chunks = [
			makeChunk({ timestamp: "not-a-date" }),
			makeChunk({ timestamp: "2025-01-15T10:00:00Z" }),
			makeChunk({ timestamp: "2025-01-20T12:00:00Z" }),
		];
		const result = extractSegmentMetadata(chunks);
		expect(result.timeRange).toEqual({
			from: "2025-01-15T10:00:00Z",
			to: "2025-01-20T12:00:00Z",
		});
	});

	it("falls back to metadata.updatedAt and metadata.createdAt for timestamps", () => {
		const chunks = [
			makeChunk({ metadata: { updatedAt: "2025-02-01T00:00:00Z" } }),
			makeChunk({ metadata: { createdAt: "2025-01-01T00:00:00Z" } }),
		];
		const result = extractSegmentMetadata(chunks);
		expect(result.timeRange).toEqual({
			from: "2025-01-01T00:00:00Z",
			to: "2025-02-01T00:00:00Z",
		});
	});

	it("extracts repoIds from metadata.repo", () => {
		const chunks = [
			makeChunk({ sourceType: "code", metadata: { repo: "FilOzone/synapse-sdk" } }),
			makeChunk({ sourceType: "markdown", metadata: { repo: "FilOzone/synapse-sdk" } }),
			makeChunk({ sourceType: "code", metadata: { repo: "FilOzone/pdp" } }),
		];
		const result = extractSegmentMetadata(chunks);
		expect(result.repoIds).toEqual(["FilOzone/pdp", "FilOzone/synapse-sdk"]);
	});

	it("extracts repoIds from github source field", () => {
		const chunks = [
			makeChunk({ sourceType: "github-issue", source: "FilOzone/synapse-sdk#42" }),
			makeChunk({ sourceType: "github-pr", source: "FilOzone/synapse-sdk#100" }),
			makeChunk({ sourceType: "github-issue", source: "FilOzone/pdp#5" }),
		];
		const result = extractSegmentMetadata(chunks);
		expect(result.repoIds).toEqual(["FilOzone/pdp", "FilOzone/synapse-sdk"]);
	});

	it("extracts repoIds from code/markdown source field when no metadata.repo", () => {
		const chunks = [
			makeChunk({ sourceType: "code", source: "owner/repo/src/index.ts", metadata: {} }),
		];
		const result = extractSegmentMetadata(chunks);
		expect(result.repoIds).toEqual(["owner/repo"]);
	});

	it("returns sorted, deduplicated repoIds", () => {
		const chunks = [
			makeChunk({ sourceType: "github-issue", source: "z-org/z-repo#1" }),
			makeChunk({ sourceType: "github-issue", source: "a-org/a-repo#2" }),
			makeChunk({ sourceType: "github-issue", source: "z-org/z-repo#3" }),
		];
		const result = extractSegmentMetadata(chunks);
		expect(result.repoIds).toEqual(["a-org/a-repo", "z-org/z-repo"]);
	});

	it("handles mixed chunks with and without metadata", () => {
		const chunks = [
			makeChunk({
				sourceType: "github-issue",
				source: "FilOzone/synapse-sdk#42",
				timestamp: "2025-03-01T00:00:00Z",
			}),
			makeChunk({
				sourceType: "slack-message",
				source: "#general",
				timestamp: "2025-03-15T00:00:00Z",
			}),
			makeChunk({ sourceType: "code", source: "test.ts", metadata: {} }),
		];
		const result = extractSegmentMetadata(chunks);
		expect(result.timeRange).toEqual({
			from: "2025-03-01T00:00:00Z",
			to: "2025-03-15T00:00:00Z",
		});
		expect(result.repoIds).toEqual(["FilOzone/synapse-sdk"]);
	});
});

describe("storedChunkToSegmentChunk", () => {
	const stored: Segment["chunks"][number] = {
		id: "chunk-1",
		storageId: "chunk-1",
		content: "test content",
		embedding: [0.1, 0.2, 0.3],
		terms: ["test", "content"],
		source: "owner/repo/file.ts",
		sourceType: "code",
		sourceUrl: "https://github.com/owner/repo/blob/main/file.ts",
		timestamp: "2026-04-12T00:00:00Z",
		metadata: { filePath: "file.ts", language: "typescript" },
		signalScores: { pain: 20 },
		documentId: "owner/repo/file.ts",
		documentVersionId: "abc123hash",
		contentFingerprint: "def456hash",
	};

	it("preserves documentId, documentVersionId, contentFingerprint", () => {
		const result = storedChunkToSegmentChunk(stored);
		expect(result.chunk.documentId).toBe("owner/repo/file.ts");
		expect(result.chunk.documentVersionId).toBe("abc123hash");
		expect(result.chunk.contentFingerprint).toBe("def456hash");
	});

	it("preserves embedding, terms, signalScores", () => {
		const result = storedChunkToSegmentChunk(stored);
		expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
		expect(result.terms).toEqual(["test", "content"]);
		expect(result.signalScores).toEqual({ pain: 20 });
	});

	it("preserves all required Chunk fields", () => {
		const result = storedChunkToSegmentChunk(stored);
		expect(result.chunk.id).toBe("chunk-1");
		expect(result.chunk.content).toBe("test content");
		expect(result.chunk.sourceType).toBe("code");
		expect(result.chunk.source).toBe("owner/repo/file.ts");
		expect(result.chunk.sourceUrl).toBe("https://github.com/owner/repo/blob/main/file.ts");
		expect(result.chunk.timestamp).toBe("2026-04-12T00:00:00Z");
		expect(result.chunk.metadata).toEqual({ filePath: "file.ts", language: "typescript" });
	});

	it("handles undefined optional fields gracefully", () => {
		const minimal: Segment["chunks"][number] = {
			...stored,
			documentId: undefined,
			documentVersionId: undefined,
			contentFingerprint: undefined,
			signalScores: undefined,
		};
		const result = storedChunkToSegmentChunk(minimal);
		expect(result.chunk.documentId).toBeUndefined();
		expect(result.chunk.documentVersionId).toBeUndefined();
		expect(result.chunk.contentFingerprint).toBeUndefined();
		expect(result.signalScores).toBeUndefined();
	});
});

describe("buildSegment chunker provenance (#220 Sessions 2-3)", () => {
	it("preserves chunker provenance under _chunker-prefixed keys", () => {
		const chunk = makeChunk({ metadata: { filePath: "src/foo.ts" } }) as Chunk & {
			chunkerName?: string;
			chunkerVersion?: string;
			symbolPath?: string;
		};
		chunk.chunkerName = "ast";
		chunk.chunkerVersion = "1.0.0";
		chunk.symbolPath = "User.greet";
		const segChunk: SegmentChunk = { chunk, embedding: [0.1, 0.2] };
		const segment = buildSegment([segChunk], [], defaultOptions);
		const stored = segment.chunks[0];
		expect(stored?.metadata._chunkerName).toBe("ast");
		expect(stored?.metadata._chunkerVersion).toBe("1.0.0");
		expect(stored?.metadata._chunkerSymbolPath).toBe("User.greet");
		// Original metadata keys remain
		expect(stored?.metadata.filePath).toBe("src/foo.ts");
	});

	it("omits chunker provenance when absent (backwards compatible)", () => {
		const chunk = makeChunk({ metadata: { filePath: "README.md" } });
		const segChunk: SegmentChunk = { chunk, embedding: [0.1] };
		const segment = buildSegment([segChunk], [], defaultOptions);
		const stored = segment.chunks[0];
		expect(stored?.metadata._chunkerName).toBeUndefined();
		expect(stored?.metadata._chunkerSymbolPath).toBeUndefined();
		expect(stored?.metadata.filePath).toBe("README.md");
	});

	it("does not overwrite adapter metadata that happens to share an unprefixed name", () => {
		// An adapter emitting `chunkerName` / `symbolPath` as its own metadata
		// would previously have collided with chunker provenance. With the
		// `_chunker` prefix the two live in disjoint slots.
		const chunk = makeChunk({
			metadata: { chunkerName: "legacy-adapter-value", symbolPath: "adapter-owned" },
		}) as Chunk & { chunkerName?: string; symbolPath?: string };
		chunk.chunkerName = "ast";
		chunk.symbolPath = "User.greet";
		const segChunk: SegmentChunk = { chunk, embedding: [0.1] };
		const segment = buildSegment([segChunk], [], defaultOptions);
		const stored = segment.chunks[0];
		expect(stored?.metadata.chunkerName).toBe("legacy-adapter-value");
		expect(stored?.metadata.symbolPath).toBe("adapter-owned");
		expect(stored?.metadata._chunkerName).toBe("ast");
		expect(stored?.metadata._chunkerSymbolPath).toBe("User.greet");
	});
});
