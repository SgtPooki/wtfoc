import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageBackend } from "./local.js";

describe("LocalStorageBackend", () => {
	let dataDir: string;
	let backend: LocalStorageBackend;

	before(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "wtfoc-test-"));
		backend = new LocalStorageBackend(dataDir);
	});

	after(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	describe("upload and download", () => {
		it("round-trips bytes through upload then download", async () => {
			const data = new TextEncoder().encode("hello wtfoc");
			const result = await backend.upload(data);

			assert.ok(result.id, "id must be non-empty");
			assert.equal(result.ipfsCid, undefined, "local backend produces no ipfsCid");
			assert.equal(result.pieceCid, undefined, "local backend produces no pieceCid");

			const downloaded = await backend.download(result.id);
			assert.deepEqual(new Uint8Array(downloaded), data);
		});

		it("produces deterministic id for same content", async () => {
			const data = new TextEncoder().encode("deterministic");
			const result1 = await backend.upload(data);
			const result2 = await backend.upload(data);
			assert.equal(result1.id, result2.id);
		});

		it("produces different ids for different content", async () => {
			const result1 = await backend.upload(new TextEncoder().encode("aaa"));
			const result2 = await backend.upload(new TextEncoder().encode("bbb"));
			assert.notEqual(result1.id, result2.id);
		});
	});

	describe("download missing blob", () => {
		it("throws StorageNotFoundError for unknown id", async () => {
			await assert.rejects(
				() => backend.download("nonexistent-id"),
				(err: unknown) => {
					assert.ok(err instanceof Error);
					assert.equal((err as { code?: string }).code, "STORAGE_NOT_FOUND");
					return true;
				},
			);
		});
	});

	describe("verify", () => {
		it("returns exists: true and correct size for stored blob", async () => {
			const data = new TextEncoder().encode("verify me");
			const result = await backend.upload(data);
			const verification = await backend.verify(result.id);

			assert.equal(verification.exists, true);
			assert.equal(verification.size, data.byteLength);
		});

		it("returns exists: false for missing blob", async () => {
			const verification = await backend.verify("does-not-exist");
			assert.equal(verification.exists, false);
			assert.equal(verification.size, 0);
		});
	});

	describe("auto-creates data directory", () => {
		it("creates nested directory on first upload", async () => {
			const nestedDir = join(dataDir, "nested", "deep", "dir");
			const nestedBackend = new LocalStorageBackend(nestedDir);
			const data = new TextEncoder().encode("nested test");
			const result = await nestedBackend.upload(data);

			const downloaded = await nestedBackend.download(result.id);
			assert.deepEqual(new Uint8Array(downloaded), data);
		});
	});

	describe("AbortSignal", () => {
		it("rejects immediately when signal is already aborted", async () => {
			const controller = new AbortController();
			controller.abort();

			await assert.rejects(
				() => backend.upload(new TextEncoder().encode("abort"), undefined, controller.signal),
				(err: unknown) => {
					assert.ok(err instanceof DOMException || err instanceof Error);
					return true;
				},
			);
		});
	});
});
