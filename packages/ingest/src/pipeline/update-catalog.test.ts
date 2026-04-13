import type { Chunk, DocumentCatalog } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { handleRenames, updateCatalogFromChunks } from "./update-catalog.js";

function emptyCatalog(): DocumentCatalog {
	return { schemaVersion: 1, collectionId: "test-col", documents: {} };
}

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
	return {
		id: "chunk-1",
		content: "test",
		sourceType: "code",
		source: "owner/repo",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
		documentId: "doc-1",
		documentVersionId: "v1",
		contentFingerprint: "fp1",
		...overrides,
	};
}

describe("updateCatalogFromChunks", () => {
	it("archives tombstone documents", () => {
		const catalog = emptyCatalog();
		// Pre-populate to have something to archive
		catalog.documents["doc-1"] = {
			documentId: "doc-1",
			currentVersionId: "v0",
			previousVersionIds: [],
			chunkIds: ["old-c1"],
			supersededChunkIds: [],
			contentFingerprints: [],
			state: "active",
			mutability: "mutable-state",
			sourceType: "code",
			updatedAt: new Date().toISOString(),
		};
		const pending = new Map<string, Chunk[]>([
			["doc-1", [makeChunk({ sourceType: "tombstone", documentVersionId: "v-del" })]],
		]);
		const result = updateCatalogFromChunks(catalog, pending, new Set());
		expect(catalog.documents["doc-1"]?.state).toBe("archived");
		expect(result.docsSuperseded).toBe(0);
	});

	it("updates mutable document with superseded tracking", () => {
		const catalog = emptyCatalog();
		catalog.documents["doc-1"] = {
			documentId: "doc-1",
			currentVersionId: "v0",
			previousVersionIds: [],
			chunkIds: ["old-c1"],
			supersededChunkIds: [],
			contentFingerprints: ["old-fp"],
			state: "active",
			mutability: "mutable-state",
			sourceType: "code",
			updatedAt: new Date().toISOString(),
		};
		const pending = new Map<string, Chunk[]>([
			[
				"doc-1",
				[makeChunk({ id: "new-c1", documentVersionId: "v1", contentFingerprint: "new-fp" })],
			],
		]);
		const result = updateCatalogFromChunks(catalog, pending, new Set());
		expect(result.docsSuperseded).toBe(1);
		expect(catalog.documents["doc-1"]?.currentVersionId).toBe("v1");
		expect(catalog.documents["doc-1"]?.supersededChunkIds).toContain("old-c1");
	});

	it("appends chunks for append-only source types", () => {
		const catalog = emptyCatalog();
		catalog.documents["doc-1"] = {
			documentId: "doc-1",
			currentVersionId: "v0",
			previousVersionIds: [],
			chunkIds: ["c0"],
			supersededChunkIds: [],
			contentFingerprints: ["fp0"],
			state: "active",
			mutability: "append-only",
			sourceType: "hn-story",
			updatedAt: new Date().toISOString(),
		};
		const pending = new Map<string, Chunk[]>([
			[
				"doc-1",
				[
					makeChunk({
						id: "c1",
						sourceType: "hn-story",
						documentVersionId: "v1",
						contentFingerprint: "fp1",
					}),
				],
			],
		]);
		const result = updateCatalogFromChunks(catalog, pending, new Set(["hn-story", "hn-comment"]));
		expect(result.docsSuperseded).toBe(0);
		expect(catalog.documents["doc-1"]?.chunkIds).toContain("c0");
		expect(catalog.documents["doc-1"]?.chunkIds).toContain("c1");
	});
});

describe("handleRenames", () => {
	it("archives old documentId for renamed files", () => {
		const catalog = emptyCatalog();
		catalog.documents["owner/repo/old.ts"] = {
			documentId: "owner/repo/old.ts",
			currentVersionId: "v0",
			previousVersionIds: [],
			chunkIds: ["c1"],
			supersededChunkIds: [],
			contentFingerprints: [],
			state: "active",
			mutability: "mutable-state",
			sourceType: "code",
			updatedAt: new Date().toISOString(),
		};
		const renames = [{ oldPath: "old.ts", newPath: "new.ts" }];
		const count = handleRenames(catalog, renames, "owner/repo");
		expect(count).toBe(1);
		expect(catalog.documents["owner/repo/old.ts"]?.state).toBe("archived");
	});

	it("returns 0 for empty renames", () => {
		const catalog = emptyCatalog();
		expect(handleRenames(catalog, [], "owner/repo")).toBe(0);
	});

	it("handles renames for non-existent documents gracefully", () => {
		const catalog = emptyCatalog();
		const renames = [{ oldPath: "missing.ts", newPath: "new.ts" }];
		const count = handleRenames(catalog, renames, "owner/repo");
		expect(count).toBe(0);
	});
});
