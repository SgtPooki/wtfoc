import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectionHead } from "@wtfoc/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalManifestStore, validateCollectionName } from "./local.js";

function makeManifest(overrides?: Partial<CollectionHead>): CollectionHead {
	return {
		schemaVersion: 1,
		collectionId: "test-collection-id",
		name: "test",
		currentRevisionId: null,
		prevHeadId: null,
		segments: [],
		totalChunks: 0,
		embeddingModel: "test-model",
		embeddingDimensions: 384,
		createdAt: "2026-03-23T00:00:00Z",
		updatedAt: "2026-03-23T00:00:00Z",
		...overrides,
	};
}

describe("LocalManifestStore", () => {
	let manifestDir: string;
	let store: LocalManifestStore;

	beforeAll(async () => {
		manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-manifest-test-"));
		store = new LocalManifestStore(manifestDir);
	});

	afterAll(async () => {
		await rm(manifestDir, { recursive: true, force: true });
	});

	describe("getHead", () => {
		it("returns null for non-existent project", async () => {
			const result = await store.getHead("nonexistent");
			expect(result).toBeNull();
		});
	});

	describe("putHead", () => {
		it("creates a new head when prevHeadId is null and no head exists", async () => {
			const manifest = makeManifest({ name: "new-project" });
			const result = await store.putHead("new-project", manifest, null);

			expect(result.headId).toBeTruthy();
			expect(result.manifest).toEqual(manifest);
		});

		it("returns the stored head on subsequent getHead", async () => {
			const manifest = makeManifest({ name: "get-test" });
			const putResult = await store.putHead("get-test", manifest, null);
			const getResult = await store.getHead("get-test");

			expect(getResult).not.toBeNull();
			expect(getResult?.headId).toBe(putResult.headId);
			expect(getResult?.manifest).toEqual(manifest);
		});

		it("succeeds when prevHeadId matches current head", async () => {
			const manifest1 = makeManifest({ name: "chain-test", totalChunks: 0 });
			const first = await store.putHead("chain-test", manifest1, null);

			const manifest2 = makeManifest({
				name: "chain-test",
				totalChunks: 10,
				prevHeadId: first.headId,
			});
			const second = await store.putHead("chain-test", manifest2, first.headId);

			expect(second.headId).not.toBe(first.headId);
			expect(second.manifest.totalChunks).toBe(10);
		});

		it("throws ManifestConflictError when prevHeadId is stale", async () => {
			const manifest = makeManifest({ name: "conflict-test" });
			await store.putHead("conflict-test", manifest, null);

			await expect(store.putHead("conflict-test", manifest, "stale-id")).rejects.toMatchObject({
				code: "MANIFEST_CONFLICT",
			});
		});

		it("throws ManifestConflictError when head exists but prevHeadId is null", async () => {
			const manifest = makeManifest({ name: "null-conflict-test" });
			await store.putHead("null-conflict-test", manifest, null);

			await expect(store.putHead("null-conflict-test", makeManifest(), null)).rejects.toMatchObject(
				{ code: "MANIFEST_CONFLICT" },
			);
		});

		it("preserves schemaVersion through round-trip", async () => {
			const manifest = makeManifest({ name: "schema-test", schemaVersion: 1 });
			await store.putHead("schema-test", manifest, null);
			const result = await store.getHead("schema-test");

			expect(result).not.toBeNull();
			expect(result?.manifest.schemaVersion).toBe(1);
		});
	});

	describe("listProjects", () => {
		it("returns empty array when no projects exist", async () => {
			const emptyDir = join(manifestDir, "empty-sub");
			const emptyStore = new LocalManifestStore(emptyDir);
			const projects = await emptyStore.listProjects();
			expect(projects).toEqual([]);
		});

		it("returns all project names", async () => {
			const listDir = join(manifestDir, "list-test");
			const listStore = new LocalManifestStore(listDir);

			await listStore.putHead("alpha", makeManifest({ name: "alpha" }), null);
			await listStore.putHead("beta", makeManifest({ name: "beta" }), null);

			const projects = await listStore.listProjects();
			expect(projects).toContain("alpha");
			expect(projects).toContain("beta");
		});
	});

	describe("path traversal protection", () => {
		it("returns null for getHead with traversal name", async () => {
			// getHead catches the WtfocError and returns null
			const result = await store.getHead("../../etc/passwd");
			expect(result).toBeNull();
		});

		it("throws COLLECTION_INVALID_NAME for putHead with traversal name", async () => {
			const manifest = makeManifest({ name: "traversal" });
			await expect(store.putHead("../escape", manifest, null)).rejects.toMatchObject({
				code: "COLLECTION_INVALID_NAME",
			});
		});

		it("throws COLLECTION_INVALID_NAME for absolute path name", async () => {
			const manifest = makeManifest({ name: "absolute" });
			await expect(store.putHead("/etc/passwd", manifest, null)).rejects.toMatchObject({
				code: "COLLECTION_INVALID_NAME",
			});
		});

		it("allows valid collection names", async () => {
			const manifest = makeManifest({ name: "valid-name" });
			const result = await store.putHead("valid-name", manifest, null);
			expect(result.headId).toBeTruthy();
		});
	});

	describe("auto-creates manifest directory", () => {
		it("creates directory on first putHead", async () => {
			const nestedDir = join(manifestDir, "nested", "manifest", "dir");
			const nestedStore = new LocalManifestStore(nestedDir);
			const manifest = makeManifest({ name: "nested-test" });
			const result = await nestedStore.putHead("nested-test", manifest, null);

			expect(result.headId).toBeTruthy();
		});
	});

	describe("collection name validation", () => {
		it("accepts valid names (letters, numbers, hyphens, underscores)", () => {
			expect(() => validateCollectionName("my-collection")).not.toThrow();
			expect(() => validateCollectionName("test_v2")).not.toThrow();
			expect(() => validateCollectionName("foc-ecosystem-v2")).not.toThrow();
			expect(() => validateCollectionName("ABC123")).not.toThrow();
		});

		it("rejects names containing dots", () => {
			expect(() => validateCollectionName("my.collection")).toThrow("Invalid collection name");
			expect(() => validateCollectionName("foo.bar.baz")).toThrow("Invalid collection name");
		});

		it("rejects empty names", () => {
			expect(() => validateCollectionName("")).toThrow("Invalid collection name");
		});

		it("rejects names with spaces or special characters", () => {
			expect(() => validateCollectionName("my collection")).toThrow("Invalid collection name");
			expect(() => validateCollectionName("foo/bar")).toThrow("Invalid collection name");
			expect(() => validateCollectionName("foo@bar")).toThrow("Invalid collection name");
		});

		it("rejects names longer than 128 characters", () => {
			const longName = "a".repeat(129);
			expect(() => validateCollectionName(longName)).toThrow("too long");
		});

		it("accepts names up to 128 characters", () => {
			const maxName = "a".repeat(128);
			expect(() => validateCollectionName(maxName)).not.toThrow();
		});
	});

	describe("listProjects excludes sidecar files", () => {
		it("only returns manifest files, not sidecars", async () => {
			const store = new LocalManifestStore(manifestDir);

			// Create a valid manifest
			const manifest = makeManifest({ name: "real-collection" });
			await store.putHead("real-collection", manifest, null);

			// Create sidecar files that should be excluded
			await writeFile(
				join(manifestDir, "real-collection.ingest-cursors.json"),
				JSON.stringify({ schemaVersion: 1, cursors: {} }),
			);
			await writeFile(
				join(manifestDir, "real-collection.document-catalog.json"),
				JSON.stringify({ schemaVersion: 1, documents: {} }),
			);
			await writeFile(
				join(manifestDir, "real-collection.edges-overlay.json"),
				JSON.stringify({ edges: [] }),
			);

			const projects = await store.listProjects();
			expect(projects).toContain("real-collection");
			expect(projects).not.toContain("real-collection.ingest-cursors");
			expect(projects).not.toContain("real-collection.document-catalog");
			expect(projects).not.toContain("real-collection.edges-overlay");
		});
	});

	describe("getHead returns null for invalid manifest files", () => {
		it("returns null for JSON that is not a valid manifest", async () => {
			await writeFile(
				join(manifestDir, "invalid-manifest.json"),
				JSON.stringify({ cursors: {}, notAManifest: true }),
			);
			const store = new LocalManifestStore(manifestDir);
			const head = await store.getHead("invalid-manifest");
			expect(head).toBeNull();
		});

		it("returns null for corrupt JSON", async () => {
			await writeFile(join(manifestDir, "corrupt.json"), "not json at all");
			const store = new LocalManifestStore(manifestDir);
			const head = await store.getHead("corrupt");
			expect(head).toBeNull();
		});
	});
});
