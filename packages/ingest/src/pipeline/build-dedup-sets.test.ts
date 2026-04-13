import type { DocumentCatalog, Segment } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { buildDedupSetsFromCatalog, buildDedupSetsFromSegments } from "./build-dedup-sets.js";

function makeCatalog(
	docs: Record<
		string,
		{ chunkIds: string[]; supersededChunkIds?: string[]; contentFingerprints?: string[] }
	>,
): DocumentCatalog {
	const documents: DocumentCatalog["documents"] = {};
	for (const [id, entry] of Object.entries(docs)) {
		documents[id] = {
			documentId: id,
			currentVersionId: "v1",
			previousVersionIds: [],
			chunkIds: entry.chunkIds,
			supersededChunkIds: entry.supersededChunkIds ?? [],
			contentFingerprints: entry.contentFingerprints ?? [],
			state: "active",
			mutability: "mutable-state",
			sourceType: "code",
			updatedAt: new Date().toISOString(),
		};
	}
	return { schemaVersion: 1, collectionId: "test-col", documents };
}

describe("buildDedupSetsFromCatalog", () => {
	it("collects chunkIds, supersededChunkIds, and fingerprints from catalog", () => {
		const catalog = makeCatalog({
			"doc-a": {
				chunkIds: ["c1", "c2"],
				supersededChunkIds: ["c0"],
				contentFingerprints: ["fp1", "fp2"],
			},
			"doc-b": { chunkIds: ["c3"], contentFingerprints: ["fp3"] },
		});
		const result = buildDedupSetsFromCatalog(catalog);
		expect(result.knownChunkIds).toEqual(new Set(["c0", "c1", "c2", "c3"]));
		expect(result.knownFingerprints).toEqual(new Set(["fp1", "fp2", "fp3"]));
	});

	it("returns empty sets for empty catalog", () => {
		const catalog = makeCatalog({});
		const result = buildDedupSetsFromCatalog(catalog);
		expect(result.knownChunkIds.size).toBe(0);
		expect(result.knownFingerprints.size).toBe(0);
	});
});

describe("buildDedupSetsFromSegments", () => {
	it("populates sets from segment chunks", async () => {
		const seg: Segment = {
			schemaVersion: 1,
			embeddingModel: "test",
			embeddingDimensions: 384,
			chunks: [
				{
					id: "c1",
					storageId: "s1",
					content: "a",
					embedding: [],
					terms: [],
					source: "x",
					sourceType: "code",
					metadata: {},
					contentFingerprint: "fp1",
				},
				{
					id: "c2",
					storageId: "s2",
					content: "b",
					embedding: [],
					terms: [],
					source: "x",
					sourceType: "code",
					metadata: {},
				},
			],
			edges: [],
		};
		const download = vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(seg)));
		const result = await buildDedupSetsFromSegments(
			[{ id: "seg-1", sourceTypes: ["code"], chunkCount: 2 }],
			download,
		);
		expect(result.knownChunkIds).toEqual(new Set(["c1", "c2"]));
		expect(result.knownFingerprints).toEqual(new Set(["fp1"]));
	});

	it("skips segments that fail to download", async () => {
		const download = vi.fn().mockRejectedValue(new Error("not found"));
		const result = await buildDedupSetsFromSegments(
			[{ id: "seg-1", sourceTypes: ["code"], chunkCount: 1 }],
			download,
		);
		expect(result.knownChunkIds.size).toBe(0);
		expect(result.knownFingerprints.size).toBe(0);
	});

	it("succeeds for some segments even when others fail", async () => {
		const goodSeg: Segment = {
			schemaVersion: 1,
			embeddingModel: "test",
			embeddingDimensions: 384,
			chunks: [
				{
					id: "c1",
					storageId: "s1",
					content: "a",
					embedding: [],
					terms: [],
					source: "x",
					sourceType: "code",
					metadata: {},
					contentFingerprint: "fp1",
				},
			],
			edges: [],
		};
		const download = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail"))
			.mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(goodSeg)));
		const result = await buildDedupSetsFromSegments(
			[
				{ id: "seg-bad", sourceTypes: ["code"], chunkCount: 1 },
				{ id: "seg-good", sourceTypes: ["code"], chunkCount: 1 },
			],
			download,
		);
		expect(result.knownChunkIds).toEqual(new Set(["c1"]));
		expect(result.knownFingerprints).toEqual(new Set(["fp1"]));
	});
});
