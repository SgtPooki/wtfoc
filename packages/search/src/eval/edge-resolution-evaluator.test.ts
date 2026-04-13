import type { Edge, Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { evaluateEdgeResolution } from "./edge-resolution-evaluator.js";

function makeSegment(
	chunks: Array<{ id: string; source: string; sourceType: string }>,
	edges: Array<{ sourceId: string; targetId: string; type: string; targetType?: string }>,
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
			targetType: e.targetType ?? "document",
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

	it("tracks concept edges separately from unresolved", async () => {
		const segments = [
			makeSegment(
				[
					{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" },
					{ id: "c2", source: "owner/repo#2", sourceType: "github-pr" },
				],
				[
					{ sourceId: "c1", targetId: "owner/repo#2", type: "references" }, // resolves
					{
						sourceId: "c1",
						targetId: "performance-regression",
						type: "discusses",
						targetType: "concept",
					},
					{ sourceId: "c2", targetId: "auth-rewrite", type: "discusses", targetType: "concept" },
					{ sourceId: "c2", targetId: "nonexistent/repo#99", type: "closes" }, // unresolved
				],
			),
		];

		const result = await evaluateEdgeResolution(segments);
		expect(result.metrics.totalEdges).toBe(4);
		expect(result.metrics.resolvedEdges).toBe(1);
		expect(result.metrics.conceptEdges).toBe(2);
		expect(result.metrics.unresolvedEdges).toBe(1); // only the nonexistent repo
		// adjustedResolutionRate = 1 / (4 - 2 - 0) = 1/2 = 0.5
		expect(result.metrics.adjustedResolutionRate).toBe(0.5);
	});

	it("excludes package and url typed edges from inScopeResolutionRate denominator", async () => {
		const segments = [
			makeSegment(
				[
					{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" },
					{ id: "c2", source: "owner/repo#2", sourceType: "github-pr" },
				],
				[
					{ sourceId: "c1", targetId: "owner/repo#2", type: "references" }, // resolves
					{
						sourceId: "c1",
						targetId: "performance-regression",
						type: "discusses",
						targetType: "concept",
					}, // concept — excluded
					{
						sourceId: "c1",
						targetId: "@wtfoc/common",
						type: "imports",
						targetType: "package",
					}, // package — excluded from in-scope
					{
						sourceId: "c2",
						targetId: "https://docs.filecoin.io",
						type: "references",
						targetType: "url",
					}, // url — excluded from in-scope
					{ sourceId: "c2", targetId: "nonexistent/repo#99", type: "closes" }, // unresolved
				],
			),
		];

		const result = await evaluateEdgeResolution(segments);
		expect(result.metrics.totalEdges).toBe(5);
		// In-scope denominator = total - concept - bareRefs - package - url
		//                      = 5 - 1 - 0 - 1 - 1 = 2
		// In-scope resolved = 1 (owner/repo#2)
		// inScopeResolutionRate = 1/2 = 0.5
		expect(result.metrics.inScopeResolutionRate).toBe(0.5);
	});

	// ── Overlay edges ─────────────────────────────────────────────
	describe("with overlayEdges", () => {
		it("counts overlay edges in total and resolution metrics", async () => {
			const segments = [
				makeSegment(
					[
						{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" },
						{ id: "c2", source: "owner/repo#2", sourceType: "github-pr" },
					],
					[], // no segment-baked edges
				),
			];
			const overlayEdges: Edge[] = [
				{
					sourceId: "c1",
					targetId: "owner/repo#2",
					targetType: "pr",
					type: "references",
					evidence: "references pr",
					confidence: 0.7,
				},
				{
					sourceId: "c1",
					targetId: "nonexistent/repo#99",
					targetType: "issue",
					type: "references",
					evidence: "references missing",
					confidence: 0.7,
				},
				{
					sourceId: "c1",
					targetId: "performance-regression",
					targetType: "concept",
					type: "discusses",
					evidence: "performance regression concept",
					confidence: 0.7,
				},
			];

			const result = await evaluateEdgeResolution(segments, overlayEdges);
			expect(result.metrics.totalEdges).toBe(3);
			expect(result.metrics.resolvedEdges).toBe(1);
			expect(result.metrics.conceptEdges).toBe(1);
			expect(result.metrics.unresolvedEdges).toBe(1);
		});

		it("merges segment edges and overlay edges for combined metrics", async () => {
			const segments = [
				makeSegment(
					[
						{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" },
						{ id: "c2", source: "owner/repo#2", sourceType: "github-pr" },
					],
					[
						{ sourceId: "c1", targetId: "owner/repo#2", type: "references" }, // resolves
					],
				),
			];
			const overlayEdges: Edge[] = [
				{
					sourceId: "c2",
					targetId: "owner/repo#1",
					targetType: "issue",
					type: "closes",
					evidence: "closes issue",
					confidence: 0.8,
				}, // also resolves
			];

			const result = await evaluateEdgeResolution(segments, overlayEdges);
			expect(result.metrics.totalEdges).toBe(2);
			expect(result.metrics.resolvedEdges).toBe(2);
		});

		it("empty overlayEdges behaves identically to no overlayEdges arg", async () => {
			const segments = [
				makeSegment(
					[{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" }],
					[{ sourceId: "c1", targetId: "owner/repo#1", type: "references" }],
				),
			];

			const withEmpty = await evaluateEdgeResolution(segments, []);
			const withoutArg = await evaluateEdgeResolution(segments);
			expect(withEmpty.metrics.totalEdges).toBe(withoutArg.metrics.totalEdges);
			expect(withEmpty.metrics.resolvedEdges).toBe(withoutArg.metrics.resolvedEdges);
		});
	});

	it("reports per-source-type resolution breakdown", async () => {
		const segments = [
			makeSegment(
				[
					{ id: "c1", source: "owner/repo#1", sourceType: "github-issue" },
					{ id: "c2", source: "owner/repo#2", sourceType: "github-pr" },
					{ id: "c3", source: "#general", sourceType: "slack-message" },
				],
				[
					// github-issue edges: 1 resolved, 1 unresolved
					{ sourceId: "c1", targetId: "owner/repo#2", type: "references" }, // resolves
					{ sourceId: "c1", targetId: "nonexistent/repo#99", type: "closes" }, // unresolved
					// github-pr edges: 1 resolved
					{ sourceId: "c2", targetId: "c1", type: "references" }, // resolves (direct ID)
					// slack-message edges: 0 resolved, 1 unresolved
					{ sourceId: "c3", targetId: "missing/thing#5", type: "references" }, // unresolved
				],
			),
		];

		const result = await evaluateEdgeResolution(segments);
		const breakdown = result.metrics.perSourceTypeBreakdown as Record<
			string,
			{ total: number; resolved: number; resolutionRate: number }
		>;

		expect(breakdown).toBeDefined();
		expect(breakdown["github-issue"]).toEqual({
			total: 2,
			resolved: 1,
			resolutionRate: 0.5,
		});
		expect(breakdown["github-pr"]).toEqual({
			total: 1,
			resolved: 1,
			resolutionRate: 1,
		});
		expect(breakdown["slack-message"]).toEqual({
			total: 1,
			resolved: 0,
			resolutionRate: 0,
		});
	});

	it("resolves edges when source uses GitHub URL format", async () => {
		const segments = [
			makeSegment(
				[
					{ id: "c1", source: "https://github.com/Owner/Repo#1", sourceType: "github-issue" },
					{ id: "c2", source: "Owner/Repo#2", sourceType: "github-pr" },
				],
				[
					// Target without URL prefix should still resolve to URL-prefixed source
					{ sourceId: "c2", targetId: "Owner/Repo#1", type: "references" },
				],
			),
		];

		const result = await evaluateEdgeResolution(segments);
		expect(result.metrics.resolvedEdges).toBe(1);
	});
});
