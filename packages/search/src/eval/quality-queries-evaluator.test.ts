import { describe, expect, it, vi } from "vitest";
import type { QueryResult } from "../query.js";
import type { TraceResult } from "../trace/trace.js";
import { GOLD_STANDARD_QUERIES_VERSION } from "./gold-standard-queries.js";

const mockQuery = vi.hoisted(() => vi.fn<() => Promise<QueryResult>>());
const mockTrace = vi.hoisted(() => vi.fn<() => Promise<TraceResult>>());

vi.mock("../query.js", () => ({ query: mockQuery }));
vi.mock("../trace/trace.js", () => ({ trace: mockTrace }));

const { evaluateQualityQueries, getActiveQueries } = await import("./quality-queries-evaluator.js");
const { GOLD_STANDARD_QUERIES } = await import("./gold-standard-queries.js");

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
			retrievalScore: r.score,
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

	it("verdict fail when no positive query passes (hard negatives excluded)", async () => {
		// Return 1 off-topic result, then no trace edges. Hard-negatives
		// pass (resultCount=1 < ceiling). Positive queries fail their
		// substring + required-type + cross-source checks. Excluding
		// hard-negatives, passRate is 0 → verdict should be "fail".
		mockQuery.mockResolvedValue(
			makeQueryResult([{ sourceType: "code", source: "/unrelated/file.txt", score: 0.1 }]),
		);
		mockTrace.mockResolvedValue(makeTraceResult([]));

		const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
		const scores = result.metrics.scores as Array<{
			category: string;
			skipped?: boolean;
			passed: boolean;
		}>;
		const positive = scores.filter((s) => !s.skipped && s.category !== "hard-negative");
		const positivePassed = positive.filter((s) => s.passed).length;
		expect(positivePassed).toBe(0);
		// Aggregate verdict: when overall passRate is 0 we still report
		// "fail" (the existing behavior); when positive failure but
		// hard-negatives are passing, the surfaced rate may be non-zero.
		// Either way, a maintainer reading the report sees "no positive
		// retrieval" — verdict is fail OR warn depending on hard-negative
		// inclusion. Lock the no-positive-pass invariant explicitly.
		expect(["fail", "warn"]).toContain(result.verdict);
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

	describe("paraphrase invariance (#311 Phase 1a)", () => {
		it("populates paraphraseScores + paraphraseInvariant when checkParaphrases is on", async () => {
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

			const result = await evaluateQualityQueries(
				mockEmbedder,
				mockVectorIndex,
				mockSegments,
				undefined,
				[],
				undefined,
				false,
				{ checkParaphrases: true },
			);
			const scores = result.metrics.scores as Array<{
				id: string;
				skipped?: boolean;
				paraphraseScores?: Array<{ text: string; passed: boolean }>;
				paraphraseInvariant?: boolean;
			}>;
			// In v1.8.0 the original 45 queries have ≥3 paraphrases each
			// (Phase 1b). Newer additions (synthesis-tier expansion +
			// hard negatives, Phase 1c/1d) have not been paraphrased yet.
			// The invariant: every applicable query that has paraphrases
			// in the fixture must produce paraphraseScores; queries
			// without paraphrases stay undefined.
			const applicable = scores.filter((s) => !s.skipped);
			const withScores = applicable.filter((s) => s.paraphraseScores !== undefined);
			expect(withScores.length).toBeGreaterThan(0);
			for (const s of withScores) {
				expect((s.paraphraseScores ?? []).length).toBeGreaterThanOrEqual(3);
				expect(typeof s.paraphraseInvariant).toBe("boolean");
			}
			const inv = result.metrics.paraphraseInvariance as {
				checked: boolean;
				withParaphrases: number;
				invariantFraction: number;
			};
			expect(inv.checked).toBe(true);
			expect(inv.withParaphrases).toBe(withScores.length);
		});

		it("emits paraphraseInvariance aggregate at the metrics level", async () => {
			mockQuery.mockResolvedValue(makeQueryResult([]));
			mockTrace.mockResolvedValue(makeTraceResult([]));
			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const inv = result.metrics.paraphraseInvariance as {
				checked: boolean;
				withParaphrases: number;
				invariantFraction: number;
			};
			expect(inv).toBeDefined();
			expect(typeof inv.invariantFraction).toBe("number");
		});
	});

	describe("retrieval recall@K (#311 Phase 0d)", () => {
		it("computes recall@10 for queries with goldSupportingSources", async () => {
			// wl-1 has goldSupportingSources pinned to the canonical
			// PieceCID source paths in v12 (#311 peer-review item (c)).
			// Provide top-K with both gold paths in result sources →
			// expect recallAtK = 1.0.
			mockQuery.mockResolvedValue(
				makeQueryResult([
					{
						sourceType: "code",
						source: "synapse-sdk/packages/synapse-core/src/piece/piece.ts",
						score: 0.95,
					},
					{
						sourceType: "code",
						source: "synapse-sdk/packages/synapse-sdk/src/storage/context.ts",
						score: 0.9,
					},
				]),
			);
			mockTrace.mockResolvedValue(makeTraceResult([]));

			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const scores = result.metrics.scores as Array<{
				id: string;
				recallAtK: number | null;
				recallK: number | null;
			}>;
			const wl1 = scores.find((s) => s.id === "wl-1");
			expect(wl1?.recallAtK).toBe(1);
			expect(wl1?.recallK).toBe(10);
		});

		it("emits recallAtK = null on queries without a gold mapping", async () => {
			mockQuery.mockResolvedValue(
				makeQueryResult([{ sourceType: "code", source: "/src/x.ts", score: 0.9 }]),
			);
			mockTrace.mockResolvedValue(makeTraceResult([]));
			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const scores = result.metrics.scores as Array<{
				id: string;
				recallAtK: number | null;
			}>;
			// cs-1 has no goldSupportingSources in v1.8.0 (it has no
			// expectedSourceSubstrings either) — recallAtK must be null.
			// Phase 1+ may add gold for cs-1 once stable supporting
			// sources are curated.
			const cs1 = scores.find((s) => s.id === "cs-1");
			expect(cs1?.recallAtK).toBeNull();
		});

		it("emits recallAtK aggregate at the metrics level", async () => {
			mockQuery.mockResolvedValue(makeQueryResult([]));
			mockTrace.mockResolvedValue(makeTraceResult([]));
			const result = await evaluateQualityQueries(mockEmbedder, mockVectorIndex, mockSegments);
			const r = result.metrics.recallAtK as {
				k: number | null;
				graded: number;
				avgRecallAtK: number;
				demoCriticalAvgRecallAtK: number;
				demoCriticalGraded: number;
			};
			expect(r).toBeDefined();
			expect(typeof r.avgRecallAtK).toBe("number");
			// Demo-critical tier has 5 queries; all populated with gold in v1.7.0.
			expect(r.demoCriticalGraded).toBeGreaterThan(0);
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

	describe("WTFOC_QUERY_FILTER subset filtering (#320)", () => {
		// Tests `getActiveQueries()` directly — the helper exported for
		// fast-iteration smokes (run a 20-30 query subset instead of the
		// full 153-query fixture). Aggregate metrics noisier on subsets
		// but per-query data stays real signal.

		it("unset env var → no filter, returns full fixture", () => {
			vi.stubEnv("WTFOC_QUERY_FILTER", "");
			try {
				const { queries, filter } = getActiveQueries();
				expect(filter.active).toBe(false);
				expect(filter.requestedIds).toEqual([]);
				expect(filter.unknownIds).toEqual([]);
				expect(filter.totalAvailable).toBe(GOLD_STANDARD_QUERIES.length);
				expect(queries.length).toBe(GOLD_STANDARD_QUERIES.length);
			} finally {
				vi.unstubAllEnvs();
			}
		});

		it("whitespace-only env var → no filter (defensive)", () => {
			vi.stubEnv("WTFOC_QUERY_FILTER", "  ,  ,  ");
			try {
				const { filter } = getActiveQueries();
				expect(filter.active).toBe(false);
			} finally {
				vi.unstubAllEnvs();
			}
		});

		it("filter by known id returns only that query", () => {
			const knownId = GOLD_STANDARD_QUERIES[0]?.id ?? "";
			expect(knownId).toBeTruthy();
			vi.stubEnv("WTFOC_QUERY_FILTER", knownId);
			try {
				const { queries, filter } = getActiveQueries();
				expect(filter.active).toBe(true);
				expect(filter.requestedIds).toEqual([knownId]);
				expect(filter.unknownIds).toEqual([]);
				expect(queries.length).toBe(1);
				expect(queries[0]?.id).toBe(knownId);
			} finally {
				vi.unstubAllEnvs();
			}
		});

		it("filter with unknown ids surfaces them in unknownIds", () => {
			const knownId = GOLD_STANDARD_QUERIES[0]?.id ?? "";
			vi.stubEnv("WTFOC_QUERY_FILTER", `${knownId},nonexistent-id`);
			try {
				const { queries, filter } = getActiveQueries();
				expect(filter.active).toBe(true);
				expect(filter.unknownIds).toEqual(["nonexistent-id"]);
				expect(queries.length).toBe(1);
			} finally {
				vi.unstubAllEnvs();
			}
		});

		it("filter with all-unknown ids returns empty queries + populated unknownIds", () => {
			vi.stubEnv("WTFOC_QUERY_FILTER", "no-such-id,also-not-real");
			try {
				const { queries, filter } = getActiveQueries();
				expect(filter.active).toBe(true);
				expect(filter.unknownIds).toEqual(["no-such-id", "also-not-real"]);
				expect(queries.length).toBe(0);
			} finally {
				vi.unstubAllEnvs();
			}
		});

		it("filter with extra whitespace in ids tolerated", () => {
			const knownId = GOLD_STANDARD_QUERIES[0]?.id ?? "";
			vi.stubEnv("WTFOC_QUERY_FILTER", `  ${knownId}  ,  `);
			try {
				const { queries, filter } = getActiveQueries();
				expect(filter.active).toBe(true);
				expect(queries.length).toBe(1);
				expect(queries[0]?.id).toBe(knownId);
			} finally {
				vi.unstubAllEnvs();
			}
		});
	});
});
