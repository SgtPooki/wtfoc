import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Embedder, PrefixFormatter } from "@wtfoc/common";

/**
 * Key shape that gets sha256'd. Versioned so we can intentionally
 * invalidate on-disk caches when the key derivation changes, rather
 * than silently colliding.
 */
interface CacheKey {
	keyVersion: 1;
	provider: string;
	modelName: string;
	modelVersion: string;
	queryText: string;
}

interface CacheEntry {
	vector: number[];
	dimensions: number;
	modelName: string;
	modelVersion: string;
	createdAt: string;
}

export interface CachingEmbedderOptions {
	cacheDir: string;
	/** Used to namespace entries alongside model name (e.g. "openrouter", "transformers", "lmstudio"). */
	provider?: string;
	/** If the inner embedder exposes no stable model version, pass "unknown" explicitly. */
	modelVersion?: string;
}

interface Stats {
	hits: number;
	misses: number;
	writes: number;
	corrupt: number;
}

/**
 * Wraps any {@link Embedder} with a persistent, file-backed cache keyed on
 * `(provider, model, model-version, query-text)`. On hit the cached vector
 * is returned without calling the inner embedder — killing duplicate spend
 * and latency across runs that ask the same questions (dogfood replays,
 * repeat `trace` / `query` CLI calls, etc.).
 *
 * Not enabled by default. Wire it explicitly via the `--embedder-cache-dir`
 * flag (or `WTFOC_EMBEDDER_CACHE_DIR`). Keeping it opt-in avoids the privacy
 * surface described in gh-284 — no caller silently persists queries they
 * didn't opt into.
 *
 * Storage shape: one file per key at `<cacheDir>/<sha256>.json`. Atomic
 * write via temp file + rename. Corrupt entries are treated as misses and
 * repaired on next write. No TTL — keys include model version so a model
 * swap uses a different key; LRU eviction is a follow-up if growth matters.
 */
export class CachingEmbedder implements Embedder {
	readonly model?: string;
	readonly maxInputChars?: number;
	readonly prefix?: PrefixFormatter;

	readonly #inner: Embedder;
	readonly #cacheDir: string;
	readonly #provider: string;
	readonly #modelVersion: string;
	readonly #stats: Stats = { hits: 0, misses: 0, writes: 0, corrupt: 0 };

	constructor(inner: Embedder, options: CachingEmbedderOptions) {
		this.#inner = inner;
		this.#cacheDir = resolve(options.cacheDir);
		this.#provider = options.provider ?? "unknown";
		this.#modelVersion = options.modelVersion ?? "unknown";
		this.model = inner.model;
		this.maxInputChars = inner.maxInputChars;
		this.prefix = inner.prefix;
	}

	get dimensions(): number {
		return this.#inner.dimensions;
	}

	get stats(): Readonly<Stats> {
		return this.#stats;
	}

	async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
		signal?.throwIfAborted();
		const key = this.#keyFor(text);
		const cached = await this.#read(key);
		if (cached) {
			this.#stats.hits++;
			return Float32Array.from(cached.vector);
		}
		this.#stats.misses++;
		const vec = await this.#inner.embed(text, signal);
		await this.#write(key, vec);
		return vec;
	}

	async embedBatch(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
		signal?.throwIfAborted();
		const results: Array<Float32Array | null> = new Array(texts.length).fill(null);
		const missIndexes: number[] = [];
		const missTexts: string[] = [];
		for (let i = 0; i < texts.length; i++) {
			const text = texts[i] ?? "";
			const key = this.#keyFor(text);
			const cached = await this.#read(key);
			if (cached) {
				this.#stats.hits++;
				results[i] = Float32Array.from(cached.vector);
			} else {
				this.#stats.misses++;
				missIndexes.push(i);
				missTexts.push(text);
			}
		}
		if (missTexts.length > 0) {
			const fresh = await this.#inner.embedBatch(missTexts, signal);
			for (let j = 0; j < missIndexes.length; j++) {
				const idx = missIndexes[j];
				const vec = fresh[j];
				if (idx === undefined || !vec) continue;
				results[idx] = vec;
				const key = this.#keyFor(missTexts[j] ?? "");
				await this.#write(key, vec);
			}
		}
		return results.map((v) => v ?? new Float32Array(0));
	}

	#keyFor(text: string): string {
		const payload: CacheKey = {
			keyVersion: 1,
			provider: this.#provider,
			modelName: this.#inner.model ?? this.model ?? "unknown",
			modelVersion: this.#modelVersion,
			queryText: text,
		};
		return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
	}

	async #read(key: string): Promise<CacheEntry | null> {
		try {
			const raw = await readFile(join(this.#cacheDir, `${key}.json`), "utf-8");
			const parsed = JSON.parse(raw) as CacheEntry;
			if (!Array.isArray(parsed.vector) || typeof parsed.dimensions !== "number") {
				this.#stats.corrupt++;
				return null;
			}
			return parsed;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
			this.#stats.corrupt++;
			return null;
		}
	}

	async #write(key: string, vec: Float32Array): Promise<void> {
		await mkdir(this.#cacheDir, { recursive: true });
		const entry: CacheEntry = {
			vector: Array.from(vec),
			dimensions: vec.length,
			modelName: this.#inner.model ?? this.model ?? "unknown",
			modelVersion: this.#modelVersion,
			createdAt: new Date().toISOString(),
		};
		const finalPath = join(this.#cacheDir, `${key}.json`);
		const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(tmpPath, JSON.stringify(entry));
		await rename(tmpPath, finalPath);
		this.#stats.writes++;
	}
}
