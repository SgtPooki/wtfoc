import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawSourceEntry, RawSourceIndex } from "./raw-source-archive.js";
import { scanForReusableSources, validateDonorEntry } from "./source-scanner.js";

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
		sourceKey: "github:owner/repo",
		...overrides,
	};
}

function makeIndex(collectionId: string, entries: Record<string, RawSourceEntry>): RawSourceIndex {
	return { schemaVersion: 1, collectionId, entries };
}

describe("validateDonorEntry", () => {
	it("returns true for a valid entry with all required fields", () => {
		expect(validateDonorEntry(makeEntry())).toBe(true);
	});

	it("returns false when storageId is missing", () => {
		const entry = makeEntry({ storageId: "" });
		expect(validateDonorEntry(entry)).toBe(false);
	});

	it("returns false when sourceKey is undefined", () => {
		const entry = makeEntry({ sourceKey: undefined });
		expect(validateDonorEntry(entry)).toBe(false);
	});

	it("returns false when documentId is empty", () => {
		const entry = makeEntry({ documentId: "" });
		expect(validateDonorEntry(entry)).toBe(false);
	});

	it("returns false when documentVersionId is empty", () => {
		const entry = makeEntry({ documentVersionId: "" });
		expect(validateDonorEntry(entry)).toBe(false);
	});
});

describe("scanForReusableSources", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(tmpdir(), `scanner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	async function writeArchive(collectionName: string, index: RawSourceIndex): Promise<void> {
		await writeFile(
			join(testDir, `${collectionName}.raw-source-index.json`),
			JSON.stringify(index, null, 2),
		);
	}

	it("returns matches from donor collections with matching sourceKey", async () => {
		await writeArchive(
			"coll-a",
			makeIndex("a", {
				"doc1@v1": makeEntry({ sourceKey: "github:owner/repo" }),
				"doc2@v1": makeEntry({ sourceKey: "github:owner/repo", documentId: "owner/repo/other.ts" }),
			}),
		);
		await writeArchive(
			"coll-b",
			makeIndex("b", {
				"doc3@v1": makeEntry({ sourceKey: "github:owner/repo", documentId: "owner/repo/third.ts" }),
			}),
		);

		const result = await scanForReusableSources(
			testDir,
			"github:owner/repo",
			"my-collection",
			async () => ["coll-a", "coll-b", "my-collection"],
		);

		expect(result.matches).toHaveLength(2);
		expect(result.matches[0]?.collectionName).toBe("coll-a");
		expect(result.matches[0]?.archiveEntries).toHaveLength(2);
		expect(result.matches[1]?.collectionName).toBe("coll-b");
		expect(result.matches[1]?.archiveEntries).toHaveLength(1);
	});

	it("excludes self from matches", async () => {
		await writeArchive(
			"my-collection",
			makeIndex("self", {
				"doc1@v1": makeEntry({ sourceKey: "github:owner/repo" }),
			}),
		);

		const result = await scanForReusableSources(
			testDir,
			"github:owner/repo",
			"my-collection",
			async () => ["my-collection"],
		);

		expect(result.matches).toHaveLength(0);
	});

	it("skips collections with no archive file", async () => {
		// coll-a has no archive file on disk
		const result = await scanForReusableSources(
			testDir,
			"github:owner/repo",
			"my-collection",
			async () => ["coll-a"],
		);

		expect(result.matches).toHaveLength(0);
	});

	it("skips collections with corrupted archive", async () => {
		await writeFile(join(testDir, "coll-a.raw-source-index.json"), "not valid json");

		const result = await scanForReusableSources(
			testDir,
			"github:owner/repo",
			"my-collection",
			async () => ["coll-a"],
		);

		expect(result.matches).toHaveLength(0);
	});

	it("filters out invalid donor entries", async () => {
		await writeArchive(
			"coll-a",
			makeIndex("a", {
				"doc1@v1": makeEntry({ sourceKey: "github:owner/repo", storageId: "" }), // invalid
				"doc2@v1": makeEntry({ sourceKey: "github:owner/repo" }), // valid
			}),
		);

		const result = await scanForReusableSources(
			testDir,
			"github:owner/repo",
			"my-collection",
			async () => ["coll-a"],
		);

		expect(result.matches).toHaveLength(1);
		expect(result.matches[0]?.archiveEntries).toHaveLength(1);
	});

	it("uses cache to avoid re-reading archives", async () => {
		await writeArchive(
			"coll-a",
			makeIndex("a", {
				"doc1@v1": makeEntry({ sourceKey: "github:owner/repo" }),
			}),
		);

		const cache = new Map<string, RawSourceIndex | null>();
		const listProjects = async () => ["coll-a"];

		// First scan populates cache
		await scanForReusableSources(
			testDir,
			"github:owner/repo",
			"my-collection",
			listProjects,
			cache,
		);
		expect(cache.has("coll-a")).toBe(true);

		// Delete file — second scan should still work from cache
		await rm(join(testDir, "coll-a.raw-source-index.json"));

		const result = await scanForReusableSources(
			testDir,
			"github:owner/repo",
			"my-collection",
			listProjects,
			cache,
		);
		expect(result.matches).toHaveLength(1);
	});

	it("returns empty matches when no collections have the sourceKey", async () => {
		await writeArchive(
			"coll-a",
			makeIndex("a", {
				"doc1@v1": makeEntry({ sourceKey: "slack:workspace/channel" }),
			}),
		);

		const result = await scanForReusableSources(
			testDir,
			"github:owner/repo",
			"my-collection",
			async () => ["coll-a"],
		);

		expect(result.matches).toHaveLength(0);
	});
});
