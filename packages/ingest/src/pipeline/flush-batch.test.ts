import type { Chunk, ManifestStore } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { flushBatch } from "./flush-batch.js";
import type { CreateEdgeExtractorFn, LogSink, PublishSegmentFn } from "./types.js";

function makeChunk(id: string): Chunk {
	return {
		id,
		content: `content-${id}`,
		sourceType: "code",
		source: "owner/repo",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
	};
}

function mockDeps() {
	const embedder = {
		embedBatch: vi
			.fn()
			.mockResolvedValue([
				new Float32Array([0.1, 0.2]),
				new Float32Array([0.3, 0.4]),
				new Float32Array([0.5, 0.6]),
			]),
		embed: vi.fn(),
		dimensions: 2,
	};
	const publishSegment: PublishSegmentFn = vi.fn().mockResolvedValue({ resultId: "seg-result-1" });
	const manifests: ManifestStore = {
		getHead: vi.fn().mockResolvedValue(null),
		putHead: vi.fn().mockResolvedValue({ headId: "head-1", manifest: {} }),
		listProjects: vi.fn().mockResolvedValue([]),
	};
	const createEdgeExtractor: CreateEdgeExtractorFn = () => ({
		extract: vi.fn().mockResolvedValue([]),
	});
	const adapterExtractEdges = vi.fn().mockResolvedValue([]);
	const log: LogSink = vi.fn();

	return { embedder, publishSegment, manifests, createEdgeExtractor, adapterExtractEdges, log };
}

describe("flushBatch", () => {
	it("embeds chunks, publishes segment, updates manifest", async () => {
		const deps = mockDeps();
		const chunks = [makeChunk("c1"), makeChunk("c2"), makeChunk("c3")];
		const result = await flushBatch(chunks, {
			embedder: deps.embedder,
			publishSegment: deps.publishSegment,
			manifests: deps.manifests,
			createEdgeExtractor: deps.createEdgeExtractor,
			adapterExtractEdges: deps.adapterExtractEdges,
			collectionName: "test-col",
			collectionId: "col-123",
			modelName: "test-model",
			description: undefined,
			log: deps.log,
			batchNumber: 1,
		});

		expect(deps.embedder.embedBatch).toHaveBeenCalledWith([
			"content-c1",
			"content-c2",
			"content-c3",
		]);
		expect(deps.publishSegment).toHaveBeenCalled();
		expect(deps.manifests.putHead).toHaveBeenCalled();
		expect(result.chunksIngested).toBe(3);
	});

	it("returns immediately for empty batch", async () => {
		const deps = mockDeps();
		const result = await flushBatch([], {
			embedder: deps.embedder,
			publishSegment: deps.publishSegment,
			manifests: deps.manifests,
			createEdgeExtractor: deps.createEdgeExtractor,
			adapterExtractEdges: deps.adapterExtractEdges,
			collectionName: "test-col",
			collectionId: "col-123",
			modelName: "test-model",
			description: undefined,
			log: deps.log,
			batchNumber: 1,
		});

		expect(deps.embedder.embedBatch).not.toHaveBeenCalled();
		expect(result.chunksIngested).toBe(0);
	});

	it("includes batchRecord in manifest when publishSegment returns one", async () => {
		const deps = mockDeps();
		(deps.publishSegment as ReturnType<typeof vi.fn>).mockResolvedValue({
			resultId: "seg-cid-1",
			batchRecord: {
				pieceCid: "piece-1",
				carRootCid: "car-1",
				segmentIds: ["seg-1"],
				createdAt: "2026-01-01",
			},
		});
		const chunks = [makeChunk("c1")];
		// Need embedder to return 1 embedding for 1 chunk
		(deps.embedder.embedBatch as ReturnType<typeof vi.fn>).mockResolvedValue([
			new Float32Array([0.1, 0.2]),
		]);

		await flushBatch(chunks, {
			embedder: deps.embedder,
			publishSegment: deps.publishSegment,
			manifests: deps.manifests,
			createEdgeExtractor: deps.createEdgeExtractor,
			adapterExtractEdges: deps.adapterExtractEdges,
			collectionName: "test-col",
			collectionId: "col-123",
			modelName: "test-model",
			description: undefined,
			log: deps.log,
			batchNumber: 1,
		});

		const putHeadCall = (deps.manifests.putHead as ReturnType<typeof vi.fn>).mock.calls[0];
		const manifest = putHeadCall?.[1];
		expect(manifest?.batches).toHaveLength(1);
		expect(manifest?.batches?.[0]?.pieceCid).toBe("piece-1");
	});
});
