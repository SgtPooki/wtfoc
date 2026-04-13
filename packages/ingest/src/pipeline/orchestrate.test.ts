import type { Chunk } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { orchestrate } from "./orchestrate.js";
import type { IngestOptions, OrchestrateDeps } from "./types.js";

function makeChunk(id: string, overrides: Partial<Chunk> = {}): Chunk {
	return {
		id,
		content: `content-${id}`,
		sourceType: "code",
		source: "owner/repo",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
		documentId: `doc-${id}`,
		documentVersionId: `v-${id}`,
		contentFingerprint: `fp-${id}`,
		...overrides,
	};
}

function makeDeps(chunks: Chunk[]): OrchestrateDeps {
	async function* fakeIngest() {
		for (const c of chunks) yield c;
	}

	return {
		store: {
			storage: {
				upload: vi.fn().mockResolvedValue({ id: "storage-1" }),
				download: vi.fn().mockResolvedValue(new Uint8Array()),
			},
			manifests: {
				getHead: vi.fn().mockResolvedValue(null),
				putHead: vi.fn().mockResolvedValue({ headId: "head-1", manifest: {} }),
				listProjects: vi.fn().mockResolvedValue([]),
			},
		},
		embedder: {
			embedBatch: vi
				.fn()
				.mockImplementation((texts: string[]) =>
					Promise.resolve(texts.map(() => new Float32Array([0.1, 0.2]))),
				),
			embed: vi.fn(),
			dimensions: 2,
		},
		adapter: {
			sourceType: "code",
			parseConfig: vi.fn(),
			ingest: vi.fn().mockReturnValue(fakeIngest()),
			extractEdges: vi.fn().mockResolvedValue([]),
		},
		publishSegment: vi.fn().mockResolvedValue({ resultId: "seg-1" }),
		createEdgeExtractor: () => ({
			extract: vi.fn().mockResolvedValue([]),
		}),
		log: vi.fn(),
	};
}

function makeOptions(overrides: Partial<IngestOptions> = {}): IngestOptions {
	return {
		collectionName: "test-col",
		collectionId: "col-123",
		sourceType: "repo",
		sourceKey: "repo:owner/repo",
		adapterConfig: {},
		maxBatch: 500,
		maxChunkChars: 10000,
		isPartialRun: false,
		filters: { documentIds: null, sourcePaths: null, changedSinceMs: null },
		modelName: "test-model",
		sourceReuse: false,
		appendOnlyTypes: new Set(["hn-story", "hn-comment"]),
		extractorConfig: null,
		treeSitterUrl: null,
		...overrides,
	};
}

describe("orchestrate", () => {
	it("returns IngestResult with correct stats for 3 chunks", async () => {
		const chunks = [makeChunk("c1"), makeChunk("c2"), makeChunk("c3")];
		const deps = makeDeps(chunks);
		const options = makeOptions();

		const result = await orchestrate(options, deps);

		expect(result.chunksIngested).toBe(3);
		expect(result.empty).toBe(false);
		expect(result.batchesWritten).toBeGreaterThanOrEqual(1);
		expect(deps.store.manifests.putHead).toHaveBeenCalled();
	});

	it("returns empty=true when adapter yields no chunks", async () => {
		const deps = makeDeps([]);
		const options = makeOptions();

		const result = await orchestrate(options, deps);

		expect(result.empty).toBe(true);
		expect(result.chunksIngested).toBe(0);
	});

	it("emits log events via LogSink", async () => {
		const chunks = [makeChunk("c1")];
		const deps = makeDeps(chunks);
		const options = makeOptions();

		await orchestrate(options, deps);

		expect(deps.log).toHaveBeenCalled();
	});

	it("returns cursor info based on decideCursorValue", async () => {
		const chunks = [makeChunk("c1", { timestamp: "2026-06-01T00:00:00Z" })];
		const deps = makeDeps(chunks);
		const options = makeOptions({ isPartialRun: true });

		const result = await orchestrate(options, deps);

		// Partial run → cursor should be null
		expect(result.cursorValue).toBeNull();
		expect(result.cursorReason).toBe("partial-run");
	});
});
