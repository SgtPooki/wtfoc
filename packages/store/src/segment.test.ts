import type { Segment } from "@wtfoc/common";
import { SchemaUnknownError } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { deserializeSegment, serializeSegment } from "./segment.js";
import { expectWtfocCode } from "./test-helpers.js";

/** Deterministic embedding vector of length `dim` (must match `embeddingDimensions`). */
function embeddingOf(dim: number): number[] {
	return Array.from({ length: dim }, (_, i) => (i % 10) / 10);
}

function minimalValidSegment(overrides?: Partial<Segment>): Segment {
	const embeddingDimensions = 2;
	return {
		schemaVersion: 1,
		embeddingModel: "Xenova/all-MiniLM-L6-v2",
		embeddingDimensions,
		chunks: [
			{
				id: "chunk-1",
				storageId: "blob-abc",
				content: "test chunk content",
				embedding: embeddingOf(embeddingDimensions),
				terms: ["a"],
				source: "src",
				sourceType: "slack",
				metadata: { channel: "general" },
			},
		],
		edges: [
			{
				type: "references",
				sourceId: "a",
				targetType: "issue",
				targetId: "b",
				evidence: "link in message",
				confidence: 0.9,
			},
		],
		...overrides,
	};
}

describe("serializeSegment / deserializeSegment", () => {
	it("rejects invalid segments before serializing", () => {
		const bad = {
			...minimalValidSegment(),
			embeddingDimensions: 384,
			chunks: [{ ...minimalValidSegment().chunks[0], embedding: [0.1, 0.2] }],
		} as Segment;
		expectWtfocCode(() => serializeSegment(bad), "SCHEMA_INVALID");
	});

	it("round-trips a segment preserving all fields", () => {
		const original = minimalValidSegment();
		const bytes = serializeSegment(original);
		expect(bytes).toBeInstanceOf(Uint8Array);
		const back = deserializeSegment(bytes);
		expect(back).toEqual(original);
	});

	it("preserves embeddingModel and embeddingDimensions", () => {
		const embeddingDimensions = 768;
		const original = minimalValidSegment({
			embeddingModel: "custom-model",
			embeddingDimensions,
			chunks: [
				{
					...minimalValidSegment().chunks[0],
					embedding: embeddingOf(embeddingDimensions),
				},
			],
		});
		const back = deserializeSegment(serializeSegment(original));
		expect(back.embeddingModel).toBe("custom-model");
		expect(back.embeddingDimensions).toBe(768);
	});

	it("throws SchemaUnknownError when JSON has unsupported schemaVersion", () => {
		const bad = JSON.stringify({ ...minimalValidSegment(), schemaVersion: 99 });
		const bytes = new TextEncoder().encode(bad);
		expect(() => deserializeSegment(bytes)).toThrow(SchemaUnknownError);
	});

	it("throws WtfocError when JSON is malformed", () => {
		const bytes = new TextEncoder().encode("{ not valid json");
		expectWtfocCode(() => deserializeSegment(bytes), "SCHEMA_INVALID");
	});

	it("throws when JSON is not an object", () => {
		const bytes = new TextEncoder().encode(JSON.stringify([]));
		expectWtfocCode(() => deserializeSegment(bytes), "SCHEMA_INVALID");
	});

	it("rejects invalid chunk shape after parse", () => {
		const broken = {
			...minimalValidSegment(),
			chunks: [{ id: "x" }],
		};
		const bytes = new TextEncoder().encode(JSON.stringify(broken));
		expectWtfocCode(() => deserializeSegment(bytes), "SCHEMA_INVALID");
	});

	it("round-trips UTF-8 content in strings", () => {
		const original = minimalValidSegment({
			chunks: [
				{
					...minimalValidSegment().chunks[0],
					terms: ["日本語", "emoji-🙂"],
				},
			],
		});
		const back = deserializeSegment(serializeSegment(original));
		expect(back.chunks[0].terms).toEqual(["日本語", "emoji-🙂"]);
	});
});
