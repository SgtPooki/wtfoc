import type { Embedder, Segment, VectorIndex } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { buildLiveRetriever, buildStorageToDocMap } from "./recipe-adversarial-retriever.js";

const mockQuery = vi.hoisted(() =>
	vi.fn<
		(
			text: string,
			embedder: Embedder,
			index: VectorIndex,
			opts?: { topK?: number },
		) => Promise<{
			query: string;
			results: Array<{
				content: string;
				sourceType: string;
				source: string;
				storageId: string;
				score: number;
			}>;
		}>
	>(),
);

vi.mock("@wtfoc/search", async (orig) => {
	const actual = (await orig()) as Record<string, unknown>;
	return {
		...actual,
		query: mockQuery,
	};
});

function makeSegment(
	chunks: Array<{ storageId: string; documentId?: string }>,
): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 4,
		chunks: chunks.map((c, i) => ({
			id: `c-${i}`,
			storageId: c.storageId,
			content: "x",
			embedding: [0, 0, 0, 0],
			terms: [],
			source: "src",
			sourceType: "code",
			metadata: {},
			...(c.documentId ? { documentId: c.documentId } : {}),
		})),
		edges: [],
	} as unknown as Segment;
}

describe("buildStorageToDocMap", () => {
	it("maps every chunk with a documentId", () => {
		const seg = makeSegment([
			{ storageId: "s1", documentId: "doc-A" },
			{ storageId: "s2", documentId: "doc-B" },
			{ storageId: "s3" },
		]);
		const m = buildStorageToDocMap([seg]);
		expect(m.size).toBe(2);
		expect(m.get("s1")).toBe("doc-A");
		expect(m.get("s2")).toBe("doc-B");
	});
	it("survives empty input", () => {
		expect(buildStorageToDocMap([]).size).toBe(0);
	});
});

describe("buildLiveRetriever", () => {
	it("returns artifactIds resolved from query() storageIds", async () => {
		mockQuery.mockResolvedValueOnce({
			query: "q",
			results: [
				{ content: "x", sourceType: "code", source: "s", storageId: "s1", score: 0.9 },
				{ content: "y", sourceType: "code", source: "s", storageId: "s2", score: 0.8 },
			],
		});
		const seg = makeSegment([
			{ storageId: "s1", documentId: "doc-A" },
			{ storageId: "s2", documentId: "doc-B" },
		]);
		const retrieve = buildLiveRetriever({
			embedder: {} as Embedder,
			vectorIndex: {} as VectorIndex,
			segments: [seg],
		});
		const hits = await retrieve("test", 5);
		expect(hits).toEqual([{ artifactId: "doc-A" }, { artifactId: "doc-B" }]);
	});

	it("drops query() hits whose storageId has no documentId", async () => {
		mockQuery.mockResolvedValueOnce({
			query: "q",
			results: [
				{ content: "x", sourceType: "code", source: "s", storageId: "s1", score: 0.9 },
				{ content: "x", sourceType: "code", source: "s", storageId: "s-orphan", score: 0.7 },
			],
		});
		const seg = makeSegment([{ storageId: "s1", documentId: "doc-A" }]);
		const retrieve = buildLiveRetriever({
			embedder: {} as Embedder,
			vectorIndex: {} as VectorIndex,
			segments: [seg],
		});
		const hits = await retrieve("test", 5);
		expect(hits).toEqual([{ artifactId: "doc-A" }]);
	});

	it("forwards the topK arg into query()", async () => {
		mockQuery.mockResolvedValueOnce({ query: "q", results: [] });
		const retrieve = buildLiveRetriever({
			embedder: {} as Embedder,
			vectorIndex: {} as VectorIndex,
			segments: [],
		});
		await retrieve("test", 7);
		const lastCall = mockQuery.mock.calls.at(-1);
		expect(lastCall?.[3]).toEqual({ topK: 7 });
	});
});
