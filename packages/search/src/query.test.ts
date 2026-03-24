import type { Embedder, VectorEntry, VectorIndex } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { query } from "./query.js";

const mockEmbedder: Embedder = {
	dimensions: 3,
	async embed(): Promise<Float32Array> {
		return new Float32Array([1.0, 0.0, 0.0]);
	},
	async embedBatch(texts: string[]): Promise<Float32Array[]> {
		return texts.map(() => new Float32Array([1.0, 0.0, 0.0]));
	},
};

function createMockIndex(entries: VectorEntry[]): VectorIndex {
	return {
		size: entries.length,
		async add(newEntries: VectorEntry[]): Promise<void> {
			entries.push(...newEntries);
		},
		async search(_query: Float32Array, topK: number) {
			return entries.slice(0, topK).map((entry, i) => ({
				entry,
				score: 1.0 - i * 0.1,
			}));
		},
		async serialize(): Promise<Uint8Array> {
			return new Uint8Array(0);
		},
		async deserialize(): Promise<void> {},
	};
}

const testEntries: VectorEntry[] = [
	{
		id: "1",
		vector: new Float32Array([1, 0, 0]),
		storageId: "s1",
		metadata: { sourceType: "code", source: "file.ts", content: "upload handler" },
	},
	{
		id: "2",
		vector: new Float32Array([0.9, 0.1, 0]),
		storageId: "s2",
		metadata: {
			sourceType: "markdown",
			source: "README.md",
			sourceUrl: "https://example.com",
			content: "how to upload",
		},
	},
];

describe("query", () => {
	it("returns ranked results with scores", async () => {
		const index = createMockIndex(testEntries);
		const result = await query("upload", mockEmbedder, index);

		expect(result.results).toHaveLength(2);
		const first = result.results[0];
		const second = result.results[1];
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(first?.score).toBeGreaterThanOrEqual(second?.score ?? 0);
	});

	it("includes sourceType and source metadata", async () => {
		const index = createMockIndex(testEntries);
		const result = await query("upload", mockEmbedder, index);

		expect(result.results[0]?.sourceType).toBe("code");
		expect(result.results[1]?.sourceUrl).toBe("https://example.com");
	});

	it("respects topK limit", async () => {
		const index = createMockIndex(testEntries);
		const result = await query("upload", mockEmbedder, index, { topK: 1 });

		expect(result.results).toHaveLength(1);
	});

	it("filters by minScore", async () => {
		const index = createMockIndex(testEntries);
		const result = await query("upload", mockEmbedder, index, { minScore: 0.95 });

		expect(result.results).toHaveLength(1);
	});

	it("returns empty for no matches", async () => {
		const index = createMockIndex([]);
		const result = await query("nothing", mockEmbedder, index);

		expect(result.results).toHaveLength(0);
	});

	it("includes query in result", async () => {
		const index = createMockIndex(testEntries);
		const result = await query("test query", mockEmbedder, index);

		expect(result.query).toBe("test query");
	});

	it("respects AbortSignal", async () => {
		const controller = new AbortController();
		controller.abort();

		const index = createMockIndex(testEntries);
		await expect(
			query("upload", mockEmbedder, index, { signal: controller.signal }),
		).rejects.toThrow();
	});
});
