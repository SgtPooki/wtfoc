import type { ClusterResult } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";

const mockCluster = vi.hoisted(() => vi.fn<() => Promise<ClusterResult>>());

vi.mock("../clustering/greedy-clusterer.js", () => ({
	GreedyClusterer: class {
		async cluster(): Promise<ClusterResult> {
			return mockCluster();
		}
	},
}));

const { evaluateThemes } = await import("./themes-evaluator.js");

function makeSegmentWithEmbeddings(
	chunks: Array<{ id: string; sourceType: string; embedding: number[] }>,
) {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 3,
		chunks: chunks.map((c) => ({
			...c,
			storageId: c.id,
			content: "test content",
			source: "test",
			sourceUrl: "",
			timestamp: "",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
			terms: [],
		})),
		edges: [],
	};
}

describe("evaluateThemes", () => {
	it("reports correct cluster count and sizes", async () => {
		mockCluster.mockResolvedValue({
			clusters: [
				{ id: "c0", label: "Topic A", exemplarIds: ["c1"], memberIds: ["c1", "c2"], size: 2 },
				{ id: "c1", label: "Topic B", exemplarIds: ["c3"], memberIds: ["c3"], size: 1 },
				{ id: "c2", label: "Topic C", exemplarIds: ["c4"], memberIds: ["c4", "c5", "c6"], size: 3 },
			],
			noise: ["c7"],
			totalProcessed: 7,
		});

		const segments = [
			makeSegmentWithEmbeddings([
				{ id: "c1", sourceType: "github-issue", embedding: [1, 0, 0] },
				{ id: "c2", sourceType: "github-issue", embedding: [0.9, 0.1, 0] },
				{ id: "c3", sourceType: "slack-message", embedding: [0, 1, 0] },
				{ id: "c4", sourceType: "code", embedding: [0, 0, 1] },
				{ id: "c5", sourceType: "code", embedding: [0, 0.1, 0.9] },
				{ id: "c6", sourceType: "github-pr", embedding: [0.1, 0, 0.9] },
				{ id: "c7", sourceType: "code", embedding: [0.5, 0.5, 0.5] },
			]),
		];

		const result = await evaluateThemes(segments);
		expect(result.metrics.clusterCount).toBe(3);
		expect(result.metrics.noiseCount).toBe(1);
		expect(result.verdict).toBe("pass");
	});

	it("verdict 'fail' when no clusters formed", async () => {
		mockCluster.mockResolvedValue({
			clusters: [],
			noise: ["c1"],
			totalProcessed: 1,
		});

		const segments = [
			makeSegmentWithEmbeddings([{ id: "c1", sourceType: "code", embedding: [1, 0, 0] }]),
		];

		const result = await evaluateThemes(segments);
		expect(result.verdict).toBe("fail");
	});

	it("LLM labeling skipped when no extractor options", async () => {
		mockCluster.mockResolvedValue({
			clusters: [{ id: "c0", label: "Topic A", exemplarIds: ["c1"], memberIds: ["c1"], size: 1 }],
			noise: [],
			totalProcessed: 1,
		});

		const segments = [
			makeSegmentWithEmbeddings([{ id: "c1", sourceType: "code", embedding: [1, 0, 0] }]),
		];

		const result = await evaluateThemes(segments);
		expect(result.metrics.labels).toBeUndefined();
	});
});
