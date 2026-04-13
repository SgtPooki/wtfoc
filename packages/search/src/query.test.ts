import type { VectorEntry } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { InMemoryVectorIndex } from "./index/in-memory.js";
import { query } from "./query.js";
import { deterministicEmbedder } from "./test-helpers.js";

/**
 * Hand-crafted 3D vectors with known geometric relationships:
 *   query "upload" → [1, 0, 0]
 *   entry "1" →      [1, 0, 0]  cosine ≈ 1.0   (exact match)
 *   entry "2" →      [0.7, 0.7, 0]  cosine ≈ 0.71  (related)
 *   entry "3" →      [0, 0, 1]  cosine ≈ 0.0   (unrelated)
 */
const embedder = deterministicEmbedder({
	upload: [1, 0, 0],
	"test query": [1, 0, 0],
	nothing: [0.5, 0.5, 0],
});

function makeEntry(id: string, vector: number[], meta: Record<string, string> = {}): VectorEntry {
	return {
		id,
		vector: new Float32Array(vector),
		storageId: `s-${id}`,
		metadata: { sourceType: "code", source: "file.ts", content: `content-${id}`, ...meta },
	};
}

async function seedIndex(...entries: VectorEntry[]): Promise<InMemoryVectorIndex> {
	const index = new InMemoryVectorIndex();
	await index.add(entries);
	return index;
}

describe("query", () => {
	it("returns results ranked by real cosine similarity", async () => {
		const index = await seedIndex(
			makeEntry("exact", [1, 0, 0]),
			makeEntry("related", [0.7, 0.7, 0]),
			makeEntry("unrelated", [0, 0, 1]),
		);
		const result = await query("upload", embedder, index);

		expect(result.results).toHaveLength(3);
		// Exact match should rank first with highest score
		expect(result.results[0]?.storageId).toBe("s-exact");
		expect(result.results[0]?.score).toBeGreaterThan(0.9);
		// Related second
		expect(result.results[1]?.storageId).toBe("s-related");
		expect(result.results[1]?.score).toBeGreaterThan(0.5);
		expect(result.results[1]?.score).toBeLessThan(0.9);
		// Unrelated last with near-zero score
		expect(result.results[2]?.storageId).toBe("s-unrelated");
		expect(result.results[2]?.score).toBeLessThan(0.1);
	});

	it("includes sourceType and source metadata", async () => {
		const index = await seedIndex(
			makeEntry("1", [1, 0, 0], { sourceType: "code", source: "file.ts" }),
			makeEntry("2", [0.7, 0.7, 0], {
				sourceType: "markdown",
				source: "README.md",
				sourceUrl: "https://example.com",
			}),
		);
		const result = await query("upload", embedder, index);

		expect(result.results[0]?.sourceType).toBe("code");
		expect(result.results[1]?.sourceUrl).toBe("https://example.com");
	});

	it("respects topK limit", async () => {
		const index = await seedIndex(makeEntry("1", [1, 0, 0]), makeEntry("2", [0.7, 0.7, 0]));
		const result = await query("upload", embedder, index, { topK: 1 });

		expect(result.results).toHaveLength(1);
	});

	it("filters by minScore using real cosine similarity", async () => {
		const index = await seedIndex(
			makeEntry("close", [1, 0, 0]), // cosine ≈ 1.0
			makeEntry("far", [0, 0, 1]), // cosine ≈ 0.0
		);
		// minScore 0.5 should filter out the far entry
		const result = await query("upload", embedder, index, { minScore: 0.5 });

		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.storageId).toBe("s-close");
	});

	it("returns empty for no matches", async () => {
		const index = new InMemoryVectorIndex();
		const result = await query("nothing", embedder, index);

		expect(result.results).toHaveLength(0);
	});

	it("includes query in result", async () => {
		const index = await seedIndex(makeEntry("1", [1, 0, 0]));
		const result = await query("test query", embedder, index);

		expect(result.query).toBe("test query");
	});

	it("respects AbortSignal", async () => {
		const controller = new AbortController();
		controller.abort();

		const index = await seedIndex(makeEntry("1", [1, 0, 0]));
		await expect(query("upload", embedder, index, { signal: controller.signal })).rejects.toThrow();
	});
});
