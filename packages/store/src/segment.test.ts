import type { Segment } from "@wtfoc/common";
import { SchemaUnknownError, WtfocError } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { deserializeSegment, serializeSegment } from "./segment.js";

function expectWtfocCode(fn: () => void, code: string) {
	let threw = false;
	try {
		fn();
	} catch (e) {
		threw = true;
		expect(e).toBeInstanceOf(WtfocError);
		expect((e as WtfocError).code).toBe(code);
	}
	expect(threw).toBe(true);
}

function minimalValidSegment(overrides?: Partial<Segment>): Segment {
	return {
		schemaVersion: 1,
		embeddingModel: "Xenova/all-MiniLM-L6-v2",
		embeddingDimensions: 384,
		chunks: [
			{
				id: "chunk-1",
				storageId: "blob-abc",
				embedding: [0.1, 0.2],
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
	it("round-trips a segment preserving all fields", () => {
		const original = minimalValidSegment();
		const bytes = serializeSegment(original);
		expect(bytes).toBeInstanceOf(Uint8Array);
		const back = deserializeSegment(bytes);
		expect(back).toEqual(original);
	});

	it("preserves embeddingModel and embeddingDimensions", () => {
		const original = minimalValidSegment({
			embeddingModel: "custom-model",
			embeddingDimensions: 768,
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
