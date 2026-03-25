import type { VectorIndex } from "@wtfoc/common";
import { InMemoryVectorIndex } from "./in-memory.js";

export type VectorBackend = "inmemory" | "qdrant";

export interface VectorIndexConfig {
	backend: VectorBackend;
	collectionName: string;
	dimensions: number;
	qdrantUrl?: string;
	qdrantApiKey?: string;
}

/**
 * Create a VectorIndex based on configuration.
 * Qdrant backend is loaded via dynamic import (optional dependency).
 */
export async function createVectorIndex(config: VectorIndexConfig): Promise<VectorIndex> {
	if (config.backend === "qdrant") {
		const { QdrantVectorIndex } = await import("./qdrant.js");
		return new QdrantVectorIndex({
			url: config.qdrantUrl ?? "http://localhost:6333",
			apiKey: config.qdrantApiKey,
			collectionName: config.collectionName,
			dimensions: config.dimensions,
		});
	}

	return new InMemoryVectorIndex();
}
