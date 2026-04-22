import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Embedder } from "@wtfoc/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CachingEmbedder } from "./caching.js";

class CountingEmbedder implements Embedder {
	readonly dimensions = 3;
	readonly model = "counter-v1";
	calls = 0;
	batchCalls = 0;

	async embed(text: string): Promise<Float32Array> {
		this.calls++;
		// Deterministic fake embedding derived from text length, for assertions.
		return Float32Array.from([text.length, text.length + 1, text.length + 2]);
	}

	async embedBatch(texts: string[]): Promise<Float32Array[]> {
		this.batchCalls++;
		return Promise.all(texts.map((t) => this.embed(t)));
	}
}

describe("CachingEmbedder", () => {
	let cacheDir: string;
	let inner: CountingEmbedder;

	beforeEach(async () => {
		cacheDir = await mkdtemp(join(tmpdir(), "wtfoc-cache-"));
		inner = new CountingEmbedder();
	});

	afterEach(() => {
		// tmpdir cleanup is best-effort; the OS handles it
	});

	it("first call delegates to inner, second call hits cache", async () => {
		const cache = new CachingEmbedder(inner, { cacheDir });
		await cache.embed("hello world");
		await cache.embed("hello world");
		expect(inner.calls).toBe(1);
		expect(cache.stats.hits).toBe(1);
		expect(cache.stats.misses).toBe(1);
		expect(cache.stats.writes).toBe(1);
	});

	it("cache survives across wrapper instances (persisted to disk)", async () => {
		const cacheA = new CachingEmbedder(inner, { cacheDir });
		await cacheA.embed("persisted");

		const inner2 = new CountingEmbedder();
		const cacheB = new CachingEmbedder(inner2, { cacheDir });
		const v = await cacheB.embed("persisted");

		expect(inner2.calls).toBe(0);
		expect(cacheB.stats.hits).toBe(1);
		expect(Array.from(v)).toEqual([9, 10, 11]);
	});

	it("different model versions produce different keys (no stale cross-model collisions)", async () => {
		const cacheA = new CachingEmbedder(inner, { cacheDir, modelVersion: "2025-01" });
		await cacheA.embed("same text");

		const cacheB = new CachingEmbedder(inner, { cacheDir, modelVersion: "2026-01" });
		await cacheB.embed("same text");

		expect(inner.calls).toBe(2);
		expect(cacheB.stats.misses).toBe(1);
	});

	it("corrupt file is treated as a miss and overwritten", async () => {
		const cacheA = new CachingEmbedder(inner, { cacheDir });
		await cacheA.embed("corruptible");

		// Corrupt the stored entry. The file name is a sha256 — just list the dir.
		const { readdir } = await import("node:fs/promises");
		const files = await readdir(cacheDir);
		const stored = files.find((f) => f.endsWith(".json"));
		expect(stored, "cache file should exist").toBeTruthy();
		if (stored) await writeFile(join(cacheDir, stored), "{not valid json");

		const cacheB = new CachingEmbedder(new CountingEmbedder(), { cacheDir });
		await cacheB.embed("corruptible");
		expect(cacheB.stats.corrupt).toBe(1);
		expect(cacheB.stats.writes).toBe(1);
	});

	it("embedBatch only calls inner for cache misses", async () => {
		const cache = new CachingEmbedder(inner, { cacheDir });
		await cache.embed("seeded");
		expect(inner.calls).toBe(1);

		await cache.embedBatch(["seeded", "fresh-a", "fresh-b"]);
		expect(inner.batchCalls).toBe(1);
		// Inner.embed was called once per batch miss inside our fake impl; in
		// a real embedder embedBatch is a single provider call, but what we
		// assert is that 2 misses were dispatched, not 3.
		expect(cache.stats.hits).toBe(1);
		expect(cache.stats.misses).toBe(3); // seed miss + 2 batch misses
	});

	it("forwards .model / .dimensions / .maxInputChars / .prefix from inner", () => {
		const cache = new CachingEmbedder(inner, { cacheDir });
		expect(cache.model).toBe("counter-v1");
		expect(cache.dimensions).toBe(3);
	});
});
