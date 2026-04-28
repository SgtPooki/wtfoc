import { describe, expect, it, vi } from "vitest";
import type { QueryResult } from "../query.js";
import type { TraceResult } from "../trace/trace.js";
import { GOLD_STANDARD_QUERIES_VERSION } from "./gold-standard-queries.js";

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
		chronologicalHopIndices: hops.map((_, i) => i),
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
		expect(result.metrics.totalQueries).toBeGreaterThanOrEqual(20);
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
		expect(breakdown.coverage).toBeDefined();
		expect(breakdown.synthesis).toBeDefined();
		// Direct-lookup category has at least 3 queries (see gold-standard-queries.ts)
		expect(breakdown["direct-lookup"]?.total).toBeGreaterThanOrEqual(3);
	});

	it("passes cross-source query when requiredSourceTypes found in trace hops, not query seeds", async () => {
		// Query results DON'T contain github-issue, but trace DOES reach it
		mockQuery.mockResolvedValue(
			makeQueryResult([
				{ sourceType: "github-pr", source: "owner/repo#10", score: 0.9 },
				{ sourceType: "markdown", source: "docs/readme.md", score: 0.8 },
			]),
		);
		mockTrace.mockResolvedValue(
			makeTraceResult([
				{ method: "edge", sourceType: "github-issue" },
				{ method: "edge", sourceType: "code" },
				{ method: "semantic", sourceType: "github-pr" },
			]),
		);

		const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
		const scores = result.metrics.scores as Array<{
			id: string;
			passed: boolean;
			requiredTypesFound: boolean;
		}>;
		// cs-1 requires github-issue — trace reached it even though query didn't
		const csQuery = scores.find((s) => s.id === "cs-1");
		expect(csQuery?.requiredTypesFound).toBe(true);
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

	describe("query-only vs trace-assisted metric split (#261)", () => {
		it("emits separate passed and passedQueryOnly on each score", async () => {
			mockQuery.mockResolvedValue(
				makeQueryResult([
					{ sourceType: "code", source: "/src/ingest/pipeline.ts", score: 0.9 },
					{ sourceType: "code", source: "/src/ingest/chunker.ts", score: 0.8 },
				]),
			);
			mockTrace.mockResolvedValue(
				makeTraceResult([
					{ method: "edge", sourceType: "code" },
					{ method: "edge", sourceType: "github-issue" },
				]),
			);

			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const scores = result.metrics.scores as Array<{
				id: string;
				passed: boolean;
				passedQueryOnly: boolean;
				requiredTypesFound: boolean;
				requiredTypesFoundQueryOnly: boolean;
			}>;
			// Every score must have the query-only variants populated so dogfood
			// can track retrieval regressions independently of trace rescue.
			for (const s of scores) {
				expect(typeof s.passedQueryOnly).toBe("boolean");
				expect(typeof s.requiredTypesFoundQueryOnly).toBe("boolean");
			}
		});

		it("emits aggregate queryOnlyPassRate alongside passRate", async () => {
			mockQuery.mockResolvedValue(makeQueryResult([]));
			mockTrace.mockResolvedValue(makeTraceResult([]));

			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			expect(typeof result.metrics.queryOnlyPassRate).toBe("number");
			expect(typeof result.metrics.queryOnlyPassCount).toBe("number");
		});

		it("a cross-source query that only passes via trace has passed=true but passedQueryOnly=false", async () => {
			// query returns only github-pr; cs-1 requires github-issue AND code.
			// Trace rescues by reaching github-issue and code via edge hops.
			mockQuery.mockResolvedValue(
				makeQueryResult([
					{ sourceType: "github-pr", source: "owner/repo#10", score: 0.9 },
					{ sourceType: "markdown", source: "docs/readme.md", score: 0.8 },
				]),
			);
			mockTrace.mockResolvedValue(
				makeTraceResult([
					{ method: "edge", sourceType: "github-issue" },
					{ method: "edge", sourceType: "code" },
					{ method: "semantic", sourceType: "github-pr" },
				]),
			);

			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const scores = result.metrics.scores as Array<{
				id: string;
				passed: boolean;
				passedQueryOnly: boolean;
			}>;
			const cs = scores.find((s) => s.id === "cs-1");
			expect(cs).toBeDefined();
			expect(cs?.passed).toBe(true); // trace rescued it
			expect(cs?.passedQueryOnly).toBe(false); // query alone missed required types
		});
	});

	describe("evidence-diversity per query (#311 Phase 0e)", () => {
		it("counts distinct sources + source-types across query + trace", async () => {
			mockQuery.mockResolvedValue(
				makeQueryResult([
					{ sourceType: "code", source: "/src/a.ts", score: 0.9 },
					{ sourceType: "code", source: "/src/b.ts", score: 0.8 },
					{ sourceType: "github-issue", source: "owner/repo#1", score: 0.7 },
				]),
			);
			mockTrace.mockResolvedValue(
				makeTraceResult([
					{ method: "edge", sourceType: "markdown" },
					{ method: "semantic", sourceType: "code" },
				]),
			);

			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const scores = result.metrics.scores as Array<{
				skipped?: boolean;
				distinctDocs: number;
				distinctSourceTypes: number;
			}>;
			const applicable = scores.filter((s) => !s.skipped);
			expect(applicable.length).toBeGreaterThan(0);
			// Trace helper hardcodes source="test" for all hops, so every
			// applicable score should see distinctDocs >= 1.
			for (const s of applicable) {
				expect(s.distinctDocs).toBeGreaterThanOrEqual(1);
				expect(s.distinctSourceTypes).toBeGreaterThanOrEqual(1);
			}
		});

		it("emits evidenceDiversity aggregate at the metrics level", async () => {
			mockQuery.mockResolvedValue(makeQueryResult([]));
			mockTrace.mockResolvedValue(makeTraceResult([]));
			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const ed = result.metrics.evidenceDiversity as {
				passingAvgDistinctDocs: number;
				applicableAvgDistinctDocs: number;
				passingCount: number;
				applicableCount: number;
			};
			expect(ed).toBeDefined();
			expect(typeof ed.applicableAvgDistinctDocs).toBe("number");
			expect(typeof ed.passingAvgDistinctDocs).toBe("number");
			expect(ed.applicableCount).toBeGreaterThan(0);
		});
	});

	describe("fixture versioning and determinism (#261)", () => {
		it("emits the gold-queries fixture version in metrics (equals exported constant)", async () => {
			mockQuery.mockResolvedValue(
				makeQueryResult([{ sourceType: "code", source: "/src/x.ts", score: 0.9 }]),
			);
			mockTrace.mockResolvedValue(makeTraceResult([]));
			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			// Asserting equality against the exported constant — not just the
			// shape — so stripping the version export or forking the evaluator
			// to hardcode a different string is caught here.
			expect(result.metrics.goldQueriesVersion).toBe(GOLD_STANDARD_QUERIES_VERSION);
			expect(result.metrics.goldQueriesVersion).toMatch(/^\d+\.\d+\.\d+$/);
		});

		it("produces identical scores across back-to-back runs with identical mocks", async () => {
			// Scope note: query() and trace() are mocked to return fixed data,
			// so this catches non-determinism downstream of those calls —
			// scoring, category breakdown, lineage aggregation, check ordering.
			// It does NOT cover non-determinism inside the real vector index,
			// reranker, or trace traversal; an integration-level fixture would
			// be needed for that.
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

			const run1 = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const run2 = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);

			// Deterministic slice: everything except wall-clock and duration.
			const deterministic = (r: typeof run1) => ({
				stage: r.stage,
				verdict: r.verdict,
				summary: r.summary,
				checks: r.checks,
				metrics: {
					goldQueriesVersion: r.metrics.goldQueriesVersion,
					passRate: r.metrics.passRate,
					passCount: r.metrics.passCount,
					queryOnlyPassRate: r.metrics.queryOnlyPassRate,
					queryOnlyPassCount: r.metrics.queryOnlyPassCount,
					totalQueries: r.metrics.totalQueries,
					categoryBreakdown: r.metrics.categoryBreakdown,
					scores: r.metrics.scores,
					lineage: r.metrics.lineage,
				},
			});

			expect(deterministic(run2)).toEqual(deterministic(run1));
		});
	});
});
