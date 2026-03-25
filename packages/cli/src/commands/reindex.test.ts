import type { Chunk } from "@wtfoc/common";
import { rechunkOversized } from "@wtfoc/ingest";
import { describe, expect, it } from "vitest";

/**
 * Tests for partial rechunk logic used in `reindex --rechunk`.
 *
 * The key optimization: chunks within the size limit should be preserved
 * with their original IDs and embeddings, while only oversized chunks
 * are re-split and need re-embedding.
 */
describe("partial rechunk: chunk partitioning", () => {
	function makeChunk(id: string, content: string): Chunk {
		return {
			id,
			content,
			sourceType: "test",
			source: `test/${id}`,
			sourceUrl: "",
			timestamp: "2026-01-01T00:00:00Z",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
		};
	}

	it("preserves chunks within size limit (same IDs)", () => {
		const small = makeChunk("small-1", "x".repeat(100));
		const maxChars = 200;

		// rechunkOversized should return the chunk unchanged
		const result = rechunkOversized([small], maxChars);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(small.id);
		expect(result[0]?.content).toBe(small.content);
	});

	it("splits oversized chunks into smaller ones with new IDs", () => {
		const big = makeChunk("big-1", "x".repeat(500));
		const maxChars = 200;

		const result = rechunkOversized([big], maxChars);
		expect(result.length).toBeGreaterThan(1);
		// New chunks should have different IDs from the original
		for (const chunk of result) {
			expect(chunk.id).not.toBe("big-1");
		}
	});

	it("partitioning: mixed sizes correctly separates keep vs rechunk", () => {
		const small1 = makeChunk("s1", "short content");
		const small2 = makeChunk("s2", "also short");
		const big1 = makeChunk("b1", "y".repeat(500));
		const big2 = makeChunk("b2", "z".repeat(600));
		const maxChars = 200;

		const allChunks = [small1, small2, big1, big2];

		// Partition: keep chunks within limit, rechunk oversized
		const keep: Chunk[] = [];
		const toRechunk: Chunk[] = [];
		for (const chunk of allChunks) {
			if (chunk.content.length <= maxChars) {
				keep.push(chunk);
			} else {
				toRechunk.push(chunk);
			}
		}

		expect(keep).toHaveLength(2);
		expect(keep[0]?.id).toBe("s1");
		expect(keep[1]?.id).toBe("s2");
		expect(toRechunk).toHaveLength(2);
		expect(toRechunk[0]?.id).toBe("b1");
		expect(toRechunk[1]?.id).toBe("b2");

		// Rechunk only the oversized ones
		const rechunked = rechunkOversized(toRechunk, maxChars);
		expect(rechunked.length).toBeGreaterThan(2);

		// Final set: kept + rechunked
		const final = [...keep, ...rechunked];
		expect(final.length).toBeGreaterThan(4);
		// Small chunks preserved with original IDs
		expect(final[0]?.id).toBe("s1");
		expect(final[1]?.id).toBe("s2");
	});

	it("when all chunks within limit, no rechunking needed", () => {
		const chunks = [
			makeChunk("a", "short"),
			makeChunk("b", "also short"),
			makeChunk("c", "still short"),
		];
		const maxChars = 1000;

		const toRechunk = chunks.filter((c) => c.content.length > maxChars);
		expect(toRechunk).toHaveLength(0);

		// Nothing to re-embed
		const rechunked = rechunkOversized(toRechunk, maxChars);
		expect(rechunked).toHaveLength(0);
	});
});
