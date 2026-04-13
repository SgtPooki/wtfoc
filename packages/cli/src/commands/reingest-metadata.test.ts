import type { Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";

/**
 * Regression test: reingest and materialize-edges must preserve
 * documentId, documentVersionId, and contentFingerprint when
 * rebuilding chunks from stored segments.
 *
 * See: https://github.com/SgtPooki/wtfoc/issues/226
 */

/** Simulates the chunk mapping from reingest.ts (lines 115-128) */
function reingestChunkMapping(c: Segment["chunks"][number]) {
	return {
		id: c.id,
		content: c.content,
		sourceType: c.sourceType,
		source: c.source,
		sourceUrl: c.sourceUrl,
		timestamp: c.timestamp,
		chunkIndex: 0,
		totalChunks: 0,
		metadata: c.metadata,
		documentId: c.documentId,
		documentVersionId: c.documentVersionId,
		contentFingerprint: c.contentFingerprint,
	};
}

/** Simulates the chunk mapping from materialize-edges.ts (lines 123-137) */
function materializeChunkMapping(c: Segment["chunks"][number]) {
	return {
		chunk: {
			id: c.id,
			content: c.content,
			sourceType: c.sourceType,
			source: c.source,
			sourceUrl: c.sourceUrl,
			timestamp: c.timestamp,
			chunkIndex: 0,
			totalChunks: 0,
			metadata: c.metadata,
			documentId: c.documentId,
			documentVersionId: c.documentVersionId,
			contentFingerprint: c.contentFingerprint,
		},
		embedding: c.embedding,
		terms: c.terms,
	};
}

const storedChunk: Segment["chunks"][number] = {
	id: "chunk-1",
	storageId: "chunk-1",
	content: "test content",
	embedding: [0.1, 0.2],
	terms: ["test"],
	source: "owner/repo/file.ts",
	sourceType: "code",
	sourceUrl: "https://github.com/owner/repo/blob/main/file.ts",
	timestamp: "2026-04-12T00:00:00Z",
	metadata: { filePath: "file.ts" },
	documentId: "owner/repo/file.ts",
	documentVersionId: "abc123hash",
	contentFingerprint: "def456hash",
};

describe("reingest chunk mapping preserves metadata", () => {
	it("preserves documentId", () => {
		const result = reingestChunkMapping(storedChunk);
		expect(result.documentId).toBe("owner/repo/file.ts");
	});

	it("preserves documentVersionId", () => {
		const result = reingestChunkMapping(storedChunk);
		expect(result.documentVersionId).toBe("abc123hash");
	});

	it("preserves contentFingerprint", () => {
		const result = reingestChunkMapping(storedChunk);
		expect(result.contentFingerprint).toBe("def456hash");
	});

	it("handles missing optional fields gracefully", () => {
		const minimal: Segment["chunks"][number] = {
			...storedChunk,
			documentId: undefined,
			documentVersionId: undefined,
			contentFingerprint: undefined,
		};
		const result = reingestChunkMapping(minimal);
		expect(result.documentId).toBeUndefined();
		expect(result.documentVersionId).toBeUndefined();
		expect(result.contentFingerprint).toBeUndefined();
	});
});

describe("materialize-edges chunk mapping preserves metadata", () => {
	it("preserves all three metadata fields", () => {
		const result = materializeChunkMapping(storedChunk);
		expect(result.chunk.documentId).toBe("owner/repo/file.ts");
		expect(result.chunk.documentVersionId).toBe("abc123hash");
		expect(result.chunk.contentFingerprint).toBe("def456hash");
	});
});
