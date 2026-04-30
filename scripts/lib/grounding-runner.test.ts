import type { Embedder, ScoredEntry, VectorEntry, VectorIndex } from "@wtfoc/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult } from "@wtfoc/search";

const mockSearchQuery = vi.hoisted(() => vi.fn<() => Promise<QueryResult>>());
vi.mock("@wtfoc/search", () => ({ query: mockSearchQuery }));

const { runGrounding } = await import("./grounding-runner.js");

const mockEmbedder = { embed: vi.fn() } as unknown as Embedder;
const mockVectorIndex: VectorIndex = {
	add: async () => {},
	search: async () => [] as ScoredEntry[],
	delete: async () => {},
	get size() {
		return 0;
	},
};
function entry(id: string, source: string, content: string): VectorEntry {
	return {
		id,
		vector: new Float32Array(0),
		storageId: id,
		metadata: { source, content, sourceType: "code" },
	};
}

describe("runGrounding", () => {
	const originalFetch = globalThis.fetch;
	let fetchCalls: number;
	let nextResponses: string[];

	beforeEach(() => {
		fetchCalls = 0;
		nextResponses = [];
		globalThis.fetch = vi.fn(async () => {
			const body = nextResponses.shift() ?? "{}";
			fetchCalls++;
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: body } }],
					usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
					model: "qwen3.6-27b",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as typeof fetch;
		mockSearchQuery.mockResolvedValue({
			query: "test",
			results: [
				{
					...entry("c1", "/src/x.ts", "function deposit() {}"),
					content: "function deposit() {}",
					sourceType: "code",
					source: "/src/x.ts",
					score: 0.9,
					retrievalScore: 0.9,
				},
			],
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("synthesizes claims, grades them, and computes hallucination rate", async () => {
		nextResponses = [
			JSON.stringify({
				answer: "The system has a deposit function.",
				claims: ["A deposit function exists.", "It is in /src/x.ts."],
			}),
			JSON.stringify({
				grades: [
					{ claim: "A deposit function exists.", verdict: "supported", evidence: [1] },
					{ claim: "It is in /src/x.ts.", verdict: "unsupported", evidence: [] },
				],
			}),
		];

		const sinkCalls: string[] = [];
		const result = await runGrounding({
			queries: [{ id: "syn-1", queryText: "Where is deposit?" }],
			synthesizer: { url: "http://localhost:1/v1", model: "haiku" },
			grader: { url: "http://localhost:2/v1", model: "qwen3.6-27b" },
			embedder: mockEmbedder,
			vectorIndex: mockVectorIndex,
			topK: 10,
			synthesizerUsageSink: () => sinkCalls.push("synth"),
			graderUsageSink: () => sinkCalls.push("grader"),
		});

		expect(fetchCalls).toBe(2);
		expect(sinkCalls).toEqual(["synth", "grader"]);
		const q = result.perQuery[0];
		expect(q?.claims).toHaveLength(2);
		expect(q?.supported).toBe(1);
		expect(q?.unsupported).toBe(1);
		expect(q?.partial).toBe(0);
		expect(q?.hallucinationRate).toBe(0.5);
		expect(result.aggregate.queriesGraded).toBe(1);
		expect(result.aggregate.totalClaims).toBe(2);
		expect(result.aggregate.avgHallucinationRate).toBe(0.5);
		expect(result.aggregate.graderModel).toBe("qwen3.6-27b");
	});

	it("skips grading when synthesizer emits zero claims", async () => {
		nextResponses = [JSON.stringify({ answer: "no support found", claims: [] })];

		const result = await runGrounding({
			queries: [{ id: "syn-2", queryText: "x?" }],
			synthesizer: { url: "http://localhost:1/v1", model: "haiku" },
			grader: { url: "http://localhost:2/v1", model: "qwen3.6-27b" },
			embedder: mockEmbedder,
			vectorIndex: mockVectorIndex,
			topK: 10,
			synthesizerUsageSink: () => {},
			graderUsageSink: () => {},
		});

		expect(fetchCalls).toBe(1); // only synth, no grader call
		expect(result.perQuery[0]?.grades).toHaveLength(0);
	});

	it("captures errors per-query without aborting the batch", async () => {
		// First query: synthesizer returns malformed JSON → parse error.
		// Second query: succeeds.
		nextResponses = [
			"not json",
			JSON.stringify({ answer: "ok", claims: ["a"] }),
			JSON.stringify({
				grades: [{ claim: "a", verdict: "supported", evidence: [1] }],
			}),
		];

		const result = await runGrounding({
			queries: [
				{ id: "syn-1", queryText: "fail" },
				{ id: "syn-2", queryText: "ok" },
			],
			synthesizer: { url: "http://localhost:1/v1", model: "haiku" },
			grader: { url: "http://localhost:2/v1", model: "qwen3.6-27b" },
			embedder: mockEmbedder,
			vectorIndex: mockVectorIndex,
			topK: 10,
			synthesizerUsageSink: () => {},
			graderUsageSink: () => {},
		});

		expect(result.perQuery[0]?.error).toBeDefined();
		expect(result.perQuery[1]?.error).toBeUndefined();
		expect(result.perQuery[1]?.supported).toBe(1);
		expect(result.aggregate.queriesGraded).toBe(1);
	});
});
