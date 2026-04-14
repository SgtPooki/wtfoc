import { describe, expect, it, vi } from "vitest";
import type { RawSourceEntry } from "./raw-source-archive.js";
import { replayFromArchive } from "./source-replay.js";

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

describe("replayFromArchive", () => {
	it("yields chunks with correct metadata from archived entries", async () => {
		const content = "const x = 1;";
		const storage = {
			upload: vi.fn(),
			download: vi.fn().mockResolvedValue(new TextEncoder().encode(content)),
		};

		const entries = [
			makeEntry({
				documentId: "owner/repo/file.ts",
				documentVersionId: "v1",
				sourceType: "github-file",
				sourceUrl: "https://github.com/owner/repo/blob/main/file.ts",
				storageId: "blob-1",
			}),
		];

		const chunks = [];
		for await (const chunk of replayFromArchive(entries, storage)) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.content).toBe(content);
		expect(chunks[0]?.documentId).toBe("owner/repo/file.ts");
		expect(chunks[0]?.documentVersionId).toBe("v1");
		expect(chunks[0]?.sourceType).toBe("github-file");
		expect(chunks[0]?.sourceUrl).toBe("https://github.com/owner/repo/blob/main/file.ts");
		expect(chunks[0]?.rawContent).toBe(content);
		expect(storage.download).toHaveBeenCalledWith("blob-1");
	});

	it("yields multiple chunks from multiple entries", async () => {
		const storage = {
			upload: vi.fn(),
			download: vi.fn().mockImplementation(async (id: string) => {
				return new TextEncoder().encode(`content-${id}`);
			}),
		};

		const entries = [
			makeEntry({ storageId: "blob-1", documentId: "file1.ts" }),
			makeEntry({ storageId: "blob-2", documentId: "file2.ts" }),
			makeEntry({ storageId: "blob-3", documentId: "file3.ts" }),
		];

		const chunks = [];
		for await (const chunk of replayFromArchive(entries, storage)) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(3);
		expect(chunks[0]?.content).toBe("content-blob-1");
		expect(chunks[1]?.content).toBe("content-blob-2");
		expect(chunks[2]?.content).toBe("content-blob-3");
	});

	it("skips entries with failed downloads and continues", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const storage = {
			upload: vi.fn(),
			download: vi.fn().mockImplementation(async (id: string) => {
				if (id === "blob-bad") throw new Error("blob not found");
				return new TextEncoder().encode(`content-${id}`);
			}),
		};

		const entries = [
			makeEntry({ storageId: "blob-1", documentId: "file1.ts" }),
			makeEntry({ storageId: "blob-bad", documentId: "file2.ts" }),
			makeEntry({ storageId: "blob-3", documentId: "file3.ts" }),
		];

		const chunks = [];
		for await (const chunk of replayFromArchive(entries, storage)) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.content).toBe("content-blob-1");
		expect(chunks[1]?.content).toBe("content-blob-3");
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("blob not found"));
		warnSpy.mockRestore();
	});

	it("yields nothing for empty entries array", async () => {
		const storage = {
			upload: vi.fn(),
			download: vi.fn(),
		};

		const chunks = [];
		for await (const chunk of replayFromArchive([], storage)) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(0);
		expect(storage.download).not.toHaveBeenCalled();
	});
});

describe("replayRawDocuments", () => {
	it("yields { entry, content } pairs preserving full entry metadata", async () => {
		const { replayRawDocuments } = await import("./source-replay.js");
		const content = "# Title\n\nbody";
		const storage = {
			upload: vi.fn(),
			download: vi.fn().mockResolvedValue(new TextEncoder().encode(content)),
		};

		const entries = [
			makeEntry({
				storageId: "blob-1",
				documentId: "owner/repo#42",
				documentVersionId: "2024-01-01",
				sourceType: "github-issue",
				sourceUrl: "https://github.com/owner/repo/issues/42",
				metadata: { number: "42", labels: "bug", author: "alice" },
			}),
		];

		const docs = [];
		for await (const doc of replayRawDocuments(entries, storage)) {
			docs.push(doc);
		}

		expect(docs).toHaveLength(1);
		expect(docs[0]?.entry.documentId).toBe("owner/repo#42");
		expect(docs[0]?.entry.metadata).toEqual({
			number: "42",
			labels: "bug",
			author: "alice",
		});
		expect(docs[0]?.content).toBe(content);
	});

	it("skips failed downloads and continues yielding others", async () => {
		const { replayRawDocuments } = await import("./source-replay.js");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const storage = {
			upload: vi.fn(),
			download: vi.fn().mockImplementation(async (id: string) => {
				if (id === "blob-bad") throw new Error("blob not found");
				return new TextEncoder().encode(`content-${id}`);
			}),
		};

		const entries = [
			makeEntry({ storageId: "blob-1", documentId: "a" }),
			makeEntry({ storageId: "blob-bad", documentId: "b" }),
			makeEntry({ storageId: "blob-2", documentId: "c" }),
		];

		const docs = [];
		for await (const doc of replayRawDocuments(entries, storage)) {
			docs.push(doc);
		}

		expect(docs).toHaveLength(2);
		expect(docs.map((d) => d.entry.documentId)).toEqual(["a", "c"]);
		warnSpy.mockRestore();
	});
});
