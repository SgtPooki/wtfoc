/**
 * Greedy single-pass threshold-based clusterer.
 * Groups chunks by cosine similarity >= threshold (default 0.85).
 * Exemplar selection: 3 closest to cluster centroid.
 * Label extraction: first 5-7 meaningful words from top exemplar.
 */

import type {
	Clusterer,
	ClusterOptions,
	ClusterRequest,
	ClusterResult,
	ThemeCluster,
} from "@wtfoc/common";
import { centroid, dot, normalize } from "./cosine.js";
import { extractLabel } from "./labels.js";

const DEFAULT_THRESHOLD = 0.85;
const DEFAULT_MAX_EXEMPLARS = 3;

export class GreedyClusterer implements Clusterer {
	async cluster(request: ClusterRequest, options?: ClusterOptions): Promise<ClusterResult> {
		const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
		const maxExemplars = options?.maxExemplars ?? DEFAULT_MAX_EXEMPLARS;
		const signal = options?.signal;

		signal?.throwIfAborted();

		const { ids, vectors, contents } = request;

		if (ids.length === 0) {
			return { clusters: [], noise: [], totalProcessed: 0 };
		}

		// Pre-normalize all vectors for fast dot-product cosine similarity
		const normalized = vectors.map((v) => normalize(new Float32Array(v)));

		// Greedy single-pass clustering
		// Each cluster stores indices into the original arrays
		const clusterMembers: number[][] = [];
		const assigned = new Set<number>();

		for (let i = 0; i < normalized.length; i++) {
			signal?.throwIfAborted();

			if (assigned.has(i)) continue;

			// Start a new cluster with this vector as seed
			const members = [i];
			assigned.add(i);

			// Find all unassigned vectors similar to the seed
			const seed = normalized[i];
			if (!seed) continue;

			for (let j = i + 1; j < normalized.length; j++) {
				if (assigned.has(j)) continue;
				const candidate = normalized[j];
				if (!candidate) continue;

				const sim = dot(seed, candidate);
				if (sim >= threshold) {
					members.push(j);
					assigned.add(j);
				}
			}

			clusterMembers.push(members);
		}

		// Build ThemeCluster objects
		const clusters: ThemeCluster[] = [];
		const noise: string[] = [];

		for (let ci = 0; ci < clusterMembers.length; ci++) {
			signal?.throwIfAborted();

			const memberIndices = clusterMembers[ci];
			if (!memberIndices) continue;

			// Singletons go to noise
			if (memberIndices.length === 1) {
				const idx = memberIndices[0];
				if (idx !== undefined) {
					const id = ids[idx];
					if (id !== undefined) {
						noise.push(id);
					}
				}
				continue;
			}

			const memberVectors = memberIndices
				.map((idx) => normalized[idx])
				.filter((v): v is Float32Array => v !== undefined);
			const memberIds = memberIndices
				.map((idx) => ids[idx])
				.filter((id): id is string => id !== undefined);

			// Compute centroid and find exemplars (closest to centroid)
			const cent = normalize(centroid(memberVectors));

			const distances = memberIndices.map((idx) => {
				const vec = normalized[idx];
				return { idx, sim: vec ? dot(cent, vec) : 0 };
			});
			distances.sort((a, b) => b.sim - a.sim);

			const exemplarIds = distances
				.slice(0, maxExemplars)
				.map((d) => ids[d.idx])
				.filter((id): id is string => id !== undefined);

			// Label from top exemplar content
			const topExemplarIdx = distances[0]?.idx;
			const topContent = topExemplarIdx !== undefined ? (contents[topExemplarIdx] ?? "") : "";
			const label = extractLabel(topContent);

			clusters.push({
				id: `cluster-${ci}`,
				label,
				exemplarIds,
				memberIds,
				size: memberIds.length,
			});
		}

		// Re-number cluster IDs to be contiguous (after noise removal)
		for (let i = 0; i < clusters.length; i++) {
			const cluster = clusters[i];
			if (cluster) {
				cluster.id = `cluster-${i}`;
			}
		}

		return {
			clusters,
			noise,
			totalProcessed: ids.length,
		};
	}
}
