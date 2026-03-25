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

function isNotFoundError(err: unknown): boolean {
	if (err instanceof Error && "status" in err) {
		return (err as { status: number }).status === 404;
	}
	return String(err).includes("Not found") || String(err).includes("doesn't exist");
}
