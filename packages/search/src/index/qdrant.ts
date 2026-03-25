import { createHash } from "node:crypto";
import {
	type ScoredEntry,
	VectorDimensionMismatchError,
	type VectorEntry,
	type VectorIndex,
} from "@wtfoc/common";

export interface QdrantVectorIndexOptions {
	url: string;
	apiKey?: string;
	collectionName: string;
	dimensions: number;
	/**
	 * If true, drop and recreate the Qdrant collection on first use.
	 * Use this when loading a fresh manifest to avoid stale vectors
	 * from a previous version persisting in the collection.
	 */
	recreate?: boolean;
}

/**
 * Convert an arbitrary string ID into a UUID-formatted string.
 * Qdrant requires point IDs to be UUIDs or unsigned integers.
 * We derive a deterministic UUID from the SHA-256 of the original ID.
 */
function toQdrantId(id: string): string {
	const hex = createHash("sha256").update(id).digest("hex");
	// Format as UUID v4-style: 8-4-4-4-12
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * VectorIndex backed by Qdrant. One Qdrant collection per wtfoc collection.
 * Auto-creates the Qdrant collection on first use.
 *
 * Requires `@qdrant/js-client-rest` to be installed (optional dependency).
 *
 * Note: `size` is best-effort and may lag behind actual Qdrant state.
 */
export class QdrantVectorIndex implements VectorIndex {
	readonly #options: QdrantVectorIndexOptions;
	#client: import("@qdrant/js-client-rest").QdrantClient | null = null;
	#ensurePromise: Promise<void> | null = null;
	#size = 0;

	constructor(options: QdrantVectorIndexOptions) {
		this.#options = options;
	}

	get size(): number {
		return this.#size;
	}

	async add(entries: VectorEntry[]): Promise<void> {
		if (entries.length === 0) return;

		for (const entry of entries) {
			if (entry.vector.length !== this.#options.dimensions) {
				throw new VectorDimensionMismatchError(
					this.#options.dimensions,
					entry.vector.length,
					"entry",
				);
			}
		}

		const client = await this.#getClient();
		await this.#ensureCollection(client);

		const points = entries.map((entry) => ({
			id: toQdrantId(entry.id),
			vector: Array.from(entry.vector),
			payload: {
				...entry.metadata,
				storageId: entry.storageId,
				_wtfoc_id: entry.id,
			},
		}));

		await client.upsert(this.#options.collectionName, {
			wait: true,
			points,
		});

		this.#size += entries.length;
	}

	async search(query: Float32Array, topK: number): Promise<ScoredEntry[]> {
		if (topK <= 0) return [];

		if (query.length !== this.#options.dimensions) {
			throw new VectorDimensionMismatchError(this.#options.dimensions, query.length, "query");
		}

		const client = await this.#getClient();

		try {
			const results = await client.search(this.#options.collectionName, {
				vector: Array.from(query),
				limit: topK,
				with_payload: true,
				with_vector: true,
				filter: {
					must_not: [{ key: "_wtfoc_sentinel", match: { value: true } }],
				},
			});

			return results.map((point) => {
				const payload = (point.payload ?? {}) as Record<string, unknown>;
				const { storageId, _wtfoc_id, ...metadata } = payload;
				const vector = Array.isArray(point.vector)
					? new Float32Array(point.vector as number[])
					: new Float32Array();

				return {
					entry: {
						id: String(_wtfoc_id ?? point.id),
						vector,
						storageId: String(storageId ?? ""),
						metadata: Object.fromEntries(
							Object.entries(metadata).map(([k, v]) => [k, String(v ?? "")]),
						),
					},
					score: point.score,
				};
			});
		} catch (err) {
			// Collection doesn't exist yet — no results
			if (isNotFoundError(err)) return [];
			throw err;
		}
	}

	async delete(ids: string[]): Promise<void> {
		if (ids.length === 0) return;

		const client = await this.#getClient();

		try {
			await client.delete(this.#options.collectionName, {
				wait: true,
				points: ids.map(toQdrantId),
			});
			this.#size = Math.max(0, this.#size - ids.length);
		} catch (err) {
			// Ignore if collection doesn't exist
			if (!isNotFoundError(err)) throw err;
		}
	}

	async #getClient(): Promise<import("@qdrant/js-client-rest").QdrantClient> {
		if (this.#client) return this.#client;

		try {
			const { QdrantClient } = await import("@qdrant/js-client-rest");
			this.#client = new QdrantClient({
				url: this.#options.url,
				apiKey: this.#options.apiKey,
				checkCompatibility: false,
			});
			return this.#client;
		} catch (err) {
			throw new Error(
				"Failed to load @qdrant/js-client-rest. Install it or set WTFOC_VECTOR_BACKEND=inmemory." +
					(err instanceof Error ? ` (${err.message})` : ""),
			);
		}
	}

	async #ensureCollection(client: import("@qdrant/js-client-rest").QdrantClient): Promise<void> {
		if (!this.#ensurePromise) {
			this.#ensurePromise = this.#doEnsureCollection(client);
		}
		return this.#ensurePromise;
	}

	async #doEnsureCollection(client: import("@qdrant/js-client-rest").QdrantClient): Promise<void> {
		if (this.#options.recreate) {
			try {
				await client.deleteCollection(this.#options.collectionName);
			} catch {
				// Collection didn't exist — that's fine
			}
			await client.createCollection(this.#options.collectionName, {
				vectors: {
					size: this.#options.dimensions,
					distance: "Cosine",
				},
			});
			return;
		}

		// TODO: When an existing collection is reused, stale vectors from
		// previous manifest versions remain. A reconciliation step should
		// diff current segment chunk IDs against stored point IDs and delete
		// orphans. See issue #101 follow-up.
		try {
			const info = await client.getCollection(this.#options.collectionName);
			this.#size = info.points_count ?? 0;
		} catch (err) {
			if (!isNotFoundError(err)) throw err;

			await client.createCollection(this.#options.collectionName, {
				vectors: {
					size: this.#options.dimensions,
					distance: "Cosine",
				},
			});
		}
	}
}

const SENTINEL_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Standalone Qdrant garbage collector for CID-loaded collections.
 * Operates independently of individual QdrantVectorIndex instances —
 * holds its own client reference so it can enumerate and delete collections.
 */
export class QdrantCollectionGc {
	readonly #url: string;
	readonly #apiKey: string | undefined;
	#client: import("@qdrant/js-client-rest").QdrantClient | null = null;

	constructor(url: string, apiKey?: string) {
		this.#url = url;
		this.#apiKey = apiKey;
	}

	async #getClient(): Promise<import("@qdrant/js-client-rest").QdrantClient> {
		if (this.#client) return this.#client;
		const { QdrantClient } = await import("@qdrant/js-client-rest");
		this.#client = new QdrantClient({
			url: this.#url,
			apiKey: this.#apiKey,
			checkCompatibility: false,
		});
		return this.#client;
	}

	/**
	 * Upsert a sentinel point that records when this collection was last accessed.
	 * The sentinel is a zero-vector point with metadata in its payload.
	 */
	async touchCollection(collectionName: string, dimensions: number): Promise<void> {
		const client = await this.#getClient();
		await client.upsert(collectionName, {
			wait: true,
			points: [
				{
					id: SENTINEL_ID,
					vector: new Array(dimensions).fill(0),
					payload: {
						_wtfoc_sentinel: true,
						_wtfoc_last_accessed: Date.now(),
					},
				},
			],
		});
	}

	/**
	 * List all Qdrant collections matching the `wtfoc-cid-` prefix.
	 * Returns collection names.
	 */
	async listCidCollections(): Promise<string[]> {
		const client = await this.#getClient();
		const { collections } = await client.getCollections();
		return collections.map((c) => c.name).filter((name) => name.startsWith("wtfoc-cid-"));
	}

	/**
	 * Read the sentinel point from a collection.
	 * Returns:
	 * - `{ status: "found", lastAccessed: number }` if sentinel exists
	 * - `{ status: "missing" }` if no sentinel point (collection exists but no GC metadata)
	 * - `{ status: "error" }` if Qdrant is unreachable or returns an unexpected error
	 */
	async getLastAccessed(
		collectionName: string,
	): Promise<
		{ status: "found"; lastAccessed: number } | { status: "missing" } | { status: "error" }
	> {
		const client = await this.#getClient();
		try {
			const points = await client.retrieve(collectionName, {
				ids: [SENTINEL_ID],
				with_payload: true,
				with_vector: false,
			});
			const point = points[0];
			if (!point) return { status: "missing" };
			const payload = point.payload as Record<string, unknown> | undefined;
			if (!payload?._wtfoc_sentinel) return { status: "missing" };
			return typeof payload._wtfoc_last_accessed === "number"
				? { status: "found", lastAccessed: payload._wtfoc_last_accessed }
				: { status: "missing" };
		} catch (err) {
			// 404 = collection doesn't exist, treat as missing
			if (isNotFoundError(err)) return { status: "missing" };
			// Anything else is a transient error — do NOT treat as deletable
			return { status: "error" };
		}
	}

	/**
	 * Delete a Qdrant collection entirely.
	 */
	async deleteCollection(collectionName: string): Promise<void> {
		const client = await this.#getClient();
		try {
			await client.deleteCollection(collectionName);
		} catch (err) {
			if (!isNotFoundError(err)) throw err;
		}
	}

	/**
	 * Sweep CID collections that have been idle beyond `maxIdleMs`.
	 * Respects `activeCollections` set — never deletes a collection that is
	 * currently loaded in the in-process cache.
	 *
	 * Returns the names of deleted collections.
	 */
	async sweep(opts: {
		maxIdleMs: number;
		maxCollections: number;
		activeCollections: Set<string>;
	}): Promise<string[]> {
		const cidCollections = await this.listCidCollections();
		if (cidCollections.length === 0) return [];

		// Gather last-accessed timestamps (skip collections with transient errors)
		const entries: Array<{ name: string; lastAccessed: number }> = [];
		for (const name of cidCollections) {
			if (opts.activeCollections.has(name)) continue;
			const result = await this.getLastAccessed(name);
			if (result.status === "error") continue; // transient failure — don't delete
			const lastAccessed = result.status === "found" ? result.lastAccessed : 0;
			entries.push({ name, lastAccessed });
		}

		const now = Date.now();
		const deleted: string[] = [];

		// Delete idle collections past TTL
		for (const entry of entries) {
			if (now - entry.lastAccessed > opts.maxIdleMs) {
				await this.deleteCollection(entry.name);
				deleted.push(entry.name);
			}
		}

		// If still over cap, delete least-recently-accessed first
		const remaining = cidCollections.length - deleted.length;
		if (remaining > opts.maxCollections) {
			const survivors = entries
				.filter((e) => !deleted.includes(e.name))
				.sort((a, b) => a.lastAccessed - b.lastAccessed);

			const toDelete = remaining - opts.maxCollections;
			for (let i = 0; i < toDelete && i < survivors.length; i++) {
				const survivor = survivors[i];
				if (!survivor) continue;
				await this.deleteCollection(survivor.name);
				deleted.push(survivor.name);
			}
		}

		return deleted;
	}
}

function isNotFoundError(err: unknown): boolean {
	if (err instanceof Error && "status" in err) {
		return (err as { status: number }).status === 404;
	}
	return String(err).includes("Not found") || String(err).includes("doesn't exist");
}
