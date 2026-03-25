/**
 * Pluggable clusterer. Groups related chunks by embedding similarity
 * and produces labelled theme clusters.
 *
 * Built-in: greedy single-pass threshold-based clustering with
 * cosine similarity >= 0.85. Users can swap to HDBSCAN, k-means, etc.
 */

/** A single theme cluster with label, exemplars, and member IDs. */
export interface ThemeCluster {
	/** Unique cluster identifier (e.g. "cluster-0") */
	id: string;
	/** Human-readable label extracted from top exemplar content */
	label: string;
	/** IDs of the exemplar chunks (closest to centroid) */
	exemplarIds: string[];
	/** IDs of all member chunks in this cluster */
	memberIds: string[];
	/** Number of members */
	size: number;
}

/** Input to the cluster() method. */
export interface ClusterRequest {
	/** Chunk IDs in the same order as vectors */
	ids: string[];
	/** Embedding vectors (one per chunk, same order as ids) */
	vectors: Float32Array[];
	/** Chunk content texts (same order as ids), used for label extraction */
	contents: string[];
}

/** Options controlling clustering behavior. */
export interface ClusterOptions {
	/** Cosine similarity threshold for cluster membership (default 0.85) */
	threshold?: number;
	/** Maximum exemplars per cluster (default 3) */
	maxExemplars?: number;
	/** Abort signal for cancellation */
	signal?: AbortSignal;
}

/** Result from a clustering operation. */
export interface ClusterResult {
	/** The discovered theme clusters */
	clusters: ThemeCluster[];
	/** IDs of chunks that didn't fit any cluster (singletons) */
	noise: string[];
	/** Total chunks processed */
	totalProcessed: number;
}

/** Pluggable clusterer interface. */
export interface Clusterer {
	cluster(request: ClusterRequest, options?: ClusterOptions): Promise<ClusterResult>;
}
