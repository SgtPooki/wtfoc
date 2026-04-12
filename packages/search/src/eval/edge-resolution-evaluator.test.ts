import type { Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { evaluateEdgeResolution } from "./edge-resolution-evaluator.js";

function makeSegment(
	chunks: Array<{ id: string; source: string; sourceType: string }>,
	edges: Array<{ sourceId: string; targetId: string; type: string }>,
): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 384,
		chunks: chunks.map((c) => ({
			...c,
			storageId: c.id,
			content: "test content",
			embedding: [],
			terms: [],
			sourceUrl: "",
			timestamp: "",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
		})),
		edges: edges.map((e) => ({
			...e,
			targetType: "document",
			evidence: "test",
			confidence: 0.8,
		})),
	};
}

describe("evaluateEdgeResolution", () => {
	it("reports correct resolution rate", async () => {
		const segments = [
			makeSegment(
				[
					{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" },
					{ id: "c2", source: "owner/repo#2", sourceType: "github-pr" },
				],
				[
					{ sourceId: "c1", targetId: "owner/repo#2", type: "references" }, // resolves to c2
					{ sourceId: "c1", targetId: "#123", type: "references" }, // bare ref
					{ sourceId: "c2", targetId: "nonexistent/repo#99", type: "closes" }, // unresolved
					{ sourceId: "c2", targetId: "c1", type: "references" }, // resolves (direct chunk ID)
				],
			),
		];

		const result = await evaluateEdgeResolution(segments);
		expect(result.metrics.totalEdges).toBe(4);
		expect(result.metrics.resolvedEdges).toBe(2);
		expect(result.metrics.bareRefs).toBe(1);
		expect(result.metrics.resolutionRate).toBe(0.5);
	});

	it("computes cross-source density correctly", async () => {
		const segments = [
			makeSegment(
				[
					{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" },
					{ id: "c2", source: "#general", sourceType: "slack-message" },
				],
				[
					// c1 (github-issue) → c2 (slack-message) = cross-source
					{ sourceId: "c1", targetId: "c2", type: "references" },
				],
			),
		];

		const result = await evaluateEdgeResolution(segments);
		expect(result.metrics.crossSourceEdgeDensity).toBe(1.0);
		const pairs = result.metrics.sourceTypePairs as Record<string, number>;
		expect(pairs["github-issue->slack-message"]).toBe(1);
	});

	it("reports top-10 unresolved repos", async () => {
		const chunks = [{ id: "c1", source: "owner/repo#1", sourceType: "code" }];
		const edges = Array.from({ length: 15 }, (_, i) => ({
			sourceId: "c1",
			targetId: `repo${i}/pkg#${i}`,
			type: "references",
		}));

		const segments = [makeSegment(chunks, edges)];
		const result = await evaluateEdgeResolution(segments);

		const topUnresolved = result.metrics.topUnresolvedRepos as Array<{
			repo: string;
			count: number;
		}>;
		expect(topUnresolved.length).toBe(10);
	});

	it("verdict 'fail' when resolutionRate < 0.05", async () => {
		const segments = [
			makeSegment(
				[{ id: "c1", source: "owner/repo#1", sourceType: "code" }],
				Array.from({ length: 20 }, (_, i) => ({
					sourceId: "c1",
					targetId: `missing/target#${i}`,
					type: "references",
				})),
			),
		];

		const result = await evaluateEdgeResolution(segments);
		expect(result.verdict).toBe("fail");
	});

	it("empty collection returns pass with zero metrics", async () => {
		const result = await evaluateEdgeResolution([]);
		expect(result.verdict).toBe("pass");
		expect(result.metrics.totalEdges).toBe(0);
	});
});
