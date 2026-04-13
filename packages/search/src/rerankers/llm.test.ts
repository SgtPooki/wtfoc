import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmReranker } from "./llm.js";

describe("LlmReranker", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function mockLlmResponse(scores: Record<string, number>) {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify(
									Object.entries(scores).map(([id, score]) => ({ id, score })),
								),
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
	}

	it("calls the chat/completions endpoint with the correct URL", async () => {
		mockLlmResponse({ a: 0.9 });

		const reranker = new LlmReranker({ baseUrl: "http://localhost:4523/v1", model: "haiku" });
		await reranker.rerank("test query", [{ id: "a", text: "doc a" }]);

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:4523/v1/chat/completions",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("maps LLM scores back to candidate ids in descending score order", async () => {
		mockLlmResponse({ a: 0.3, b: 0.9, c: 0.6 });

		const reranker = new LlmReranker({ baseUrl: "http://localhost:4523/v1", model: "haiku" });
		const results = await reranker.rerank("test query", [
			{ id: "a", text: "doc a" },
			{ id: "b", text: "doc b" },
			{ id: "c", text: "doc c" },
		]);

		expect(results[0]?.id).toBe("b");
		expect(results[1]?.id).toBe("c");
		expect(results[2]?.id).toBe("a");
		expect(results[0]?.score).toBe(0.9);
	});

	it("respects topN by slicing results", async () => {
		mockLlmResponse({ a: 0.3, b: 0.9, c: 0.6 });

		const reranker = new LlmReranker({ baseUrl: "http://localhost:4523/v1", model: "haiku" });
		const results = await reranker.rerank(
			"test query",
			[
				{ id: "a", text: "doc a" },
				{ id: "b", text: "doc b" },
				{ id: "c", text: "doc c" },
			],
			{ topN: 2 },
		);

		expect(results).toHaveLength(2);
		expect(results[0]?.id).toBe("b");
	});

	it("falls back to input order when LLM returns empty or unparseable response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					choices: [{ message: { content: "sorry I cannot do that" } }],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);

		const reranker = new LlmReranker({ baseUrl: "http://localhost:4523/v1", model: "haiku" });
		const results = await reranker.rerank("test query", [
			{ id: "a", text: "doc a" },
			{ id: "b", text: "doc b" },
		]);

		// Fallback: original order preserved
		expect(results.map((r) => r.id)).toEqual(["a", "b"]);
	});

	it("returns empty array for empty candidates without calling the API", async () => {
		const reranker = new LlmReranker({ baseUrl: "http://localhost:4523/v1", model: "haiku" });
		const results = await reranker.rerank("test query", []);

		expect(results).toEqual([]);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("throws on non-200 response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response("internal server error", { status: 500 }),
		);

		const reranker = new LlmReranker({ baseUrl: "http://localhost:4523/v1", model: "haiku" });
		await expect(reranker.rerank("test query", [{ id: "a", text: "doc a" }])).rejects.toThrow(
			"LLM rerank failed: 500",
		);
	});

	it("includes Authorization header when apiKey is provided", async () => {
		mockLlmResponse({ a: 0.9 });

		const reranker = new LlmReranker({
			baseUrl: "http://localhost:4523/v1",
			model: "haiku",
			apiKey: "test-key",
		});
		await reranker.rerank("test query", [{ id: "a", text: "doc a" }]);

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const headers = (call?.[1] as RequestInit)?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer test-key");
	});
});
