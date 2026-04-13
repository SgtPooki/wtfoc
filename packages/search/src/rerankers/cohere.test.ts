import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CohereReranker } from "./cohere.js";

describe("CohereReranker", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("sends the correct request shape to the Cohere API", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const reranker = new CohereReranker({ apiKey: "cohere-test" });
		await reranker.rerank("test query", [{ id: "a", text: "doc a" }], { topN: 1 });

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://api.cohere.com/v2/rerank",
			expect.objectContaining({
				method: "POST",
				headers: {
					Authorization: "Bearer cohere-test",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "rerank-v3.5",
					query: "test query",
					documents: ["doc a"],
					top_n: 1,
					return_documents: false,
				}),
			}),
		);
	});

	it("maps Cohere index-based results back to candidate ids", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					results: [
						{ index: 1, relevance_score: 0.8 },
						{ index: 0, relevance_score: 0.4 },
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);

		const reranker = new CohereReranker({ apiKey: "cohere-test" });
		const results = await reranker.rerank("test query", [
			{ id: "a", text: "doc a" },
			{ id: "b", text: "doc b" },
		]);

		expect(results).toEqual([
			{ id: "b", score: 0.8 },
			{ id: "a", score: 0.4 },
		]);
	});

	it("throws on non-200 response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("bad request", { status: 400 }));

		const reranker = new CohereReranker({ apiKey: "cohere-test" });

		await expect(reranker.rerank("test query", [{ id: "a", text: "doc a" }])).rejects.toThrow(
			"Cohere rerank failed: 400 bad request",
		);
	});

	it("respects topN option", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.9 }] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const reranker = new CohereReranker({ apiKey: "cohere-test" });
		await reranker.rerank(
			"test query",
			[
				{ id: "a", text: "doc a" },
				{ id: "b", text: "doc b" },
			],
			{ topN: 1 },
		);

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const body = JSON.parse((call?.[1] as RequestInit | undefined)?.body as string);
		expect(body.top_n).toBe(1);
	});

	it("returns an empty array for empty candidates without calling the API", async () => {
		const reranker = new CohereReranker({ apiKey: "cohere-test" });
		const results = await reranker.rerank("test query", []);

		expect(results).toEqual([]);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
});
