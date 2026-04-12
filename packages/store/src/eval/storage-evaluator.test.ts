import type { CollectionHead, StorageBackend } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { evaluateStorage } from "./storage-evaluator.js";

function makeHead(
	segmentIds: string[],
	derivedEdgeLayers?: CollectionHead["derivedEdgeLayers"],
): CollectionHead {
	return {
		schemaVersion: 1,
		collectionId: "test",
		name: "test-collection",
		currentRevisionId: null,
		prevHeadId: null,
		segments: segmentIds.map((id) => ({
			id,
			sourceTypes: ["code"],
			chunkCount: 2,
		})),
		totalChunks: segmentIds.length * 2,
		embeddingModel: "test",
		embeddingDimensions: 384,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
		derivedEdgeLayers,
	};
}

function makeStorage(data: Record<string, unknown>): StorageBackend {
	return {
		upload: vi.fn(),
		download: vi.fn(async (id: string) => {
			const val = data[id];
			if (val === undefined) throw new Error(`Not found: ${id}`);
			if (typeof val === "string") return new TextEncoder().encode(val);
			return new TextEncoder().encode(JSON.stringify(val));
		}),
		exists: vi.fn(),
	} as unknown as StorageBackend;
}

const validSegment = {
	schemaVersion: 1,
	embeddingModel: "test",
	embeddingDimensions: 384,
	chunks: [
		{
			id: "c1",
			storageId: "c1",
			content: "hi",
			embedding: [],
			terms: [],
			source: "test",
			sourceType: "code",
			sourceUrl: "",
			timestamp: "",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
		},
		{
			id: "c2",
			storageId: "c2",
			content: "ho",
			embedding: [],
			terms: [],
			source: "test",
			sourceType: "code",
			sourceUrl: "",
			timestamp: "",
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {},
		},
	],
	edges: [],
};

describe("evaluateStorage", () => {
	it("reports correct counts when all segments download cleanly", async () => {
		const storage = makeStorage({ seg1: validSegment, seg2: validSegment });
		const head = makeHead(["seg1", "seg2"]);

		const result = await evaluateStorage(head, storage);
		expect(result.metrics.segmentCount).toBe(2);
		expect(result.metrics.totalChunks).toBe(4);
		expect(result.verdict).toBe("pass");
	});

	it("verdict 'fail' when a segment fails to download", async () => {
		const storage = makeStorage({ seg1: validSegment });
		const head = makeHead(["seg1", "seg2"]); // seg2 missing

		const result = await evaluateStorage(head, storage);
		expect(result.verdict).toBe("fail");
		const failedCheck = result.checks.find((c) => c.name === "segment:seg2" && !c.passed);
		expect(failedCheck).toBeDefined();
	});

	it("verdict 'fail' when segment parses as invalid JSON", async () => {
		const storage = makeStorage({ seg1: "not json at all" });
		const head = makeHead(["seg1"]);

		const result = await evaluateStorage(head, storage);
		expect(result.verdict).toBe("fail");
	});

	it("derived edge layer dangling ref detected", async () => {
		const layer = [
			{
				type: "references",
				sourceId: "nonexistent",
				targetType: "doc",
				targetId: "c1",
				evidence: "test",
				confidence: 0.8,
			},
		];
		const storage = makeStorage({ seg1: validSegment, layer1: layer });
		const head = makeHead(
			["seg1"],
			[
				{
					id: "layer1",
					extractorModel: "test",
					edgeCount: 1,
					createdAt: "2026-01-01",
					contextsProcessed: 1,
				},
			],
		);

		const result = await evaluateStorage(head, storage);
		expect(result.verdict).toBe("warn");
		expect(result.metrics.derivedLayerDanglingRefs).toBe(1);
	});

	it("clean collection yields 'pass'", async () => {
		const storage = makeStorage({ seg1: validSegment });
		const head = makeHead(["seg1"]);

		const result = await evaluateStorage(head, storage);
		expect(result.verdict).toBe("pass");
	});
});
