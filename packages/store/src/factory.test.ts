import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	HeadManifest,
	ManifestStore,
	StorageBackend,
	StorageResult,
	StoredHead,
} from "@wtfoc/common";
import { afterAll, describe, expect, it } from "vitest";
import { createStore } from "./factory.js";

describe("createStore", () => {
	const tempDirs: string[] = [];

	async function makeTempDir(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "wtfoc-factory-test-"));
		tempDirs.push(dir);
		return dir;
	}

	afterAll(async () => {
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

		expect(store.storage).toBeTruthy();
		expect(store.manifests).toBeTruthy();

		const data = new TextEncoder().encode("factory test");
		const result = await store.storage.upload(data);
		const downloaded = await store.storage.download(result.id);
		expect(new Uint8Array(downloaded)).toEqual(data);
	});

	it("throws for foc backend without private key", () => {
		const origKey = process.env["PRIVATE_KEY"];
		const origWtfocKey = process.env["WTFOC_PRIVATE_KEY"];
		process.env["PRIVATE_KEY"] = "";
		process.env["WTFOC_PRIVATE_KEY"] = "";
		try {
			expect(() => createStore({ storage: "foc" })).toThrow(/private key/i);
		} finally {
			if (origKey) process.env["PRIVATE_KEY"] = origKey;
			if (origWtfocKey) process.env["WTFOC_PRIVATE_KEY"] = origWtfocKey;
		}
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

		expect(uploaded).toHaveLength(1);
	});

	it("accepts a custom ManifestStore instance", async () => {
		const calls: string[] = [];

		const customManifests: ManifestStore = {
			async getHead(name: string): Promise<StoredHead | null> {
				calls.push(`getHead:${name}`);
				return null;
			},
			async putHead(
				name: string,
				manifest: HeadManifest,
				_prevHeadId: string | null,
			): Promise<StoredHead> {
				calls.push(`putHead:${name}`);
				return { headId: "custom-head", manifest };
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
		expect(calls).toEqual(["getHead:test"]);
	});

	it("uses custom backend when verify is not implemented", async () => {
		const customBackend: StorageBackend = {
			async upload(): Promise<StorageResult> {
				return { id: "no-verify" };
			},
			async download(): Promise<Uint8Array> {
				return new Uint8Array(0);
			},
		};

		const store = createStore({ storage: customBackend });
		expect(store.storage.verify).toBeUndefined();
	});
});
