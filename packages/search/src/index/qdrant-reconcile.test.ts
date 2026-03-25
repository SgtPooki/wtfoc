import { beforeEach, describe, expect, it, vi } from "vitest";
import { QdrantVectorIndex } from "./qdrant.js";

// ── Mock Qdrant client ──────────────────────────────────────────────────────

interface MockPoint {
	id: string;
	payload: Record<string, unknown>;
	vector: number[];
}

const mockCollections = new Map<string, MockPoint[]>();

const mockClient = {
	getCollections: vi.fn(async () => ({
		collections: [...mockCollections.keys()].map((name) => ({ name })),
	})),
	getCollection: vi.fn(async (name: string) => {
		const points = mockCollections.get(name);
		if (!points) {
			const err = new Error("Not found");
			(err as Error & { status: number }).status = 404;
			throw err;
		}
		return { points_count: points.length };
	}),
	createCollection: vi.fn(async (name: string) => {
		mockCollections.set(name, []);
	}),
	upsert: vi.fn(async (collectionName: string, opts: { points: MockPoint[] }) => {
		const existing = mockCollections.get(collectionName) ?? [];
		for (const point of opts.points) {
			const idx = existing.findIndex((p) => p.id === point.id);
			if (idx >= 0) {
				existing[idx] = point;
			} else {
				existing.push(point);
			}
		}
		mockCollections.set(collectionName, existing);
	}),
	scroll: vi.fn(
		async (collectionName: string, opts: { limit: number; offset?: string | number | null }) => {
			const points = mockCollections.get(collectionName) ?? [];
			const startIdx = opts.offset != null ? points.findIndex((p) => p.id === opts.offset) + 1 : 0;
			const batch = points.slice(startIdx, startIdx + opts.limit);
			const hasMore = startIdx + opts.limit < points.length;
			return {
				points: batch,
				next_page_offset: hasMore ? batch[batch.length - 1]?.id : null,
			};
		},
	),
	delete: vi.fn(async (collectionName: string, opts: { points: string[] }) => {
		const existing = mockCollections.get(collectionName) ?? [];
		const toDelete = new Set(opts.points);
		mockCollections.set(
			collectionName,
			existing.filter((p) => !toDelete.has(p.id)),
		);
	}),
	retrieve: vi.fn(async (collectionName: string, opts: { ids: string[] }) => {
		const points = mockCollections.get(collectionName) ?? [];
		return points.filter((p) => opts.ids.includes(p.id));
	}),
	search: vi.fn(async () => []),
	deleteCollection: vi.fn(async (name: string) => {
		mockCollections.delete(name);
	}),
};

vi.mock("@qdrant/js-client-rest", () => ({
	QdrantClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
		Object.assign(this, mockClient);
	}),
}));

beforeEach(() => {
	mockCollections.clear();
	vi.clearAllMocks();
});

describe("QdrantVectorIndex.reconcile", () => {
	function createIndex(collectionName = "test-collection"): QdrantVectorIndex {
		return new QdrantVectorIndex({
			url: "http://localhost:6333",
			collectionName,
			dimensions: 3,
		});
	}

	function makePoint(id: string, wtfocId: string): MockPoint {
		return {
			id,
			payload: { _wtfoc_id: wtfocId, storageId: "blob-1" },
			vector: [0.1, 0.2, 0.3],
		};
	}

	function makeSentinel(): MockPoint {
		return {
			id: "00000000-0000-0000-0000-000000000000",
			payload: { _wtfoc_sentinel: true, _wtfoc_last_accessed: Date.now() },
			vector: [0, 0, 0],
		};
	}

	it("deletes orphan vectors not in expectedIds", async () => {
		const index = createIndex();
		mockCollections.set("test-collection", [
			makePoint("uuid-a", "chunk-a"),
			makePoint("uuid-b", "chunk-b"),
			makePoint("uuid-c", "chunk-c"),
		]);

		// chunk-b was removed from manifest
		await index.reconcile(new Set(["chunk-a", "chunk-c"]));

		const remaining = mockCollections.get("test-collection") ?? [];
		expect(remaining).toHaveLength(2);
		expect(remaining.map((p) => p.payload._wtfoc_id)).toEqual(["chunk-a", "chunk-c"]);
	});

	it("preserves sentinel point during reconciliation", async () => {
		const index = createIndex();
		mockCollections.set("test-collection", [
			makeSentinel(),
			makePoint("uuid-a", "chunk-a"),
			makePoint("uuid-orphan", "chunk-orphan"),
		]);

		await index.reconcile(new Set(["chunk-a"]));

		const remaining = mockCollections.get("test-collection") ?? [];
		expect(remaining).toHaveLength(2);
		const ids = remaining.map((p) => p.payload._wtfoc_id ?? "sentinel");
		expect(ids).toContain("chunk-a");
		expect(ids).toContain("sentinel"); // sentinel has no _wtfoc_id
	});

	it("does nothing when all points are expected", async () => {
		const index = createIndex();
		mockCollections.set("test-collection", [
			makePoint("uuid-a", "chunk-a"),
			makePoint("uuid-b", "chunk-b"),
		]);

		await index.reconcile(new Set(["chunk-a", "chunk-b"]));

		expect(mockClient.delete).not.toHaveBeenCalled();
		expect(mockCollections.get("test-collection")).toHaveLength(2);
	});

	it("handles empty collection gracefully", async () => {
		const index = createIndex();
		mockCollections.set("test-collection", []);

		await index.reconcile(new Set(["chunk-a"]));

		expect(mockClient.delete).not.toHaveBeenCalled();
	});

	it("deletes all points when expectedIds is empty (except sentinel)", async () => {
		const index = createIndex();
		mockCollections.set("test-collection", [
			makeSentinel(),
			makePoint("uuid-a", "chunk-a"),
			makePoint("uuid-b", "chunk-b"),
		]);

		await index.reconcile(new Set());

		const remaining = mockCollections.get("test-collection") ?? [];
		expect(remaining).toHaveLength(1);
		expect(remaining[0]?.payload._wtfoc_sentinel).toBe(true);
	});

	it("refreshes size after reconciliation", async () => {
		const index = createIndex();
		mockCollections.set("test-collection", [
			makePoint("uuid-a", "chunk-a"),
			makePoint("uuid-b", "chunk-b"),
			makePoint("uuid-c", "chunk-c"),
		]);

		// Trigger ensureCollection to set initial size
		await index.add([
			{ id: "chunk-a", vector: new Float32Array([0.1, 0.2, 0.3]), storageId: "s1", metadata: {} },
		]);

		await index.reconcile(new Set(["chunk-a"]));

		// Size should reflect post-reconciliation count
		const remaining = mockCollections.get("test-collection") ?? [];
		expect(index.size).toBe(remaining.length);
	});

	it("respects AbortSignal", async () => {
		const index = createIndex();
		mockCollections.set("test-collection", [makePoint("uuid-a", "chunk-a")]);

		const controller = new AbortController();
		controller.abort();

		await expect(index.reconcile(new Set(["chunk-a"]), controller.signal)).rejects.toThrow();
	});

	it("handles multiple scroll pages", async () => {
		const index = createIndex();

		// Create more points than BATCH_SIZE (1000) — use a smaller set
		// and override scroll to simulate pagination
		const points: MockPoint[] = [];
		for (let i = 0; i < 5; i++) {
			points.push(makePoint(`uuid-${i}`, `chunk-${i}`));
		}
		mockCollections.set("test-collection", points);

		// Override scroll to return 2 points at a time to test pagination
		mockClient.scroll.mockImplementation(
			async (collectionName: string, opts: { limit: number; offset?: string | number | null }) => {
				const pts = mockCollections.get(collectionName) ?? [];
				const startIdx =
					opts.offset != null ? pts.findIndex((p) => p.id === String(opts.offset)) + 1 : 0;
				const pageSize = 2; // Force small pages
				const batch = pts.slice(startIdx, startIdx + pageSize);
				const hasMore = startIdx + pageSize < pts.length;
				return {
					points: batch,
					next_page_offset: hasMore ? batch[batch.length - 1]?.id : null,
				};
			},
		);

		// Keep only chunk-0 and chunk-4
		await index.reconcile(new Set(["chunk-0", "chunk-4"]));

		const remaining = mockCollections.get("test-collection") ?? [];
		expect(remaining).toHaveLength(2);
		expect(remaining.map((p) => p.payload._wtfoc_id).sort()).toEqual(["chunk-0", "chunk-4"]);
	});
});
