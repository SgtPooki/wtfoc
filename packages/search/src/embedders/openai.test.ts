import { EmbedFailedError } from "@wtfoc/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIEmbedder } from "./openai.js";

function mockResponse(data: Array<{ embedding: number[]; index: number }>): Response {
	return new Response(JSON.stringify({ data }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("OpenAIEmbedder", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("throws EmbedFailedError when API key is missing", () => {
		expect(() => new OpenAIEmbedder({ apiKey: "" })).toThrow(EmbedFailedError);
	});

	it("embed returns Float32Array with correct dimensions", async () => {
		const embedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({ apiKey: "test-key" });
		const result = await embedder.embed("hello");

		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(1536);
		expect(embedder.dimensions).toBe(1536);
	});

	it("sends correct request to OpenAI API", async () => {
		const embedding = Array.from({ length: 1536 }, () => 0);
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({ apiKey: "sk-test" });
		await embedder.embed("test text");

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://api.openai.com/v1/embeddings",
			expect.objectContaining({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer sk-test",
				},
				body: JSON.stringify({
					model: "text-embedding-3-small",
					input: ["test text"],
				}),
			}),
		);
	});

	it("embedBatch returns array sorted by index", async () => {
		const e1 = Array.from({ length: 1536 }, () => 0.1);
		const e2 = Array.from({ length: 1536 }, () => 0.2);
		// Response has reversed order
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			mockResponse([
				{ embedding: e2, index: 1 },
				{ embedding: e1, index: 0 },
			]),
		);

		const embedder = new OpenAIEmbedder({ apiKey: "test-key" });
		const results = await embedder.embedBatch(["a", "b"]);

		expect(results).toHaveLength(2);
		expect(results[0]?.[0]).toBeCloseTo(0.1);
		expect(results[1]?.[0]).toBeCloseTo(0.2);
	});

	it("throws EmbedFailedError on HTTP error", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response("Unauthorized", { status: 401 }),
		);

		const embedder = new OpenAIEmbedder({ apiKey: "bad-key" });
		await expect(embedder.embed("test")).rejects.toThrow(EmbedFailedError);
	});

	it("throws EmbedFailedError on network failure", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("network down"));

		const embedder = new OpenAIEmbedder({ apiKey: "test-key" });
		await expect(embedder.embed("test")).rejects.toThrow(EmbedFailedError);
	});

	it("supports custom base URL", async () => {
		const embedding = Array.from({ length: 768 }, () => 0);
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({
			apiKey: "test-key",
			baseUrl: "https://custom.api/v1/embeddings",
			dimensions: 768,
		});
		await embedder.embed("test");

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://custom.api/v1/embeddings",
			expect.anything(),
		);
	});

	it("rejects when AbortSignal is already aborted", async () => {
		const embedder = new OpenAIEmbedder({ apiKey: "test-key" });
		const controller = new AbortController();
		controller.abort();

		await expect(embedder.embed("test", controller.signal)).rejects.toThrow();
	});
});
