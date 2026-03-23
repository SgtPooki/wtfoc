import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ManifestStore, StorageBackend, StorageResult, StoredHead, HeadManifest } from "@wtfoc/common";
import { createStore } from "./factory.js";

describe("createStore", () => {
	const tempDirs: string[] = [];

	async function makeTempDir(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "wtfoc-factory-test-"));
		tempDirs.push(dir);
		return dir;
	}

	after(async () => {
		for (const dir of tempDirs) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("creates a local store with default backends", async () => {
		const dataDir = await makeTempDir();
		const manifestDir = await makeTempDir();
		const store = createStore({
			storage: "local",
			dataDir,
			manifestDir,
		});

		assert.ok(store.storage, "storage backend exists");
		assert.ok(store.manifests, "manifest store exists");

		// Verify storage works
		const data = new TextEncoder().encode("factory test");
		const result = await store.storage.upload(data);
		const downloaded = await store.storage.download(result.id);
		assert.deepEqual(new Uint8Array(downloaded), data);
	});

	it("throws for foc backend (not yet implemented)", () => {
		assert.throws(
			() => createStore({ storage: "foc", privateKey: "0xtest" }),
			/not yet implemented/i,
		);
	});

	it("accepts a custom StorageBackend instance", async () => {
		const uploaded: Uint8Array[] = [];

		const customBackend: StorageBackend = {
			async upload(data: Uint8Array): Promise<StorageResult> {
				uploaded.push(data);
				return { id: "custom-id" };
			},
			async download(): Promise<Uint8Array> {
				return new Uint8Array(0);
			},
		};

		const store = createStore({ storage: customBackend });
		await store.storage.upload(new TextEncoder().encode("custom"));

		assert.equal(uploaded.length, 1);
	});

	it("accepts a custom ManifestStore instance", async () => {
		const calls: string[] = [];

		const customManifests: ManifestStore = {
			async getHead(name: string): Promise<StoredHead | null> {
				calls.push(`getHead:${name}`);
				return null;
			},
			async putHead(name: string, _manifest: HeadManifest, _prevHeadId: string | null): Promise<StoredHead> {
				calls.push(`putHead:${name}`);
				return { headId: "custom-head", manifest: _manifest };
			},
			async listProjects(): Promise<string[]> {
				return [];
			},
		};

		const store = createStore({
			storage: "local",
			dataDir: await makeTempDir(),
			manifests: customManifests,
		});

		await store.manifests.getHead("test");
		assert.deepEqual(calls, ["getHead:test"]);
	});

	it("uses custom backend when verify is not implemented", async () => {
		const customBackend: StorageBackend = {
			async upload(): Promise<StorageResult> {
				return { id: "no-verify" };
			},
			async download(): Promise<Uint8Array> {
				return new Uint8Array(0);
			},
			// verify intentionally omitted
		};

		const store = createStore({ storage: customBackend });
		assert.equal(store.storage.verify, undefined);
	});
});
