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

	describe("source-type boosting (#265) — never-drop soft routing", () => {
		it("sourceTypeBoosts multiplies scores by per-type weight", async () => {
			const index = await seedIndex(
				makeEntry("doc", [0.95, 0.05, 0], { sourceType: "doc-page" }),
				makeEntry("code", [0.9, 0.1, 0], { sourceType: "code" }),
			);
			const boosted = await query("upload", embedder, index, {
				sourceTypeBoosts: { "doc-page": 0.5, code: 1.5 },
			});
			// Without boost, doc would rank first (higher raw cosine)
			// With boost: doc*0.5 vs code*1.5 → code should rank first
			expect(boosted.results[0]?.sourceType).toBe("code");
			expect(boosted.results[1]?.sourceType).toBe("doc-page");
		});

		it("missing boost key defaults to 1.0 (identity, no change)", async () => {
			const index = await seedIndex(
				makeEntry("doc", [0.95, 0.05, 0], { sourceType: "doc-page" }),
				makeEntry("code", [0.9, 0.1, 0], { sourceType: "code" }),
			);
			// Only specify boost for 'markdown' which isn't in the index — should be no-op
			const result = await query("upload", embedder, index, {
				sourceTypeBoosts: { markdown: 2.0 },
			});
			// Order preserved: doc (higher raw) first
			expect(result.results[0]?.sourceType).toBe("doc-page");
			expect(result.results[1]?.sourceType).toBe("code");
		});

		it("never drops results — all candidates included in the final topK", async () => {
			const index = await seedIndex(
				makeEntry("doc-1", [1, 0, 0], { sourceType: "doc-page" }),
				makeEntry("doc-2", [0.9, 0.1, 0], { sourceType: "doc-page" }),
				makeEntry("code-1", [0.5, 0.5, 0], { sourceType: "code" }),
			);
			// Even with near-zero boost for doc-page, results are NOT dropped
			const result = await query("upload", embedder, index, {
				sourceTypeBoosts: { "doc-page": 0.01 },
				topK: 10,
			});
			expect(result.results).toHaveLength(3);
			// code wins because its raw 0.5 * default 1.0 > doc's 1.0 * 0.01
			expect(result.results[0]?.sourceType).toBe("code");
		});

		it("empty sourceTypeBoosts behaves identically to undefined", async () => {
			const index = await seedIndex(
				makeEntry("doc", [0.95, 0.05, 0], { sourceType: "doc-page" }),
				makeEntry("code", [0.9, 0.1, 0], { sourceType: "code" }),
			);
			const withEmpty = await query("upload", embedder, index, {
				sourceTypeBoosts: {},
			});
			const withUndefined = await query("upload", embedder, index, {});
			expect(withEmpty.results.map((r) => r.sourceType)).toEqual(
				withUndefined.results.map((r) => r.sourceType),
			);
		});

		it("boost combines additively with excludeSourceTypes (filter wins)", async () => {
			const index = await seedIndex(
				makeEntry("doc", [0.95, 0.05, 0], { sourceType: "doc-page" }),
				makeEntry("code", [0.9, 0.1, 0], { sourceType: "code" }),
			);
			// exclude doc-page entirely, even though it'd be boosted
			const result = await query("upload", embedder, index, {
				sourceTypeBoosts: { "doc-page": 2.0 },
				excludeSourceTypes: ["doc-page"],
			});
			expect(result.results).toHaveLength(1);
			expect(result.results[0]?.sourceType).toBe("code");
		});
	});

	describe("source-type filtering (#256)", () => {
		it("includeSourceTypes keeps only results whose sourceType is in the set", async () => {
			const index = await seedIndex(
				makeEntry("code-1", [1, 0, 0], { sourceType: "code", source: "file.ts" }),
				makeEntry("md-1", [0.9, 0.1, 0], { sourceType: "markdown", source: "README.md" }),
				makeEntry("pr-1", [0.8, 0.2, 0], { sourceType: "github-pr", source: "owner/repo#1" }),
			);
			const result = await query("upload", embedder, index, {
				includeSourceTypes: ["code", "markdown"],
			});
			expect(result.results).toHaveLength(2);
			expect(result.results.map((r) => r.sourceType).sort()).toEqual(["code", "markdown"]);
		});

		it("excludeSourceTypes drops results whose sourceType is in the set", async () => {
			const index = await seedIndex(
				makeEntry("code-1", [1, 0, 0], { sourceType: "code", source: "file.ts" }),
				makeEntry("doc-1", [0.9, 0.1, 0], { sourceType: "doc-page", source: "/docs/x" }),
				makeEntry("md-1", [0.8, 0.2, 0], { sourceType: "markdown", source: "README.md" }),
			);
			const result = await query("upload", embedder, index, {
				excludeSourceTypes: ["doc-page"],
			});
			expect(result.results).toHaveLength(2);
			expect(result.results.some((r) => r.sourceType === "doc-page")).toBe(false);
		});

		it("include and exclude combine — include wins for overlap, exclude applied after include", async () => {
			const index = await seedIndex(
				makeEntry("code-1", [1, 0, 0], { sourceType: "code" }),
				makeEntry("md-1", [0.9, 0.1, 0], { sourceType: "markdown" }),
				makeEntry("doc-1", [0.8, 0.2, 0], { sourceType: "doc-page" }),
			);
			const result = await query("upload", embedder, index, {
				includeSourceTypes: ["code", "markdown", "doc-page"],
				excludeSourceTypes: ["doc-page"],
			});
			expect(result.results.map((r) => r.sourceType).sort()).toEqual(["code", "markdown"]);
		});

		it("empty includeSourceTypes behaves like no filter", async () => {
			const index = await seedIndex(
				makeEntry("code-1", [1, 0, 0], { sourceType: "code" }),
				makeEntry("md-1", [0.9, 0.1, 0], { sourceType: "markdown" }),
			);
			const result = await query("upload", embedder, index, { includeSourceTypes: [] });
			expect(result.results).toHaveLength(2);
		});

		it("filters apply before topK so the final slice honors both", async () => {
			const index = await seedIndex(
				makeEntry("doc-1", [1, 0, 0], { sourceType: "doc-page" }),
				makeEntry("code-1", [0.9, 0.1, 0], { sourceType: "code" }),
				makeEntry("md-1", [0.8, 0.2, 0], { sourceType: "markdown" }),
			);
			const result = await query("upload", embedder, index, {
				excludeSourceTypes: ["doc-page"],
				topK: 2,
			});
			expect(result.results).toHaveLength(2);
			expect(result.results.some((r) => r.sourceType === "doc-page")).toBe(false);
			// With doc-page excluded, top 2 should be code (highest remaining) then markdown
			expect(result.results[0]?.sourceType).toBe("code");
		});
	});
});
