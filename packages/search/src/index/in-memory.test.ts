import type { VectorEntry } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { InMemoryVectorIndex } from "./in-memory.js";

function makeEntry(
	id: string,
	vector: number[],
	overrides?: Partial<Omit<VectorEntry, "id" | "vector">>,
): VectorEntry {
	return {
		id,
		vector: new Float32Array(vector),
		storageId: overrides?.storageId ?? `storage-${id}`,
		metadata: overrides?.metadata ?? { sourceType: "test" },
	};
}

describe("InMemoryVectorIndex", () => {
	it("returns search results sorted by cosine similarity", async () => {
		const index = new InMemoryVectorIndex();
		await index.add([
			makeEntry("exact", [1, 0]),
			makeEntry("close", [0.8, 0.2]),
			makeEntry("far", [0, 1]),
		]);

		const results = await index.search(new Float32Array([1, 0]), 3);

		expect(results).toHaveLength(3);
		expect(results.map((result) => result.entry.id)).toEqual(["exact", "close", "far"]);
		expect(results[0]?.score).toBeCloseTo(1);
		expect(results[1]?.score).toBeGreaterThan(results[2]?.score ?? 0);
	});

	it("limits results to topK entries", async () => {
		const index = new InMemoryVectorIndex();
		await index.add([
			makeEntry("first", [1, 0]),
			makeEntry("second", [0.9, 0.1]),
			makeEntry("third", [0.8, 0.2]),
		]);

		const results = await index.search(new Float32Array([1, 0]), 2);

		expect(results).toHaveLength(2);
		expect(results.map((result) => result.entry.id)).toEqual(["first", "second"]);
	});

	it("returns an empty array when the index has no entries", async () => {
		const index = new InMemoryVectorIndex();

		await expect(index.search(new Float32Array([1, 0]), 3)).resolves.toEqual([]);
	});

	it("preserves search behavior across serialization round-trips", async () => {
		const original = new InMemoryVectorIndex();
		await original.add([
			makeEntry("first", [1, 0], { metadata: { sourceType: "slack", channel: "alerts" } }),
			makeEntry("second", [0.4, 0.9], { metadata: { sourceType: "github", kind: "issue" } }),
		]);

		const serialized = await original.serialize();
		const restored = new InMemoryVectorIndex();
		await restored.deserialize(serialized);

		const originalResults = await original.search(new Float32Array([1, 0]), 2);
		const restoredResults = await restored.search(new Float32Array([1, 0]), 2);

		expect(restored.size).toBe(2);
		expect(
			restoredResults.map((result) => ({
				id: result.entry.id,
				storageId: result.entry.storageId,
				metadata: result.entry.metadata,
				score: result.score,
			})),
		).toEqual(
			originalResults.map((result) => ({
				id: result.entry.id,
				storageId: result.entry.storageId,
				metadata: result.entry.metadata,
				score: result.score,
			})),
		);
	});
});
