import type { Chunk } from "@wtfoc/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmEdgeExtractor } from "./llm.js";

function makeChunk(content: string, id = "chunk-1"): Chunk {
	return {
		id,
		content,
		sourceType: "github-pr",
		source: "owner/repo#42",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
	};
}

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
	mockFetch.mockReset();
});

function mockLlmResponse(edges: unknown[]): void {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: async () => ({
			choices: [{ message: { content: JSON.stringify(edges) } }],
			usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
		}),
	});
}

function mockLlmError(status = 500): void {
	mockFetch.mockResolvedValueOnce({
		ok: false,
		status,
		statusText: "Internal Server Error",
		text: async () => "error",
	});
}

describe("LlmEdgeExtractor", () => {
	const options = {
		baseUrl: "http://localhost:1234/v1",
		model: "test-model",
		timeoutMs: 5000,
	};

	it("extracts valid edges from LLM response", async () => {
		const extractor = new LlmEdgeExtractor(options);
		mockLlmResponse([
			{
				type: "implements",
				sourceId: "chunk-1",
				targetType: "concept",
				targetId: "caching layer",
				evidence: "implements the caching layer",
				confidence: 0.8,
			},
		]);

		const edges = await extractor.extract([makeChunk("This PR implements the caching layer")]);
		expect(edges).toHaveLength(1);
		expect(edges[0]).toMatchObject({
			type: "implements",
			targetId: "caching layer",
			confidence: 0.8,
		});
	});

	it("rejects edges with empty evidence", async () => {
		const extractor = new LlmEdgeExtractor(options);
		mockLlmResponse([
			{
				type: "references",
				sourceId: "chunk-1",
				targetType: "issue",
				targetId: "#42",
				evidence: "",
				confidence: 0.7,
			},
		]);

		const edges = await extractor.extract([makeChunk("Some text")]);
		expect(edges).toHaveLength(0);
	});

	it("rejects edges with sourceId not in input chunks", async () => {
		const extractor = new LlmEdgeExtractor(options);
		mockLlmResponse([
			{
				type: "references",
				sourceId: "unknown-chunk",
				targetType: "issue",
				targetId: "#42",
				evidence: "some evidence",
				confidence: 0.7,
			},
		]);

		const edges = await extractor.extract([makeChunk("Some text")]);
		expect(edges).toHaveLength(0);
	});

	it("clamps confidence to LLM tier (0.3-0.8)", async () => {
		const extractor = new LlmEdgeExtractor(options);
		mockLlmResponse([
			{
				type: "references",
				sourceId: "chunk-1",
				targetType: "concept",
				targetId: "test",
				evidence: "evidence here",
				confidence: 1.0, // too high
			},
			{
				type: "references",
				sourceId: "chunk-1",
				targetType: "concept",
				targetId: "test2",
				evidence: "more evidence",
				confidence: 0.1, // too low
			},
		]);

		const edges = await extractor.extract([makeChunk("Some text")]);
		expect(edges).toHaveLength(2);
		expect(edges[0]?.confidence).toBe(0.8);
		expect(edges[1]?.confidence).toBe(0.3);
	});

	it("returns empty array on LLM error (fail-open)", async () => {
		const extractor = new LlmEdgeExtractor(options);
		mockLlmError(500);

		const edges = await extractor.extract([makeChunk("Some text")]);
		expect(edges).toEqual([]);
	});

	it("returns empty array on malformed JSON response", async () => {
		const extractor = new LlmEdgeExtractor(options);
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "not valid json at all" } }],
			}),
		});

		const edges = await extractor.extract([makeChunk("Some text")]);
		expect(edges).toEqual([]);
	});

	it("returns empty array for empty chunk list", async () => {
		const extractor = new LlmEdgeExtractor(options);
		const edges = await extractor.extract([]);
		expect(edges).toEqual([]);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("respects AbortSignal", async () => {
		const extractor = new LlmEdgeExtractor(options);
		const controller = new AbortController();
		controller.abort();

		await expect(extractor.extract([makeChunk("text")], controller.signal)).rejects.toThrow();
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("handles fenced JSON block response", async () => {
		const extractor = new LlmEdgeExtractor(options);
		const edges = [
			{
				type: "discusses",
				sourceId: "chunk-1",
				targetType: "concept",
				targetId: "auth",
				evidence: "discussed auth",
				confidence: 0.6,
			},
		];
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(edges)}\n\`\`\`` } }],
			}),
		});

		const result = await extractor.extract([makeChunk("discussed auth system")]);
		expect(result).toHaveLength(1);
		expect(result[0]?.targetId).toBe("auth");
	});
});
