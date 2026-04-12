import type { Chunk, CollectionHead, Segment } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { evaluateIngest } from "./ingest-evaluator.js";

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
	return {
		id: "chunk-1",
		content: "Some valid content that is long enough to not trigger warnings",
		sourceType: "github-issue",
		source: "owner/repo#1",
		sourceUrl: "https://github.com/owner/repo/issues/1",
		timestamp: "2026-01-01T00:00:00Z",
		documentId: "owner/repo#1",
		documentVersionId: "v1",
		contentFingerprint: "abc123",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
		...overrides,
	};
}

function makeSegment(chunks: Chunk[]): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 384,
		chunks: chunks.map((c) => ({
			...c,
			storageId: c.id,
			embedding: [],
			terms: [],
		})),
		edges: [],
	};
}

const HEAD = { name: "test-collection" } as CollectionHead;

describe("evaluateIngest", () => {
	it("reports correct chunk count and source-type distribution", async () => {
		const segments = [
			makeSegment([
				makeChunk({ id: "c1", sourceType: "github-issue" }),
				makeChunk({ id: "c2", sourceType: "github-issue" }),
			]),
			makeSegment([makeChunk({ id: "c3", sourceType: "slack-message" })]),
		];

		const result = await evaluateIngest(segments, HEAD);
		expect(result.metrics.totalChunks).toBe(3);
		const dist = result.metrics.sourceTypeDistribution as Record<string, number>;
		expect(dist["github-issue"]).toBe(2);
		expect(dist["slack-message"]).toBe(1);
	});

	it("catches missing required field 'id'", async () => {
		const segments = [makeSegment([makeChunk({ id: "" })])];

		const result = await evaluateIngest(segments, HEAD);
		const idCheck = result.checks.find((c) => c.name === "required:id");
		expect(idCheck).toBeDefined();
		expect(idCheck?.passed).toBe(false);
		expect(idCheck?.actual).toBe(1);
	});

	it("reports full metadata completeness when all fields present", async () => {
		const segments = [
			makeSegment([
				makeChunk({ documentId: "d1", documentVersionId: "v1", contentFingerprint: "fp1" }),
			]),
		];

		const result = await evaluateIngest(segments, HEAD);
		expect(result.metrics.documentIdRate).toBe(1);
		expect(result.metrics.documentVersionIdRate).toBe(1);
		expect(result.metrics.contentFingerprintRate).toBe(1);
	});

	it("reports partial metadata completeness", async () => {
		const segments = [
			makeSegment([
				makeChunk({ id: "c1", contentFingerprint: "fp1" }),
				makeChunk({ id: "c2", contentFingerprint: "" }),
				makeChunk({ id: "c3", contentFingerprint: undefined as unknown as string }),
				makeChunk({ id: "c4", contentFingerprint: "fp4" }),
			]),
		];

		const result = await evaluateIngest(segments, HEAD);
		expect(result.metrics.contentFingerprintRate).toBe(0.5);
	});

	it("flags short and long chunks as warnings", async () => {
		const segments = [
			makeSegment([
				makeChunk({ id: "c1", content: "tiny" }), // 4 chars < 50
				makeChunk({ id: "c2", content: "x".repeat(12000) }), // > 10000
			]),
		];

		const result = await evaluateIngest(segments, HEAD);
		expect(result.verdict).toBe("warn");
		const sizingChecks = result.checks.filter((c) => c.name.startsWith("sizing:"));
		expect(sizingChecks.some((c) => !c.passed)).toBe(true);
	});

	it("returns 'pass' for well-formed collection", async () => {
		const segments = [makeSegment([makeChunk({ id: "c1" }), makeChunk({ id: "c2" })])];

		const result = await evaluateIngest(segments, HEAD);
		expect(result.verdict).toBe("pass");
	});

	it("reports per-source-type metadata breakdown", async () => {
		const segments = [
			makeSegment([
				makeChunk({ id: "c1", sourceType: "github-issue", documentId: "d1" }),
				makeChunk({ id: "c2", sourceType: "github-issue", documentId: "d2" }),
				makeChunk({ id: "c3", sourceType: "slack-message", documentId: "" }),
				makeChunk({ id: "c4", sourceType: "slack-message", documentId: "" }),
			]),
		];

		const result = await evaluateIngest(segments, HEAD);
		const perSource = result.metrics.perSourceType as Record<string, { documentIdRate: number }>;
		expect(perSource["github-issue"].documentIdRate).toBe(1);
		expect(perSource["slack-message"].documentIdRate).toBe(0);
	});
});
