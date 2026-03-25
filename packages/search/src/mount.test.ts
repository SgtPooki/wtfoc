import type {
	CollectionHead,
	CollectionRevision,
	Segment,
	StorageBackend,
	StorageResult,
	VectorEntry,
	VectorIndex,
} from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { mountCollection } from "./mount.js";

function makeSegment(id: string): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test-model",
		embeddingDimensions: 3,
		chunks: [
			{
				id: `chunk-${id}`,
				storageId: `blob-${id}`,
				content: `Content of ${id}`,
				embedding: [0.1, 0.2, 0.3],
				terms: ["test"],
				source: `source-${id}`,
				sourceType: "repo",
				metadata: {},
			},
		],
		edges: [
			{
				type: "references",
				sourceId: `chunk-${id}`,
				targetType: "issue",
				targetId: "issue-1",
				evidence: "link in code",
				confidence: 0.9,
			},
		],
	};
}

function makeStorage(segments: Record<string, Segment>): StorageBackend {
	return {
		async upload(): Promise<StorageResult> {
			return { id: "mock" };
		},
		async download(id: string): Promise<Uint8Array> {
			const seg = segments[id];
			if (!seg) throw new Error(`Segment ${id} not found`);
			return new TextEncoder().encode(JSON.stringify(seg));
		},
	};
}

function makeVectorIndex(): VectorIndex & { entries: VectorEntry[] } {
	const entries: VectorEntry[] = [];
	const idx: VectorIndex & { entries: VectorEntry[] } = {
		entries,
		get size() {
			return entries.length;
		},
		async add(newEntries: VectorEntry[]): Promise<void> {
			entries.push(...newEntries);
		},
		async search(_query: Float32Array, topK: number) {
			return entries.slice(0, topK).map((entry, i) => ({
				entry,
				score: 1.0 - i * 0.1,
			}));
		},
		async delete(ids: string[]): Promise<void> {
			for (const id of ids) {
				const idx = entries.findIndex((e) => e.id === id);
				if (idx !== -1) entries.splice(idx, 1);
			}
		},
	};
	return idx;
}

describe("mountCollection", () => {
	it("mounts from a CollectionHead (latest mode) and populates vector index", async () => {
		const seg = makeSegment("seg-1");
		const storage = makeStorage({ "seg-1": seg });
		const index = makeVectorIndex();

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "test-col",
			name: "test",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const mounted = await mountCollection(head, storage, index);

		expect(mounted.revision).toBeNull();
		expect(mounted.segments).toHaveLength(1);
		expect(index.entries).toHaveLength(1);
		expect(index.entries[0]?.id).toBe("chunk-seg-1");
	});

	it("mounts from a CollectionRevision (pinned mode) and populates vector index", async () => {
		const seg = makeSegment("seg-pinned");
		const storage = makeStorage({ "seg-pinned": seg });
		const index = makeVectorIndex();

		const revision: CollectionRevision = {
			schemaVersion: 1,
			revisionId: "rev-123",
			collectionId: "test-col",
			prevRevisionId: null,
			artifactSummaries: [],
			segmentRefs: ["seg-pinned"],
			bundleRefs: [],
			provenance: [],
			createdAt: new Date().toISOString(),
			publishedBy: "test",
		};

		const mounted = await mountCollection(revision, storage, index);

		expect(mounted.revision).toBe(revision);
		expect(mounted.segments).toHaveLength(1);
		expect(index.entries).toHaveLength(1);
	});

	it("reuses stored corpus embeddings without re-embedding", async () => {
		const seg = makeSegment("seg-embed");
		const storage = makeStorage({ "seg-embed": seg });
		const index = makeVectorIndex();

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "embed-test",
			name: "embed",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-embed", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await mountCollection(head, storage, index);

		const entry = index.entries[0];
		expect(entry).toBeTruthy();
		expect(entry?.vector).toBeInstanceOf(Float32Array);
		if (entry) {
			expect(entry.vector[0]).toBeCloseTo(0.1);
			expect(entry.vector[1]).toBeCloseTo(0.2);
			expect(entry.vector[2]).toBeCloseTo(0.3);
		}
	});

	it("trace can operate from explicit edges without an embedder", async () => {
		const seg = makeSegment("seg-edges");
		const storage = makeStorage({ "seg-edges": seg });
		const index = makeVectorIndex();

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "edge-test",
			name: "edges",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-edges", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const mounted = await mountCollection(head, storage, index);

		expect(mounted.segments[0]?.edges).toHaveLength(1);
		expect(mounted.segments[0]?.edges[0]?.type).toBe("references");
	});

	it("respects AbortSignal", async () => {
		const seg = makeSegment("seg-abort");
		const storage = makeStorage({ "seg-abort": seg });
		const index = makeVectorIndex();
		const controller = new AbortController();
		controller.abort();

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "abort-test",
			name: "abort",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-abort", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await expect(
			mountCollection(head, storage, index, { signal: controller.signal }),
		).rejects.toThrow();
	});

	it("loads multiple segments and populates index with all chunks", async () => {
		const seg1 = makeSegment("seg-a");
		const seg2 = makeSegment("seg-b");
		const storage = makeStorage({ "seg-a": seg1, "seg-b": seg2 });
		const index = makeVectorIndex();

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "multi-test",
			name: "multi",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [
				{ id: "seg-a", sourceTypes: ["repo"], chunkCount: 1 },
				{ id: "seg-b", sourceTypes: ["repo"], chunkCount: 1 },
			],
			totalChunks: 2,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const mounted = await mountCollection(head, storage, index);

		expect(mounted.segments).toHaveLength(2);
		expect(index.entries).toHaveLength(2);
	});

	it("resolves through currentRevisionId when head has one and resolveRevision is provided", async () => {
		const seg = makeSegment("seg-via-rev");
		const storage = makeStorage({ "seg-via-rev": seg });
		const index = makeVectorIndex();

		const revision: CollectionRevision = {
			schemaVersion: 1,
			revisionId: "rev-resolved",
			collectionId: "test-col",
			prevRevisionId: null,
			artifactSummaries: [],
			segmentRefs: ["seg-via-rev"],
			bundleRefs: [],
			provenance: [],
			createdAt: new Date().toISOString(),
			publishedBy: "test",
		};

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "test-col",
			name: "resolve-test",
			currentRevisionId: "rev-resolved",
			prevHeadId: null,
			segments: [{ id: "seg-should-not-use", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const mounted = await mountCollection(head, storage, index, {
			resolveRevision: async () => revision,
		});

		expect(mounted.revision).toBe(revision);
		expect(mounted.segments).toHaveLength(1);
		expect(index.entries[0]?.id).toBe("chunk-seg-via-rev");
	});

	it("includes chunk.metadata fields in vector entry metadata", async () => {
		const seg: Segment = {
			schemaVersion: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			chunks: [
				{
					id: "chunk-meta",
					storageId: "blob-meta",
					content: "Test content",
					embedding: [0.1, 0.2, 0.3],
					terms: ["test"],
					source: "source-meta",
					sourceType: "repo",
					metadata: { customKey: "customValue", anotherKey: "anotherValue" },
				},
			],
			edges: [],
		};
		const storage = makeStorage({ "seg-meta": seg });
		const index = makeVectorIndex();

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "meta-test",
			name: "meta",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-meta", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await mountCollection(head, storage, index);

		const entry = index.entries[0];
		expect(entry?.metadata.customKey).toBe("customValue");
		expect(entry?.metadata.anotherKey).toBe("anotherValue");
		expect(entry?.metadata.source).toBe("source-meta");
		expect(entry?.metadata.content).toBe("Test content");
	});

	it("falls back storageId to segment ref when chunk.storageId is empty", async () => {
		const seg: Segment = {
			schemaVersion: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			chunks: [
				{
					id: "chunk-no-sid",
					storageId: "",
					content: "No storage ID",
					embedding: [0.1, 0.2, 0.3],
					terms: ["test"],
					source: "source-no-sid",
					sourceType: "repo",
					metadata: {},
				},
			],
			edges: [],
		};
		const storage = makeStorage({ "seg-fallback": seg });
		const index = makeVectorIndex();

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "sid-test",
			name: "sid",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-fallback", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await mountCollection(head, storage, index);

		const entry = index.entries[0];
		expect(entry?.storageId).toBe("seg-fallback");
	});

	it("falls back to head segments when no resolveRevision provided", async () => {
		const seg = makeSegment("seg-direct");
		const storage = makeStorage({ "seg-direct": seg });
		const index = makeVectorIndex();

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "test-col",
			name: "fallback-test",
			currentRevisionId: "rev-exists-but-no-resolver",
			prevHeadId: null,
			segments: [{ id: "seg-direct", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const mounted = await mountCollection(head, storage, index);

		expect(mounted.revision).toBeNull();
		expect(mounted.segments).toHaveLength(1);
	});

	it("calls reconcile on a reconcilable vector index when option is set", async () => {
		const seg = makeSegment("seg-rec");
		const storage = makeStorage({ "seg-rec": seg });
		const index = makeVectorIndex();

		// Add reconcile method to mock index
		const reconcileMock = vi.fn(async () => {});
		(index as Record<string, unknown>).reconcile = reconcileMock;

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "reconcile-test",
			name: "reconcile",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-rec", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await mountCollection(head, storage, index, { reconcile: true });

		expect(reconcileMock).toHaveBeenCalledOnce();
		const call = reconcileMock.mock.calls[0];
		expect(call).toBeTruthy();
		const [expectedIds] = call ?? [];
		expect(expectedIds).toBeInstanceOf(Set);
		expect(expectedIds.has("chunk-seg-rec")).toBe(true);
	});

	it("does not call reconcile when option is false", async () => {
		const seg = makeSegment("seg-norec");
		const storage = makeStorage({ "seg-norec": seg });
		const index = makeVectorIndex();

		const reconcileMock = vi.fn(async () => {});
		(index as Record<string, unknown>).reconcile = reconcileMock;

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "norec-test",
			name: "norec",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-norec", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await mountCollection(head, storage, index);

		expect(reconcileMock).not.toHaveBeenCalled();
	});

	it("skips reconcile on non-reconcilable vector index", async () => {
		const seg = makeSegment("seg-plain");
		const storage = makeStorage({ "seg-plain": seg });
		const index = makeVectorIndex();
		// No reconcile method — plain VectorIndex

		const head: CollectionHead = {
			schemaVersion: 1,
			collectionId: "plain-test",
			name: "plain",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-plain", sourceTypes: ["repo"], chunkCount: 1 }],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		// Should not throw even with reconcile: true
		await expect(mountCollection(head, storage, index, { reconcile: true })).resolves.not.toThrow();
	});
});
