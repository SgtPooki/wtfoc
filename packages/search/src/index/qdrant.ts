import type { ScoredEntry, VectorEntry, VectorIndex } from "@wtfoc/common";

export interface QdrantVectorIndexOptions {
	url: string;
	apiKey?: string;
	collectionName: string;
	dimensions: number;
}

/**
 * VectorIndex backed by Qdrant. One Qdrant collection per wtfoc collection.
 * Auto-creates the Qdrant collection on first use.
 *
 * Requires `@qdrant/js-client-rest` to be installed (optional dependency).
 */
export class QdrantVectorIndex implements VectorIndex {
	readonly #options: QdrantVectorIndexOptions;
	#client: import("@qdrant/js-client-rest").QdrantClient | null = null;
	#ensured = false;
	#size = 0;

	constructor(options: QdrantVectorIndexOptions) {
		this.#options = options;
	}

	get size(): number {
		return this.#size;
	}

	async add(entries: VectorEntry[]): Promise<void> {
		if (entries.length === 0) return;

		const client = await this.#getClient();
		await this.#ensureCollection(client);

		const points = entries.map((entry) => ({
			id: entry.id,
			vector: Array.from(entry.vector),
			payload: {
				...entry.metadata,
				storageId: entry.storageId,
			},
		}));

		await client.upsert(this.#options.collectionName, {
			wait: true,
			points,
		});

		await this.#refreshSize(client);
	}

	async search(query: Float32Array, topK: number): Promise<ScoredEntry[]> {
		if (topK <= 0) return [];

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
				const { storageId, ...metadata } = payload;
				const vector = Array.isArray(point.vector)
					? new Float32Array(point.vector as number[])
					: new Float32Array();

				return {
					entry: {
						id: String(point.id),
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
				points: ids,
			});
			await this.#refreshSize(client);
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
		if (this.#ensured) return;

		try {
			const info = await client.getCollection(this.#options.collectionName);
			this.#size = info.points_count ?? 0;
			this.#ensured = true;
		} catch (err) {
			if (!isNotFoundError(err)) throw err;

			await client.createCollection(this.#options.collectionName, {
				vectors: {
					size: this.#options.dimensions,
					distance: "Cosine",
				},
			});
			this.#ensured = true;
		}
	}

	async #refreshSize(client: import("@qdrant/js-client-rest").QdrantClient): Promise<void> {
		try {
			const info = await client.getCollection(this.#options.collectionName);
			this.#size = info.points_count ?? this.#size;
		} catch {
			// Non-critical — size is best-effort for Qdrant backend
		}
	}
}

function isNotFoundError(err: unknown): boolean {
	if (err instanceof Error && "status" in err) {
		return (err as { status: number }).status === 404;
	}
	return String(err).includes("Not found") || String(err).includes("doesn't exist");
}
