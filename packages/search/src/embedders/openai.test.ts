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

	it("throws EmbedFailedError on network failure when retries disabled", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("network down"));

		const embedder = new OpenAIEmbedder({ apiKey: "test-key", maxRetries: 0 });
		await expect(embedder.embed("test")).rejects.toThrow(EmbedFailedError);
	});

	it("retries on network error then succeeds", async () => {
		const embedding = Array.from({ length: 8 }, () => 0.1);
		vi.mocked(globalThis.fetch)
			.mockRejectedValueOnce(new Error("ECONNRESET"))
			.mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({
			apiKey: "test-key",
			maxRetries: 2,
			initialDelayMs: 1,
			maxDelayMs: 2,
		});
		const result = await embedder.embed("test");
		expect(result.length).toBe(8);
		expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(2);
	});

	it("retries on HTTP 429 honoring Retry-After", async () => {
		const embedding = Array.from({ length: 8 }, () => 0.2);
		vi.mocked(globalThis.fetch)
			.mockResolvedValueOnce(
				new Response("Rate limited", {
					status: 429,
					headers: { "retry-after": "0" },
				}),
			)
			.mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({
			apiKey: "test-key",
			maxRetries: 2,
			initialDelayMs: 1,
		});
		const result = await embedder.embed("test");
		expect(result.length).toBe(8);
		expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(2);
	});

	it("retries on HTTP 503 with exponential backoff", async () => {
		const embedding = Array.from({ length: 8 }, () => 0.3);
		vi.mocked(globalThis.fetch)
			.mockResolvedValueOnce(new Response("", { status: 503 }))
			.mockResolvedValueOnce(new Response("", { status: 503 }))
			.mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({
			apiKey: "test-key",
			maxRetries: 3,
			initialDelayMs: 1,
			maxDelayMs: 2,
		});
		const result = await embedder.embed("test");
		expect(result.length).toBe(8);
		expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(3);
	});

	it("retries OpenRouter-style 200-with-error provider failure", async () => {
		const embedding = Array.from({ length: 8 }, () => 0.4);
		vi.mocked(globalThis.fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						error: { message: "No successful provider responses.", code: 404 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({
			apiKey: "test-key",
			maxRetries: 2,
			initialDelayMs: 1,
			maxDelayMs: 2,
			providerErrorBaseDelayMs: 1,
		});
		const result = await embedder.embed("test");
		expect(result.length).toBe(8);
		expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(2);
	});

	it("does not retry on HTTP 401", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			new Response("Unauthorized", { status: 401 }),
		);

		const embedder = new OpenAIEmbedder({
			apiKey: "bad-key",
			maxRetries: 3,
			initialDelayMs: 1,
		});
		await expect(embedder.embed("test")).rejects.toThrow(EmbedFailedError);
		expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(1);
	});

	it("enforces minRequestIntervalMs between successive requests", async () => {
		const embedding = Array.from({ length: 4 }, () => 0.5);
		vi.mocked(globalThis.fetch).mockImplementation(async () =>
			mockResponse([{ embedding, index: 0 }]),
		);

		const embedder = new OpenAIEmbedder({
			apiKey: "test-key",
			minRequestIntervalMs: 100,
		});
		const t0 = Date.now();
		await embedder.embed("a");
		await embedder.embed("b");
		const elapsed = Date.now() - t0;
		// Second request must wait ~100ms after the first
		expect(elapsed).toBeGreaterThanOrEqual(95);
	});

	it("exhausts retries and throws EmbedFailedError", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(new Response("", { status: 503 }));

		const embedder = new OpenAIEmbedder({
			apiKey: "test-key",
			maxRetries: 2,
			initialDelayMs: 1,
			maxDelayMs: 2,
		});
		await expect(embedder.embed("test")).rejects.toThrow(EmbedFailedError);
		expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(3);
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

	it("sends requestDimensions in the API request body", async () => {
		const embedding = Array.from({ length: 256 }, () => 0);
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({
			apiKey: "sk-test",
			model: "text-embedding-3-large",
			requestDimensions: 256,
		});
		await embedder.embed("test");

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const body = JSON.parse(call?.[1]?.body as string);
		expect(body.dimensions).toBe(256);
	});

	it("does not send dimensions when requestDimensions is not set", async () => {
		const embedding = Array.from({ length: 1536 }, () => 0);
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({ apiKey: "sk-test" });
		await embedder.embed("test");

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const body = JSON.parse(call?.[1]?.body as string);
		expect(body.dimensions).toBeUndefined();
	});

	it("applies query prefix to embed() calls", async () => {
		const embedding = Array.from({ length: 768 }, () => 0);
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockResponse([{ embedding, index: 0 }]));

		const embedder = new OpenAIEmbedder({
			apiKey: "sk-test",
			model: "nomic-embed-text",
			prefix: { query: "search_query: ", document: "search_document: " },
		});
		await embedder.embed("test query");

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const body = JSON.parse(call?.[1]?.body as string);
		expect(body.input).toEqual(["search_query: test query"]);
	});

	it("applies document prefix to embedBatch() calls", async () => {
		const embedding = Array.from({ length: 768 }, () => 0);
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(
			mockResponse([
				{ embedding, index: 0 },
				{ embedding, index: 1 },
			]),
		);

		const embedder = new OpenAIEmbedder({
			apiKey: "sk-test",
			model: "nomic-embed-text",
			prefix: { query: "search_query: ", document: "search_document: " },
		});
		await embedder.embedBatch(["doc a", "doc b"]);

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const body = JSON.parse(call?.[1]?.body as string);
		expect(body.input).toEqual(["search_document: doc a", "search_document: doc b"]);
	});
});
