import { describe, expect, it, vi } from "vitest";

// Mock the transformers module before importing TransformersEmbedder
const mockExtractor = vi.fn();
const mockPipeline = vi.fn().mockResolvedValue(mockExtractor);

vi.mock("@huggingface/transformers", () => ({
	pipeline: mockPipeline,
}));

const { TransformersEmbedder } = await import("./transformers.js");

function fakeTensor(dims: number[], data: Float32Array) {
	return { data, dims, type: "float32", size: data.length };
}

describe("TransformersEmbedder", () => {
	it("returns Float32Array with correct dimensions", async () => {
		const embedding = new Float32Array(384).fill(0.1);
		mockExtractor.mockResolvedValueOnce(fakeTensor([1, 384], embedding));

		const embedder = new TransformersEmbedder();
		const result = await embedder.embed("hello world");

		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(384);
		expect(embedder.dimensions).toBe(384);
	});

	it("calls pipeline with mean pooling and normalization", async () => {
		const embedding = new Float32Array(384).fill(0.1);
		mockExtractor.mockResolvedValueOnce(fakeTensor([1, 384], embedding));

		const embedder = new TransformersEmbedder();
		await embedder.embed("test");

		expect(mockExtractor).toHaveBeenCalledWith("test", {
			pooling: "mean",
			normalize: true,
		});
	});

	it("lazy-inits the model on first call", async () => {
		mockPipeline.mockClear();
		const embedding = new Float32Array(384).fill(0.1);
		mockExtractor.mockResolvedValue(fakeTensor([1, 384], embedding));

		const embedder = new TransformersEmbedder();
		expect(mockPipeline).not.toHaveBeenCalled();

		await embedder.embed("first");
		expect(mockPipeline).toHaveBeenCalledOnce();
		expect(mockPipeline).toHaveBeenCalledWith(
			"feature-extraction",
			"Xenova/all-MiniLM-L6-v2",
			expect.objectContaining({ dtype: "fp32" }),
		);

		await embedder.embed("second");
		expect(mockPipeline).toHaveBeenCalledOnce(); // not called again
	});

	it("embedBatch returns array of Float32Arrays", async () => {
		const batch = new Float32Array(384 * 3);
		for (let i = 0; i < 3; i++) batch.fill(i * 0.1, i * 384, (i + 1) * 384);
		mockExtractor.mockResolvedValueOnce(fakeTensor([3, 384], batch));

		const embedder = new TransformersEmbedder();
		const results = await embedder.embedBatch(["a", "b", "c"]);

		expect(results).toHaveLength(3);
		for (const r of results) {
			expect(r).toBeInstanceOf(Float32Array);
			expect(r.length).toBe(384);
		}
		// Each embedding should have distinct values
		expect(results[0]?.[0]).toBeCloseTo(0);
		expect(results[1]?.[0]).toBeCloseTo(0.1);
		expect(results[2]?.[0]).toBeCloseTo(0.2);
	});

	it("rejects when AbortSignal is already aborted", async () => {
		const embedder = new TransformersEmbedder();
		const controller = new AbortController();
		controller.abort();

		await expect(embedder.embed("test", controller.signal)).rejects.toThrow();
	});

	it("wraps pipeline init failures in EmbedFailedError", async () => {
		mockPipeline.mockRejectedValueOnce(new Error("download failed"));

		const embedder = new TransformersEmbedder("bad-model");
		await expect(embedder.embed("test")).rejects.toThrow("Embedding failed");
	});
});
