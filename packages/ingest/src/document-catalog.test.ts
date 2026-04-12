import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentCatalog } from "@wtfoc/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	archiveDocument,
	catalogFilePath,
	createEmptyCatalog,
	getActiveChunkIds,
	getChunkIdsByState,
	getDocument,
	readCatalog,
	renameDocument,
	updateDocument,
	writeCatalog,
} from "./document-catalog.js";

describe("document-catalog", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "wtfoc-catalog-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("createEmptyCatalog", () => {
		it("creates a catalog with correct structure", () => {
			const catalog = createEmptyCatalog("test-collection-id");
			expect(catalog.schemaVersion).toBe(1);
			expect(catalog.collectionId).toBe("test-collection-id");
			expect(catalog.documents).toEqual({});
		});
	});

	describe("read/write roundtrip", () => {
		it("writes and reads back a catalog", async () => {
			const path = catalogFilePath(tmpDir, "my-collection");
			const catalog = createEmptyCatalog("coll-1");
			catalog.documents.doc1 = {
				documentId: "doc1",
				currentVersionId: "v1",
				previousVersionIds: [],
				chunkIds: ["c1", "c2"],
				state: "active",
				mutability: "mutable-state",
				sourceType: "code",
				updatedAt: "2026-04-12T00:00:00Z",
			};

			await writeCatalog(path, catalog);
			const loaded = await readCatalog(path);

			expect(loaded).not.toBeNull();
			expect(loaded?.collectionId).toBe("coll-1");
			expect(loaded?.documents.doc1?.chunkIds).toEqual(["c1", "c2"]);
		});

		it("returns null for non-existent file", async () => {
			const path = catalogFilePath(tmpDir, "nonexistent");
			const loaded = await readCatalog(path);
			expect(loaded).toBeNull();
		});
	});

	describe("updateDocument", () => {
		let catalog: DocumentCatalog;

		beforeEach(() => {
			catalog = createEmptyCatalog("coll-1");
		});

		it("creates a new document entry", () => {
			const result = updateDocument(catalog, {
				documentId: "repo/file.ts",
				versionId: "abc123",
				chunkIds: ["c1", "c2"],
				sourceType: "code",
				mutability: "mutable-state",
			});

			expect(result.supersededChunkIds).toEqual([]);
			expect(result.previousVersionId).toBeNull();
			expect(catalog.documents["repo/file.ts"]).toBeDefined();
			expect(catalog.documents["repo/file.ts"]?.state).toBe("active");
			expect(catalog.documents["repo/file.ts"]?.chunkIds).toEqual(["c1", "c2"]);
		});

		it("supersedes previous version for mutable-state documents", () => {
			updateDocument(catalog, {
				documentId: "repo/file.ts",
				versionId: "v1",
				chunkIds: ["c1", "c2"],
				sourceType: "code",
				mutability: "mutable-state",
			});

			const result = updateDocument(catalog, {
				documentId: "repo/file.ts",
				versionId: "v2",
				chunkIds: ["c3", "c4"],
				sourceType: "code",
				mutability: "mutable-state",
			});

			expect(result.supersededChunkIds).toEqual(["c1", "c2"]);
			expect(result.previousVersionId).toBe("v1");
			const doc = catalog.documents["repo/file.ts"];
			expect(doc?.currentVersionId).toBe("v2");
			expect(doc?.chunkIds).toEqual(["c3", "c4"]);
			expect(doc?.previousVersionIds).toEqual(["v1"]);
		});

		it("does not supersede for same version", () => {
			updateDocument(catalog, {
				documentId: "repo/file.ts",
				versionId: "v1",
				chunkIds: ["c1"],
				sourceType: "code",
				mutability: "mutable-state",
			});

			const result = updateDocument(catalog, {
				documentId: "repo/file.ts",
				versionId: "v1",
				chunkIds: ["c1"],
				sourceType: "code",
				mutability: "mutable-state",
			});

			expect(result.supersededChunkIds).toEqual([]);
			expect(result.previousVersionId).toBeNull();
		});

		it("appends chunks for append-only documents", () => {
			updateDocument(catalog, {
				documentId: "channel:123",
				versionId: "ts1",
				chunkIds: ["c1"],
				sourceType: "slack-message",
				mutability: "append-only",
			});

			const result = updateDocument(catalog, {
				documentId: "channel:123",
				versionId: "ts2",
				chunkIds: ["c2"],
				sourceType: "slack-message",
				mutability: "append-only",
			});

			expect(result.supersededChunkIds).toEqual([]);
			const doc = catalog.documents["channel:123"];
			expect(doc?.chunkIds).toEqual(["c1", "c2"]);
		});
	});

	describe("archiveDocument", () => {
		it("archives a document and returns its chunk IDs", () => {
			const catalog = createEmptyCatalog("coll-1");
			updateDocument(catalog, {
				documentId: "repo/deleted.ts",
				versionId: "v1",
				chunkIds: ["c1", "c2"],
				sourceType: "code",
				mutability: "mutable-state",
			});

			const result = archiveDocument(catalog, "repo/deleted.ts");
			expect(result.archivedChunkIds).toEqual(["c1", "c2"]);
			expect(catalog.documents["repo/deleted.ts"]?.state).toBe("archived");
		});

		it("returns empty for non-existent document", () => {
			const catalog = createEmptyCatalog("coll-1");
			const result = archiveDocument(catalog, "nonexistent");
			expect(result.archivedChunkIds).toEqual([]);
		});
	});

	describe("renameDocument", () => {
		it("archives old document on rename", () => {
			const catalog = createEmptyCatalog("coll-1");
			updateDocument(catalog, {
				documentId: "repo/old.ts",
				versionId: "v1",
				chunkIds: ["c1"],
				sourceType: "code",
				mutability: "mutable-state",
			});

			renameDocument(catalog, "repo/old.ts");
			expect(catalog.documents["repo/old.ts"]?.state).toBe("archived");
		});
	});

	describe("getActiveChunkIds", () => {
		it("returns only active chunk IDs", () => {
			const catalog = createEmptyCatalog("coll-1");
			updateDocument(catalog, {
				documentId: "doc1",
				versionId: "v1",
				chunkIds: ["c1", "c2"],
				sourceType: "code",
				mutability: "mutable-state",
			});
			updateDocument(catalog, {
				documentId: "doc2",
				versionId: "v1",
				chunkIds: ["c3"],
				sourceType: "code",
				mutability: "mutable-state",
			});
			archiveDocument(catalog, "doc2");

			const activeIds = getActiveChunkIds(catalog);
			expect(activeIds.has("c1")).toBe(true);
			expect(activeIds.has("c2")).toBe(true);
			expect(activeIds.has("c3")).toBe(false);
		});
	});

	describe("getChunkIdsByState", () => {
		it("returns chunk IDs for archived documents", () => {
			const catalog = createEmptyCatalog("coll-1");
			updateDocument(catalog, {
				documentId: "doc1",
				versionId: "v1",
				chunkIds: ["c1"],
				sourceType: "code",
				mutability: "mutable-state",
			});
			archiveDocument(catalog, "doc1");

			const archivedIds = getChunkIdsByState(catalog, "archived");
			expect(archivedIds.has("c1")).toBe(true);
		});
	});

	describe("getDocument", () => {
		it("returns the document entry", () => {
			const catalog = createEmptyCatalog("coll-1");
			updateDocument(catalog, {
				documentId: "repo/file.ts",
				versionId: "v1",
				chunkIds: ["c1"],
				sourceType: "code",
				mutability: "mutable-state",
			});

			const doc = getDocument(catalog, "repo/file.ts");
			expect(doc?.documentId).toBe("repo/file.ts");
			expect(doc?.currentVersionId).toBe("v1");
		});

		it("returns undefined for missing document", () => {
			const catalog = createEmptyCatalog("coll-1");
			expect(getDocument(catalog, "missing")).toBeUndefined();
		});
	});

	describe("catalogFilePath", () => {
		it("generates the expected path", () => {
			const path = catalogFilePath("/data/manifests", "my-collection");
			expect(path).toBe("/data/manifests/my-collection.document-catalog.json");
		});
	});
});
