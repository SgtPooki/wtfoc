import { describe, expect, it, vi } from "vitest";
import type { QueryResult } from "../query.js";
import type { TraceResult } from "../trace/trace.js";

const mockQuery = vi.hoisted(() => vi.fn<() => Promise<QueryResult>>());
const mockTrace = vi.hoisted(() => vi.fn<() => Promise<TraceResult>>());

vi.mock("../query.js", () => ({ query: mockQuery }));
vi.mock("../trace/trace.js", () => ({ trace: mockTrace }));

const { evaluateQualityQueries } = await import("./quality-queries-evaluator.js");

function makeQueryResult(
	results: Array<{ sourceType: string; source: string; score: number }>,
): QueryResult {
	return {
		query: "test query",
		results: results.map((r) => ({
			content: "test",
			sourceType: r.sourceType,
			source: r.source,
			storageId: "s1",
			score: r.score,
		})),
	};
}

function makeTraceResult(
	hops: Array<{ method: "edge" | "semantic"; sourceType: string }>,
): TraceResult {
	return {
		query: "test query",
		groups: {},
		hops: hops.map((h) => ({
			content: "test",
			sourceType: h.sourceType,
			source: "test",
			storageId: "s1",
			connection: {
				method: h.method,
				edgeType: h.method === "edge" ? "references" : undefined,
				evidence: h.method === "edge" ? "test evidence" : undefined,
				confidence: 0.8,
			},
		})),
		insights: [],
		lineageChains: [],
		stats: {
			totalHops: hops.length,
			edgeHops: hops.filter((h) => h.method === "edge").length,
			semanticHops: hops.filter((h) => h.method === "semantic").length,
			sourceTypes: [...new Set(hops.map((h) => h.sourceType))],
			insightCount: 0,
		},
	};
}

const mockEmbedder = { embed: vi.fn() } as never;
const mockVectorIndex = {} as never;
const mockSegments = [] as never[];

describe("evaluateQualityQueries", () => {
	it("passes queries when results meet criteria", async () => {
		mockQuery.mockResolvedValue(
			makeQueryResult([
				{ sourceType: "code", source: "/src/ingest/pipeline.ts", score: 0.9 },
				{ sourceType: "code", source: "/src/ingest/chunker.ts", score: 0.8 },
				{ sourceType: "github-issue", source: "owner/repo#42", score: 0.7 },
			]),
		);
		mockTrace.mockResolvedValue(
			makeTraceResult([
				{ method: "edge", sourceType: "code" },
				{ method: "edge", sourceType: "github-issue" },
				{ method: "semantic", sourceType: "doc-page" },
			]),
		);

		const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
		expect(result.stage).toBe("quality-queries");
		expect(result.metrics.totalQueries).toBe(10);
		expect(typeof result.metrics.passRate).toBe("number");
	});

	it("verdict fail when all queries return 0 results", async () => {
		mockQuery.mockResolvedValue(makeQueryResult([]));
		mockTrace.mockResolvedValue(makeTraceResult([]));

		const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
		expect(result.verdict).toBe("fail");
		expect(result.metrics.passCount).toBe(0);
	});

	it("reports category breakdown", async () => {
		mockQuery.mockResolvedValue(
			makeQueryResult([
				{ sourceType: "code", source: "/src/ingest.ts", score: 0.9 },
				{ sourceType: "github-issue", source: "owner/repo#1", score: 0.8 },
				{ sourceType: "doc-page", source: "https://docs.filecoin.io/page", score: 0.7 },
			]),
		);
		mockTrace.mockResolvedValue(
			makeTraceResult([
				{ method: "edge", sourceType: "code" },
				{ method: "edge", sourceType: "github-issue" },
			]),
		);

		const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
		const breakdown = result.metrics.categoryBreakdown as Record<
			string,
			{ total: number; passed: number; passRate: number }
		>;
		expect(breakdown["direct-lookup"]).toBeDefined();
		expect(breakdown["cross-source"]).toBeDefined();
		expect(breakdown["gap-detection"]).toBeDefined();
		expect(breakdown.synthesis).toBeDefined();
		expect(breakdown["direct-lookup"]?.total).toBe(3);
	});

	it("fails cross-source query when trace has only one source type", async () => {
		mockQuery.mockResolvedValue(
			makeQueryResult([
				{ sourceType: "github-issue", source: "owner/repo#1", score: 0.9 },
				{ sourceType: "github-issue", source: "owner/repo#2", score: 0.8 },
			]),
		);
		// Only one source type in trace — should fail requireCrossSourceHops
		mockTrace.mockResolvedValue(
			makeTraceResult([
				{ method: "edge", sourceType: "github-issue" },
				{ method: "semantic", sourceType: "github-issue" },
			]),
		);

		const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
		const scores = result.metrics.scores as Array<{
			id: string;
			passed: boolean;
			crossSourceFound: boolean;
		}>;
		const csQuery = scores.find((s) => s.id === "cs-1");
		expect(csQuery?.crossSourceFound).toBe(false);
		expect(csQuery?.passed).toBe(false);
	});
});
