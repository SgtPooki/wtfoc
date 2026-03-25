import { beforeEach, describe, expect, it, vi } from "vitest";
import { QdrantCollectionGc } from "./qdrant.js";

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
	retrieve: vi.fn(async (collectionName: string, opts: { ids: string[] }) => {
		const points = mockCollections.get(collectionName) ?? [];
		return points.filter((p) => opts.ids.includes(p.id));
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
	deleteCollection: vi.fn(async (collectionName: string) => {
		mockCollections.delete(collectionName);
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

describe("QdrantCollectionGc", () => {
	function createGc(): QdrantCollectionGc {
		return new QdrantCollectionGc("http://localhost:6333");
	}

	describe("touchCollection", () => {
		it("upserts a sentinel point with last-accessed timestamp", async () => {
			const gc = createGc();
			mockCollections.set("wtfoc-cid-abc", []);

			await gc.touchCollection("wtfoc-cid-abc", 3);

			const points = mockCollections.get("wtfoc-cid-abc");
			expect(points).toHaveLength(1);
			expect(points?.[0]?.payload._wtfoc_sentinel).toBe(true);
			expect(points?.[0]?.payload._wtfoc_last_accessed).toBeTypeOf("number");
		});

		it("updates existing sentinel on re-touch", async () => {
			const gc = createGc();
			mockCollections.set("wtfoc-cid-abc", []);

			const nowSpy = vi.spyOn(Date, "now");
			nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

			await gc.touchCollection("wtfoc-cid-abc", 3);
			const first = mockCollections.get("wtfoc-cid-abc")?.[0]?.payload._wtfoc_last_accessed;
			expect(first).toBe(1000);

			await gc.touchCollection("wtfoc-cid-abc", 3);

			const points = mockCollections.get("wtfoc-cid-abc");
			expect(points).toHaveLength(1); // still one point (upsert)
			expect(points?.[0]?.payload._wtfoc_last_accessed).toBe(2000);

			nowSpy.mockRestore();
		});
	});

	describe("listCidCollections", () => {
		it("returns only wtfoc-cid- prefixed collections", async () => {
			const gc = createGc();
			mockCollections.set("wtfoc-cid-abc", []);
			mockCollections.set("wtfoc-cid-def", []);
			mockCollections.set("wtfoc-my-collection", []);
			mockCollections.set("other-collection", []);

			const result = await gc.listCidCollections();
			expect(result).toEqual(["wtfoc-cid-abc", "wtfoc-cid-def"]);
		});

		it("returns empty array when no CID collections exist", async () => {
			const gc = createGc();
			mockCollections.set("wtfoc-named", []);

			const result = await gc.listCidCollections();
			expect(result).toEqual([]);
		});
	});

	describe("getLastAccessed", () => {
		it("returns found with timestamp from sentinel point", async () => {
			const gc = createGc();
			const now = Date.now();
			mockCollections.set("wtfoc-cid-abc", [
				{
					id: "00000000-0000-0000-0000-000000000000",
					payload: { _wtfoc_sentinel: true, _wtfoc_last_accessed: now },
					vector: [0, 0, 0],
				},
			]);

			const result = await gc.getLastAccessed("wtfoc-cid-abc");
			expect(result).toEqual({ status: "found", lastAccessed: now });
		});

		it("returns missing when no sentinel exists", async () => {
			const gc = createGc();
			mockCollections.set("wtfoc-cid-abc", []);

			const result = await gc.getLastAccessed("wtfoc-cid-abc");
			expect(result).toEqual({ status: "missing" });
		});

		it("returns missing for non-sentinel points", async () => {
			const gc = createGc();
			mockCollections.set("wtfoc-cid-abc", [
				{
					id: "00000000-0000-0000-0000-000000000000",
					payload: { some: "data" },
					vector: [0, 0, 0],
				},
			]);

			const result = await gc.getLastAccessed("wtfoc-cid-abc");
			expect(result).toEqual({ status: "missing" });
		});

		it("returns error on transient retrieve failure", async () => {
			const gc = createGc();
			mockClient.retrieve.mockRejectedValueOnce(new Error("connection refused"));

			const result = await gc.getLastAccessed("wtfoc-cid-abc");
			expect(result).toEqual({ status: "error" });
		});
	});

	describe("sweep", () => {
		it("deletes collections idle beyond maxIdleMs", async () => {
			const gc = createGc();
			const old = Date.now() - 8 * 86_400_000; // 8 days ago
			const recent = Date.now() - 1_000; // 1 second ago

			mockCollections.set("wtfoc-cid-old", [
				{
					id: "00000000-0000-0000-0000-000000000000",
					payload: { _wtfoc_sentinel: true, _wtfoc_last_accessed: old },
					vector: [0],
				},
			]);
			mockCollections.set("wtfoc-cid-recent", [
				{
					id: "00000000-0000-0000-0000-000000000000",
					payload: { _wtfoc_sentinel: true, _wtfoc_last_accessed: recent },
					vector: [0],
				},
			]);

			const deleted = await gc.sweep({
				maxIdleMs: 7 * 86_400_000, // 7 days
				maxCollections: 50,
				activeCollections: new Set(),
			});

			expect(deleted).toEqual(["wtfoc-cid-old"]);
			expect(mockCollections.has("wtfoc-cid-old")).toBe(false);
			expect(mockCollections.has("wtfoc-cid-recent")).toBe(true);
		});

		it("skips active collections even if idle", async () => {
			const gc = createGc();
			const old = Date.now() - 30 * 86_400_000;

			mockCollections.set("wtfoc-cid-active", [
				{
					id: "00000000-0000-0000-0000-000000000000",
					payload: { _wtfoc_sentinel: true, _wtfoc_last_accessed: old },
					vector: [0],
				},
			]);

			const deleted = await gc.sweep({
				maxIdleMs: 7 * 86_400_000,
				maxCollections: 50,
				activeCollections: new Set(["wtfoc-cid-active"]),
			});

			expect(deleted).toEqual([]);
			expect(mockCollections.has("wtfoc-cid-active")).toBe(true);
		});

		it("enforces maxCollections cap by deleting least-recently-accessed", async () => {
			const gc = createGc();
			const now = Date.now();

			// Create 4 collections, all recent enough to survive TTL
			for (let i = 0; i < 4; i++) {
				mockCollections.set(`wtfoc-cid-col${i}`, [
					{
						id: "00000000-0000-0000-0000-000000000000",
						payload: {
							_wtfoc_sentinel: true,
							_wtfoc_last_accessed: now - (4 - i) * 60_000, // col0 oldest, col3 newest
						},
						vector: [0],
					},
				]);
			}

			const deleted = await gc.sweep({
				maxIdleMs: 7 * 86_400_000, // none are old enough
				maxCollections: 2,
				activeCollections: new Set(),
			});

			// Should delete the 2 least-recently-accessed: col0, col1
			expect(deleted).toHaveLength(2);
			expect(deleted).toContain("wtfoc-cid-col0");
			expect(deleted).toContain("wtfoc-cid-col1");
			expect(mockCollections.has("wtfoc-cid-col2")).toBe(true);
			expect(mockCollections.has("wtfoc-cid-col3")).toBe(true);
		});

		it("returns empty array when no CID collections exist", async () => {
			const gc = createGc();
			const deleted = await gc.sweep({
				maxIdleMs: 7 * 86_400_000,
				maxCollections: 50,
				activeCollections: new Set(),
			});
			expect(deleted).toEqual([]);
		});

		it("treats collections without sentinel as last-accessed=0", async () => {
			const gc = createGc();
			mockCollections.set("wtfoc-cid-no-sentinel", []);

			const deleted = await gc.sweep({
				maxIdleMs: 1_000, // anything older than 1s
				maxCollections: 50,
				activeCollections: new Set(),
			});

			expect(deleted).toEqual(["wtfoc-cid-no-sentinel"]);
		});

		it("skips collections with transient retrieve errors", async () => {
			const gc = createGc();
			const old = Date.now() - 30 * 86_400_000;

			// One healthy old collection
			mockCollections.set("wtfoc-cid-old", [
				{
					id: "00000000-0000-0000-0000-000000000000",
					payload: { _wtfoc_sentinel: true, _wtfoc_last_accessed: old },
					vector: [0],
				},
			]);
			// One collection that will error on retrieve
			mockCollections.set("wtfoc-cid-erroring", []);

			// Make retrieve fail for the erroring collection
			const origRetrieve = mockClient.retrieve.getMockImplementation();
			mockClient.retrieve.mockImplementation(async (name: string, opts: { ids: string[] }) => {
				if (name === "wtfoc-cid-erroring") throw new Error("connection refused");
				const points = mockCollections.get(name) ?? [];
				return points.filter((p: MockPoint) => opts.ids.includes(p.id));
			});

			const deleted = await gc.sweep({
				maxIdleMs: 7 * 86_400_000,
				maxCollections: 50,
				activeCollections: new Set(),
			});

			// Should delete the old one but skip the erroring one
			expect(deleted).toEqual(["wtfoc-cid-old"]);
			expect(mockCollections.has("wtfoc-cid-erroring")).toBe(true);

			if (origRetrieve) mockClient.retrieve.mockImplementation(origRetrieve);
		});
	});
});
