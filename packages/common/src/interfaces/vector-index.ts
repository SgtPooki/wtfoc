/**
 * Entry in a vector index — a chunk with its embedding and storage reference.
 */
export interface VectorEntry {
	id: string;
	vector: Float32Array;
	storageId: string;
	metadata: Record<string, string>;
}

/**
 * Search result with relevance score.
 */
export interface ScoredEntry {
	entry: VectorEntry;
	score: number;
}

/**
 * Pluggable vector index. Built-in: in-memory brute-force cosine similarity.
 * Users can swap to Qdrant, Pinecone, Weaviate, etc.
 */
export interface VectorIndex {
	add(entries: VectorEntry[]): Promise<void>;
	search(query: Float32Array, topK: number): Promise<ScoredEntry[]>;
	serialize(): Promise<Uint8Array>;
	deserialize(data: Uint8Array): Promise<void>;
	readonly size: number;
}
