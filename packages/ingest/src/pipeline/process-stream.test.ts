import type { Chunk } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { createEmptyArchiveIndex } from "../raw-source-archive.js";
import { processStream, shouldIncludeChunk } from "./process-stream.js";
import type { DocumentFilters, PipelineState } from "./types.js";

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
	return {
		id: "chunk-1",
		content: "test content",
		sourceType: "code",
		source: "owner/repo",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
		...overrides,
	};
}

function makeState(): PipelineState {
	return {
		knownFingerprints: new Set(),
		knownChunkIds: new Set(),
		archiveIndex: createEmptyArchiveIndex("test-col"),
		catalog: { schemaVersion: 1, collectionId: "test-col", documents: {} },
		catalogPendingChunks: new Map(),
		batch: [],
		batchNumber: 0,
		stats: {
			chunksIngested: 0,
			chunksSkipped: 0,
			chunksFiltered: 0,
			docsSuperseded: 0,
			archivedCount: 0,
			rechunkedCount: 0,
			reusedFromDonors: 0,
			donorCollectionNames: [],
			batchesWritten: 0,
		},
		maxTimestamp: "",
	};
}

// ── shouldIncludeChunk tests ──────────────────────────────────────────────────

describe("shouldIncludeChunk", () => {
	it("returns true when all filters are null", () => {
		const filters: DocumentFilters = { documentIds: null, sourcePaths: null, changedSinceMs: null };
		expect(shouldIncludeChunk(makeChunk(), filters)).toBe(true);
	});

	it("returns false when documentId not in filter set", () => {
		const filters: DocumentFilters = {
			documentIds: new Set(["xyz"]),
			sourcePaths: null,
			changedSinceMs: null,
		};
		expect(shouldIncludeChunk(makeChunk({ documentId: "abc" }), filters)).toBe(false);
	});

	it("returns true when documentId is in filter set", () => {
		const filters: DocumentFilters = {
			documentIds: new Set(["abc"]),
			sourcePaths: null,
			changedSinceMs: null,
		};
		expect(shouldIncludeChunk(makeChunk({ documentId: "abc" }), filters)).toBe(true);
	});

	it("returns true when sourcePaths prefix matches", () => {
		const filters: DocumentFilters = {
			documentIds: null,
			sourcePaths: ["src"],
			changedSinceMs: null,
		};
		const chunk = makeChunk({ metadata: { filePath: "src/foo.ts" } });
		expect(shouldIncludeChunk(chunk, filters)).toBe(true);
	});

	it("returns true when sourcePaths is an exact match", () => {
		const filters: DocumentFilters = {
			documentIds: null,
			sourcePaths: ["src/foo.ts"],
			changedSinceMs: null,
		};
		const chunk = makeChunk({ metadata: { filePath: "src/foo.ts" } });
		expect(shouldIncludeChunk(chunk, filters)).toBe(true);
	});

	it("returns false when sourcePaths does not match", () => {
		const filters: DocumentFilters = {
			documentIds: null,
			sourcePaths: ["src"],
			changedSinceMs: null,
		};
		const chunk = makeChunk({ metadata: { filePath: "lib/bar.ts" } });
		expect(shouldIncludeChunk(chunk, filters)).toBe(false);
	});

	it("returns false when chunk has no filePath and sourcePaths is set", () => {
		const filters: DocumentFilters = {
			documentIds: null,
			sourcePaths: ["src"],
			changedSinceMs: null,
		};
		expect(shouldIncludeChunk(makeChunk(), filters)).toBe(false);
	});

	it("returns false when chunk timestamp is older than changedSince", () => {
		const filters: DocumentFilters = {
			documentIds: null,
			sourcePaths: null,
			changedSinceMs: new Date("2026-06-01").getTime(),
		};
		const chunk = makeChunk({ timestamp: "2026-01-01T00:00:00Z" });
		expect(shouldIncludeChunk(chunk, filters)).toBe(false);
	});

	it("returns true when chunk timestamp is newer than changedSince", () => {
		const filters: DocumentFilters = {
			documentIds: null,
			sourcePaths: null,
			changedSinceMs: new Date("2026-01-01").getTime(),
		};
		const chunk = makeChunk({ timestamp: "2026-06-01T00:00:00Z" });
		expect(shouldIncludeChunk(chunk, filters)).toBe(true);
	});

	it("returns false when no timestamp is available and changedSince is set", () => {
		const filters: DocumentFilters = {
			documentIds: null,
			sourcePaths: null,
			changedSinceMs: new Date("2026-01-01").getTime(),
		};
		expect(shouldIncludeChunk(makeChunk(), filters)).toBe(false);
	});
});

// ── processStream tests ───────────────────────────────────────────────────────

describe("processStream", () => {
	it("filters, deduplicates, and batches chunks from adapter", async () => {
		const state = makeState();
		state.knownFingerprints.add("dup-fp");
		state.knownChunkIds.add("dup-id");

		async function* fakeAdapter() {
			yield makeChunk({
				id: "c1",
				contentFingerprint: "fp1",
				documentId: "d1",
				documentVersionId: "v1",
			});
			yield makeChunk({
				id: "dup-id",
				contentFingerprint: "fp2",
				documentId: "d2",
				documentVersionId: "v2",
			}); // dedup by id
			yield makeChunk({
				id: "c3",
				contentFingerprint: "dup-fp",
				documentId: "d3",
				documentVersionId: "v3",
			}); // dedup by fingerprint
			yield makeChunk({
				id: "c4",
				contentFingerprint: "fp4",
				documentId: "d4",
				documentVersionId: "v4",
			});
			yield makeChunk({
				id: "c5",
				contentFingerprint: "fp5",
				documentId: "filtered-doc",
				documentVersionId: "v5",
			}); // filtered
		}

		const filters: DocumentFilters = {
			documentIds: new Set(["d1", "d2", "d3", "d4"]),
			sourcePaths: null,
			changedSinceMs: null,
		};

		const flushBatch = vi.fn();
		await processStream({
			state,
			adapterStream: fakeAdapter(),
			filters,
			maxBatch: 10,
			maxChunkChars: 10000,
			flushBatch,
			archiveRawSource: vi.fn(),
			isArchived: vi.fn().mockReturnValue(false),
			uploadData: vi.fn().mockResolvedValue("id"),
			sourceKey: "repo:owner/repo",
			log: vi.fn(),
		});

		// Should have flushed remaining batch
		expect(flushBatch).toHaveBeenCalled();
		// 2 new chunks (c1, c4), 2 skipped (dup-id, dup-fp), 1 filtered
		expect(state.stats.chunksSkipped).toBe(2);
		expect(state.stats.chunksFiltered).toBe(1);
		// c1 and c4 should be in the batch passed to flushBatch
		const flushedChunks = flushBatch.mock.calls[0]?.[0] as Chunk[];
		expect(flushedChunks).toHaveLength(2);
	});

	it("flushes when batch reaches maxBatch", async () => {
		const state = makeState();

		async function* fakeAdapter() {
			for (let i = 0; i < 4; i++) {
				yield makeChunk({
					id: `c${i}`,
					contentFingerprint: `fp${i}`,
					documentId: `d${i}`,
					documentVersionId: `v${i}`,
				});
			}
		}

		const flushBatch = vi.fn();
		await processStream({
			state,
			adapterStream: fakeAdapter(),
			filters: { documentIds: null, sourcePaths: null, changedSinceMs: null },
			maxBatch: 2,
			maxChunkChars: 10000,
			flushBatch,
			archiveRawSource: vi.fn(),
			isArchived: vi.fn().mockReturnValue(false),
			uploadData: vi.fn().mockResolvedValue("id"),
			sourceKey: "repo:owner/repo",
			log: vi.fn(),
		});

		// Should flush three times: 2 + 2 + final empty flush
		expect(flushBatch).toHaveBeenCalledTimes(3);
		expect((flushBatch.mock.calls[0]?.[0] as Chunk[]).length).toBe(2);
		expect((flushBatch.mock.calls[1]?.[0] as Chunk[]).length).toBe(2);
		expect((flushBatch.mock.calls[2]?.[0] as Chunk[]).length).toBe(0);
	});

	it("archives raw content and strips rawContent before batching", async () => {
		const state = makeState();
		const archiveFn = vi.fn();

		async function* fakeAdapter() {
			yield makeChunk({
				id: "c1",
				contentFingerprint: "fp1",
				documentId: "d1",
				documentVersionId: "v1",
				rawContent: "full source",
			});
		}

		const flushBatch = vi.fn();
		await processStream({
			state,
			adapterStream: fakeAdapter(),
			filters: { documentIds: null, sourcePaths: null, changedSinceMs: null },
			maxBatch: 10,
			maxChunkChars: 10000,
			flushBatch,
			archiveRawSource: archiveFn,
			isArchived: vi.fn().mockReturnValue(false),
			uploadData: vi.fn().mockResolvedValue("id"),
			sourceKey: "repo:owner/repo",
			log: vi.fn(),
		});

		expect(archiveFn).toHaveBeenCalled();
		// rawContent should be stripped from batch
		const flushedChunks = flushBatch.mock.calls[0]?.[0] as Chunk[];
		expect(flushedChunks[0]?.rawContent).toBeUndefined();
	});

	it("writes archive index on zero-chunk adapter with donor pre-cached archives", async () => {
		const state = makeState();
		state.stats.archivedCount = 5; // donor pre-cached

		async function* emptyAdapter(): AsyncIterable<Chunk> {
			// yields nothing
		}

		const flushBatch = vi.fn();
		await processStream({
			state,
			adapterStream: emptyAdapter(),
			filters: { documentIds: null, sourcePaths: null, changedSinceMs: null },
			maxBatch: 10,
			maxChunkChars: 10000,
			flushBatch,
			archiveRawSource: vi.fn(),
			isArchived: vi.fn().mockReturnValue(false),
			uploadData: vi.fn().mockResolvedValue("id"),
			sourceKey: "repo:owner/repo",
			log: vi.fn(),
		});

		// Final flush should be called with empty batch
		expect(flushBatch).toHaveBeenCalledWith([]);
	});
});
