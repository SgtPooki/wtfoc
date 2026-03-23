import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorageBackend } from "./local.js";

describe("LocalStorageBackend", () => {
	let dataDir: string;
	let backend: LocalStorageBackend;

	beforeAll(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "wtfoc-test-"));
		backend = new LocalStorageBackend(dataDir);
	});

	afterAll(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	describe("upload and download", () => {
		it("round-trips bytes through upload then download", async () => {
			const data = new TextEncoder().encode("hello wtfoc");
			const result = await backend.upload(data);

			expect(result.id).toBeTruthy();
			expect(result.ipfsCid).toBeUndefined();
			expect(result.pieceCid).toBeUndefined();

			const downloaded = await backend.download(result.id);
			expect(new Uint8Array(downloaded)).toEqual(data);
		});

		it("produces deterministic id for same content", async () => {
			const data = new TextEncoder().encode("deterministic");
			const result1 = await backend.upload(data);
			const result2 = await backend.upload(data);
			expect(result1.id).toBe(result2.id);
		});

		it("produces different ids for different content", async () => {
			const result1 = await backend.upload(new TextEncoder().encode("aaa"));
			const result2 = await backend.upload(new TextEncoder().encode("bbb"));
			expect(result1.id).not.toBe(result2.id);
		});
	});

	describe("download missing blob", () => {
		it("throws StorageNotFoundError for unknown id", async () => {
			await expect(backend.download("nonexistent-id")).rejects.toMatchObject({
				code: "STORAGE_NOT_FOUND",
			});
		});
	});

	describe("verify", () => {
		it("returns exists: true and correct size for stored blob", async () => {
			const data = new TextEncoder().encode("verify me");
			const result = await backend.upload(data);
			const verification = await backend.verify(result.id);

			expect(verification.exists).toBe(true);
			expect(verification.size).toBe(data.byteLength);
		});

		it("returns exists: false for missing blob", async () => {
			const verification = await backend.verify("does-not-exist");
			expect(verification.exists).toBe(false);
			expect(verification.size).toBe(0);
		});
	});

	describe("auto-creates data directory", () => {
		it("creates nested directory on first upload", async () => {
			const nestedDir = join(dataDir, "nested", "deep", "dir");
			const nestedBackend = new LocalStorageBackend(nestedDir);
			const data = new TextEncoder().encode("nested test");
			const result = await nestedBackend.upload(data);

			const downloaded = await nestedBackend.download(result.id);
			expect(new Uint8Array(downloaded)).toEqual(data);
		});
	});

	describe("AbortSignal", () => {
		it("rejects immediately when signal is already aborted", async () => {
			const controller = new AbortController();
			controller.abort();

			await expect(
				backend.upload(new TextEncoder().encode("abort"), undefined, controller.signal),
			).rejects.toThrow();
		});
	});
});
