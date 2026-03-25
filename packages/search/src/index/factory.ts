import type { VectorIndex } from "@wtfoc/common";
import { InMemoryVectorIndex } from "./in-memory.js";

export type VectorBackend = "inmemory" | "qdrant";

const VALID_BACKENDS: ReadonlySet<string> = new Set(["inmemory", "qdrant"]);

export interface VectorIndexConfig {
	backend: VectorBackend;
	collectionName: string;
	dimensions: number;
	qdrantUrl?: string;
	qdrantApiKey?: string;
	/**
	 * If true, drop and recreate the Qdrant collection on first use.
	 * Defaults to true to avoid stale vectors from previous loads.
	 */
	recreate?: boolean;
}

/**
 * Create a VectorIndex based on configuration.
 * Qdrant backend is loaded via dynamic import (optional dependency).
 */
export async function createVectorIndex(config: VectorIndexConfig): Promise<VectorIndex> {
	if (!VALID_BACKENDS.has(config.backend)) {
		console.error(
			`[wtfoc] Unknown WTFOC_VECTOR_BACKEND "${config.backend}", falling back to "inmemory".`,
		);
		return new InMemoryVectorIndex();
	}

	if (config.backend === "qdrant") {
		try {
			const { QdrantVectorIndex } = await import("./qdrant.js");
			return new QdrantVectorIndex({
				url: config.qdrantUrl ?? "http://localhost:6333",
				apiKey: config.qdrantApiKey,
				collectionName: config.collectionName,
				dimensions: config.dimensions,
				recreate: config.recreate ?? true,
			});
		} catch (err) {
			throw new Error(
				"Failed to initialize Qdrant vector backend. Install '@qdrant/js-client-rest' or set WTFOC_VECTOR_BACKEND=inmemory." +
					(err instanceof Error ? ` (${err.message})` : ""),
			);
		}
	}

	return new InMemoryVectorIndex();
}
