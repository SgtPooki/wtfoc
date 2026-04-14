import { describe, expect, it } from "vitest";
import type { RawSourceEntry, RawSourceIndex } from "./raw-source-archive.js";
import { findEntriesBySourceKey } from "./raw-source-archive.js";

function makeEntry(overrides: Partial<RawSourceEntry> = {}): RawSourceEntry {
	return {
		documentId: "owner/repo/file.ts",
		documentVersionId: "abc123",
		mediaType: "text/typescript",
		checksum: "deadbeef",
		byteLength: 100,
		fetchedAt: "2026-04-01T00:00:00Z",
		storageId: "store-1",
		sourceType: "github",
		...overrides,
	};
}

function makeIndex(entries: Record<string, RawSourceEntry>): RawSourceIndex {
	return {
		schemaVersion: 1,
		collectionId: "test-collection",
		entries,
	};
}

describe("findEntriesBySourceKey", () => {
	it("returns entries matching the exact sourceKey", () => {
		const index = makeIndex({
			"doc1@v1": makeEntry({ sourceKey: "github:owner/repo" }),
			"doc2@v1": makeEntry({ sourceKey: "github:owner/repo" }),
			"doc3@v1": makeEntry({ sourceKey: "github:other/repo" }),
		});

		const results = findEntriesBySourceKey(index, "github:owner/repo");
		expect(results).toHaveLength(2);
		expect(results.every((e) => e.sourceKey === "github:owner/repo")).toBe(true);
	});

	it("excludes entries without sourceKey field", () => {
		const index = makeIndex({
			"doc1@v1": makeEntry({ sourceKey: "github:owner/repo" }),
			"doc2@v1": makeEntry(), // no sourceKey
		});

		const results = findEntriesBySourceKey(index, "github:owner/repo");
		expect(results).toHaveLength(1);
		expect(results[0]?.sourceKey).toBe("github:owner/repo");
	});

	it("returns empty array when no entries match", () => {
		const index = makeIndex({
			"doc1@v1": makeEntry({ sourceKey: "slack:workspace/channel" }),
		});

		const results = findEntriesBySourceKey(index, "github:owner/repo");
		expect(results).toHaveLength(0);
	});

	it("returns empty array for empty index", () => {
		const index = makeIndex({});
		const results = findEntriesBySourceKey(index, "github:owner/repo");
		expect(results).toHaveLength(0);
	});

	it("does not match by prefix — requires exact equality", () => {
		const index = makeIndex({
			"doc1@v1": makeEntry({ sourceKey: "github:owner/repo-extended" }),
			"doc2@v1": makeEntry({ sourceKey: "github:owner/repo" }),
		});

		const results = findEntriesBySourceKey(index, "github:owner/repo");
		expect(results).toHaveLength(1);
		expect(results[0]?.sourceKey).toBe("github:owner/repo");
	});
});

describe("archiveRawSource persists sourceKey", () => {
	it("stores sourceKey in the archive entry when provided", async () => {
		// This test imports archiveRawSource and verifies sourceKey is persisted
		const { archiveRawSource, createEmptyArchiveIndex } = await import("./raw-source-archive.js");

		const index = createEmptyArchiveIndex("test-coll");
		const storageId = await archiveRawSource(index, "owner/repo/file.ts", "v1", "file content", {
			sourceType: "github",
			sourceKey: "github:owner/repo",
			upload: async () => "stored-id-1",
		});

		expect(storageId).toBe("stored-id-1");
		const entry = index.entries["owner/repo/file.ts@v1"];
		expect(entry).toBeDefined();
		expect(entry?.sourceKey).toBe("github:owner/repo");
	});

	it("omits sourceKey from entry when not provided", async () => {
		const { archiveRawSource, createEmptyArchiveIndex } = await import("./raw-source-archive.js");

		const index = createEmptyArchiveIndex("test-coll");
		await archiveRawSource(index, "owner/repo/file.ts", "v1", "file content", {
			sourceType: "github",
			upload: async () => "stored-id-2",
		});

		const entry = index.entries["owner/repo/file.ts@v1"];
		expect(entry).toBeDefined();
		expect(entry?.sourceKey).toBeUndefined();
	});
});

describe("archiveRawSource persists adapter metadata", () => {
	it("stores metadata in the archive entry when provided", async () => {
		const { archiveRawSource, createEmptyArchiveIndex } = await import("./raw-source-archive.js");

		const index = createEmptyArchiveIndex("test-coll");
		await archiveRawSource(index, "owner/repo#42", "2024-01-01", "# Title\n\nbody", {
			sourceType: "github-issue",
			metadata: {
				number: "42",
				labels: "bug,priority:high",
				author: "alice",
				state: "open",
			},
			upload: async () => "stored-id-3",
		});

		const entry = index.entries["owner/repo#42@2024-01-01"];
		expect(entry).toBeDefined();
		expect(entry?.metadata).toEqual({
			number: "42",
			labels: "bug,priority:high",
			author: "alice",
			state: "open",
		});
	});

	it("omits metadata from entry when not provided", async () => {
		const { archiveRawSource, createEmptyArchiveIndex } = await import("./raw-source-archive.js");

		const index = createEmptyArchiveIndex("test-coll");
		await archiveRawSource(index, "owner/repo/file.ts", "v1", "file content", {
			sourceType: "github",
			upload: async () => "stored-id-4",
		});

		const entry = index.entries["owner/repo/file.ts@v1"];
		expect(entry).toBeDefined();
		expect(entry?.metadata).toBeUndefined();
	});

	it("ignores empty metadata object (treats as absent)", async () => {
		const { archiveRawSource, createEmptyArchiveIndex } = await import("./raw-source-archive.js");

		const index = createEmptyArchiveIndex("test-coll");
		await archiveRawSource(index, "owner/repo/file.ts", "v1", "file content", {
			sourceType: "github",
			metadata: {},
			upload: async () => "stored-id-5",
		});

		const entry = index.entries["owner/repo/file.ts@v1"];
		expect(entry?.metadata).toBeUndefined();
	});
});
