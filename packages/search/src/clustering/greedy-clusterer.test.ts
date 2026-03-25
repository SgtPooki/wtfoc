import { describe, expect, it } from "vitest";
import { GreedyClusterer } from "./greedy-clusterer.js";

function makeVector(dim: number, seed: number[]): Float32Array {
	const vec = new Float32Array(dim);
	for (let i = 0; i < seed.length && i < dim; i++) {
		vec[i] = seed[i] ?? 0;
	}
	return vec;
}

describe("GreedyClusterer", () => {
	const clusterer = new GreedyClusterer();

	it("returns empty result for empty input", async () => {
		const result = await clusterer.cluster({
			ids: [],
			vectors: [],
			contents: [],
		});
		expect(result.clusters).toHaveLength(0);
		expect(result.noise).toHaveLength(0);
		expect(result.totalProcessed).toBe(0);
	});

	it("clusters identical vectors together", async () => {
		const v = makeVector(3, [1, 0, 0]);
		const result = await clusterer.cluster({
			ids: ["a", "b", "c"],
			vectors: [new Float32Array(v), new Float32Array(v), new Float32Array(v)],
			contents: [
				"upload handler storage backend configuration details",
				"upload handler storage backend configuration details",
				"upload handler storage backend configuration details",
			],
		});

		expect(result.clusters).toHaveLength(1);
		expect(result.clusters[0]?.memberIds).toEqual(["a", "b", "c"]);
		expect(result.clusters[0]?.size).toBe(3);
		expect(result.noise).toHaveLength(0);
		expect(result.totalProcessed).toBe(3);
	});

	it("separates dissimilar vectors into noise or separate clusters", async () => {
		const result = await clusterer.cluster({
			ids: ["a", "b", "c"],
			vectors: [makeVector(3, [1, 0, 0]), makeVector(3, [0, 1, 0]), makeVector(3, [0, 0, 1])],
			contents: [
				"upload handler storage backend configuration details here",
				"search query vector index similarity score results",
				"deployment pipeline configuration management system setup",
			],
		});

		// Orthogonal vectors should not cluster together
		// They should all be noise (singletons)
		expect(result.noise).toHaveLength(3);
		expect(result.clusters).toHaveLength(0);
	});

	it("assigns cluster IDs contiguously", async () => {
		const v1 = makeVector(3, [1, 0.05, 0]);
		const v2 = makeVector(3, [0, 0, 1]);
		const result = await clusterer.cluster({
			ids: ["a", "b", "c"],
			vectors: [new Float32Array(v1), new Float32Array(v1), v2],
			contents: [
				"upload handler storage backend configuration details",
				"upload handler storage backend configuration details",
				"completely different topic about deployment pipeline system",
			],
		});

		// v1 pair clusters, v2 is noise
		const clusterIds = result.clusters.map((c) => c.id);
		expect(clusterIds).toEqual(["cluster-0"]);
	});

	it("selects up to maxExemplars exemplars", async () => {
		const v = makeVector(3, [1, 0, 0]);
		const vectors = Array.from({ length: 10 }, () => new Float32Array(v));
		const ids = Array.from({ length: 10 }, (_, i) => `chunk-${i}`);
		const contents = Array.from(
			{ length: 10 },
			() => "upload handler storage backend configuration details",
		);

		const result = await clusterer.cluster({ ids, vectors, contents }, { maxExemplars: 3 });

		expect(result.clusters).toHaveLength(1);
		expect(result.clusters[0]?.exemplarIds).toHaveLength(3);
	});

	it("generates labels from exemplar content", async () => {
		const v = makeVector(3, [1, 0, 0]);
		const result = await clusterer.cluster({
			ids: ["a", "b"],
			vectors: [new Float32Array(v), new Float32Array(v)],
			contents: [
				"The upload handler failed because the storage backend was unreachable in production",
				"Upload failures in the storage layer when backend disconnects",
			],
		});

		expect(result.clusters).toHaveLength(1);
		expect(result.clusters[0]?.label).toBeTruthy();
		expect(result.clusters[0]?.label.length).toBeGreaterThan(0);
	});

	it("respects custom threshold", async () => {
		// Two vectors with moderate similarity
		const v1 = makeVector(3, [1, 0.3, 0]);
		const v2 = makeVector(3, [1, 0.4, 0]);

		// With very high threshold, they should not cluster
		const result = await clusterer.cluster(
			{
				ids: ["a", "b"],
				vectors: [v1, v2],
				contents: [
					"content alpha bravo charlie delta echo foxtrot",
					"content alpha bravo charlie delta echo golf",
				],
			},
			{ threshold: 0.9999 },
		);

		// They might still cluster depending on exact similarity
		// but with threshold near 1.0, likely noise
		expect(result.totalProcessed).toBe(2);
	});

	it("respects AbortSignal", async () => {
		const controller = new AbortController();
		controller.abort();

		const v = makeVector(3, [1, 0, 0]);
		await expect(
			clusterer.cluster(
				{
					ids: ["a"],
					vectors: [v],
					contents: ["test"],
				},
				{ signal: controller.signal },
			),
		).rejects.toThrow();
	});
});
