/**
 * Clusterer interface contract — 8th pluggable seam in @wtfoc/common.
 *
 * Algorithm-neutral: no centroid, k, or density parameters in the shared contract.
 * Implementations may use k-means, HDBSCAN, ANN-based incremental, or any other
 * algorithm as long as they produce ClusterResult from ClusterRequest.
 */

export interface ClusterOptions {
	targetClusterCount?: number;
	minClusterSize?: number;
	similarityThreshold?: number;
	mode?: "batch" | "incremental";
}

export interface ClusterRequest {
	chunkIds: string[];
	embeddings: Map<string, Float32Array>;
	existingState?: ClusterState;
	options?: ClusterOptions;
}

export interface Cluster {
	id: string;
	memberIds: string[];
	exemplarIds: string[];
	confidence: number;
	metadata?: Record<string, unknown>;
}

export interface ClusterResult {
	clusters: Cluster[];
	unassigned: string[];
	metadata?: Record<string, unknown>;
}

export interface ClusterState {
	collectionId: string;
	revisionId: string | null;
	clusteredChunkIds: string[];
	clusters: Cluster[];
	algorithm: string;
	createdAt: string;
	updatedAt: string;
}

export interface Clusterer {
	cluster(request: ClusterRequest, signal?: AbortSignal): Promise<ClusterResult>;
}
