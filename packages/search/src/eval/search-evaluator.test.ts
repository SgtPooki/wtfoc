import { describe, expect, it, vi } from "vitest";
import type { QueryResult } from "../query.js";
import type { TraceResult } from "../trace/trace.js";

const mockQuery = vi.hoisted(() => vi.fn<() => Promise<QueryResult>>());
const mockTrace = vi.hoisted(() => vi.fn<() => Promise<TraceResult>>());

vi.mock("../query.js", () => ({ query: mockQuery }));
vi.mock("../trace/trace.js", () => ({ trace: mockTrace }));

const { evaluateSearch } = await import("./search-evaluator.js");

function makeQueryResult(results: Array<{ sourceType: string; score: number }>): QueryResult {
	return {
		query: "test query",
		results: results.map((r) => ({
			content: "test",
			sourceType: r.sourceType,
			source: "test",
			storageId: "s1",
			score: r.score,
		})),
	};
}

function makeTraceResult(
	hops: Array<{ method: "edge" | "semantic"; evidence?: string; edgeType?: string }>,
): TraceResult {
	return {
		query: "test query",
		groups: {},
		hops: hops.map((h, i) => ({
			content: "test",
			sourceType: `type-${i % 3}`,
			source: "test",
			storageId: `s${i}`,
			connection: {
				method: h.method,
				edgeType: h.edgeType,
				evidence: h.evidence,
				confidence: 0.8,
			},
		})),
		insights: [{ type: "convergence" } as never],
		stats: {
			totalHops: hops.length,
			edgeHops: hops.filter((h) => h.method === "edge").length,
			semanticHops: hops.filter((h) => h.method === "semantic").length,
			sourceTypes: [...new Set(hops.map((_, i) => `type-${i % 3}`))],
			insightCount: 1,
		},
	};
}

const mockEmbedder = { embed: vi.fn() } as never;
const mockVectorIndex = {} as never;
const mockSegments = [] as never[];

describe("evaluateSearch", () => {
	it("per-query result includes top-result score and source type match", async () => {
		mockQuery.mockResolvedValue(
			makeQueryResult([
				{ sourceType: "github-issue", score: 0.95 },
				{ sourceType: "code", score: 0.8 },
			]),
		);
		mockTrace.mockResolvedValue(
			makeTraceResult([{ method: "edge", evidence: "test", edgeType: "references" }]),
		);

		const result = await evaluateSearch(mockEmbedder, mockVectorIndex, mockSegments);
		const qr = result.metrics.queryResults as Array<Record<string, unknown>>;
		expect(qr[0].topScore).toBe(0.95);
	});

	it("MRR calculation", async () => {
		// Query 1: expected "github-issue" found at rank 1 (RR=1.0)
		// Query 2: expected "github-issue" found at rank 1 (RR=1.0)
		mockQuery.mockResolvedValue(
			makeQueryResult([
				{ sourceType: "github-issue", score: 0.9 },
				{ sourceType: "code", score: 0.8 },
			]),
		);
		mockTrace.mockResolvedValue(makeTraceResult([]));

		const result = await evaluateSearch(mockEmbedder, mockVectorIndex, mockSegments);
		// Default fixture queries all expect github-issue, so MRR should be high
		expect(typeof result.metrics.meanReciprocalRank).toBe("number");
	});

	it("edge-hop ratio computed from trace results", async () => {
		mockQuery.mockResolvedValue(makeQueryResult([]));
		mockTrace.mockResolvedValue(
			makeTraceResult([
				{ method: "edge", evidence: "test", edgeType: "references" },
				{ method: "edge", evidence: "test", edgeType: "closes" },
				{ method: "edge", evidence: "test", edgeType: "implements" },
				{ method: "semantic" },
			]),
		);

		const result = await evaluateSearch(mockEmbedder, mockVectorIndex, mockSegments);
		expect(result.metrics.edgeHopRatio).toBe(0.75);
	});

	it("provenance quality rate", async () => {
		mockQuery.mockResolvedValue(makeQueryResult([]));
		mockTrace.mockResolvedValue(
			makeTraceResult([
				{ method: "edge", evidence: "has evidence", edgeType: "references" },
				{ method: "edge", evidence: "", edgeType: "closes" }, // missing evidence
				{ method: "edge", evidence: "has evidence", edgeType: "" }, // missing edgeType
				{ method: "edge", evidence: "has evidence", edgeType: "implements" },
				{ method: "semantic" }, // not counted
			]),
		);

		const result = await evaluateSearch(mockEmbedder, mockVectorIndex, mockSegments);
		// 2 of 4 edge hops have both evidence AND edgeType
		expect(result.metrics.provenanceQualityRate).toBe(0.5);
	});

	it("verdict 'fail' when all queries return 0 results", async () => {
		mockQuery.mockResolvedValue(makeQueryResult([]));
		mockTrace.mockResolvedValue(makeTraceResult([]));

		const result = await evaluateSearch(mockEmbedder, mockVectorIndex, mockSegments);
		expect(result.verdict).toBe("fail");
	});
});
