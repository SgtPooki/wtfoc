import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BgeReranker } from "./bge.js";

describe("BgeReranker", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function mockSidecarResponse(results: Array<{ id: string; score: number }>) {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ results }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}

	it("calls POST /rerank on the sidecar URL", async () => {
		mockSidecarResponse([{ id: "a", score: 0.9 }]);

		const reranker = new BgeReranker({ url: "http://localhost:8385" });
		await reranker.rerank("test query", [{ id: "a", text: "doc a" }]);

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:8385/rerank",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("sends query, candidates, and top_n in request body", async () => {
		mockSidecarResponse([{ id: "b", score: 0.8 }]);

		const reranker = new BgeReranker({ url: "http://localhost:8385" });
		await reranker.rerank(
			"my query",
			[
				{ id: "a", text: "doc a" },
				{ id: "b", text: "doc b" },
			],
			{ topN: 1 },
		);

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const body = JSON.parse((call?.[1] as RequestInit)?.body as string);
		expect(body.query).toBe("my query");
		expect(body.candidates).toHaveLength(2);
		expect(body.top_n).toBe(1);
	});

	it("returns results in the order returned by the sidecar", async () => {
		mockSidecarResponse([
			{ id: "b", score: 0.9 },
			{ id: "a", score: 0.4 },
		]);

		const reranker = new BgeReranker({ url: "http://localhost:8385" });
		const results = await reranker.rerank("test query", [
			{ id: "a", text: "doc a" },
			{ id: "b", text: "doc b" },
		]);

		expect(results[0]?.id).toBe("b");
		expect(results[0]?.score).toBe(0.9);
		expect(results[1]?.id).toBe("a");
	});

	it("returns empty array for empty candidates without calling the sidecar", async () => {
		const reranker = new BgeReranker({ url: "http://localhost:8385" });
		const results = await reranker.rerank("test query", []);

		expect(results).toEqual([]);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("throws on non-200 response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response("internal error", { status: 500 }),
		);

		const reranker = new BgeReranker({ url: "http://localhost:8385" });
		await expect(reranker.rerank("test query", [{ id: "a", text: "doc a" }])).rejects.toThrow(
			"BGE rerank failed: 500",
		);
	});

	it("strips trailing slash from URL", async () => {
		mockSidecarResponse([{ id: "a", score: 0.9 }]);

		const reranker = new BgeReranker({ url: "http://localhost:8385/" });
		await reranker.rerank("test query", [{ id: "a", text: "doc a" }]);

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		expect(call?.[0]).toBe("http://localhost:8385/rerank");
	});
});
