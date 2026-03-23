import type { HeadManifest } from "@wtfoc/common";
import { SchemaUnknownError, WtfocError } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { MAX_SUPPORTED_SCHEMA_VERSION, validateManifestSchema, validateSegmentSchema } from "./schema.js";
import { expectWtfocCode } from "./test-helpers.js";

function minimalValidManifest(overrides?: Partial<HeadManifest>): HeadManifest {
	return {
		schemaVersion: 1,
		name: "proj",
		prevHeadId: null,
		segments: [
			{
				id: "seg-1",
				sourceTypes: ["slack"],
				chunkCount: 1,
			},
		],
		totalChunks: 1,
		embeddingModel: "Xenova/all-MiniLM-L6-v2",
		embeddingDimensions: 384,
		createdAt: "2026-03-23T00:00:00.000Z",
		updatedAt: "2026-03-23T01:00:00.000Z",
		...overrides,
	};
}

function minimalValidSegmentRecord(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {
		schemaVersion: 1,
		embeddingModel: "Xenova/all-MiniLM-L6-v2",
		embeddingDimensions: 2,
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

describe("validateManifestSchema", () => {
	it("accepts a valid manifest and returns a typed HeadManifest", () => {
		const input = minimalValidManifest();
		const out = validateManifestSchema(input);
		expect(out).toEqual(input);
		expect(out.schemaVersion).toBe(1);
	});

	it("throws SchemaUnknownError for schemaVersion above max supported", () => {
		const input = minimalValidManifest({ schemaVersion: 99 });
		expect(() => validateManifestSchema(input)).toThrow(SchemaUnknownError);
		try {
			validateManifestSchema(input);
		} catch (e) {
			expect(e).toBeInstanceOf(SchemaUnknownError);
			expect((e as SchemaUnknownError).code).toBe("SCHEMA_UNKNOWN");
			expect((e as SchemaUnknownError).context).toMatchObject({
				found: 99,
				maxSupported: MAX_SUPPORTED_SCHEMA_VERSION,
			});
		}
	});

	it("throws SchemaUnknownError for schemaVersion below 1", () => {
		const input = minimalValidManifest({ schemaVersion: 0 });
		expect(() => validateManifestSchema(input)).toThrow(SchemaUnknownError);
	});

	it("throws when root is not an object", () => {
		expectWtfocCode(() => validateManifestSchema(null), "SCHEMA_INVALID");
		expectWtfocCode(() => validateManifestSchema("x"), "SCHEMA_INVALID");
	});

	it("throws when schemaVersion is missing or not an integer", () => {
		const base = { ...minimalValidManifest() };
		const { schemaVersion: _s, ...withoutVersion } = base;
		expectWtfocCode(() => validateManifestSchema(withoutVersion), "SCHEMA_INVALID");

		expectWtfocCode(() => validateManifestSchema({ ...base, schemaVersion: 1.5 }), "SCHEMA_INVALID");
	});

	it("throws when required top-level fields are missing", () => {
		const full = minimalValidManifest();
		for (const key of [
			"name",
			"prevHeadId",
			"segments",
			"totalChunks",
			"embeddingModel",
			"embeddingDimensions",
			"createdAt",
			"updatedAt",
		] as const) {
			const bad = { ...full };
			delete (bad as Record<string, unknown>)[key];
			expectWtfocCode(() => validateManifestSchema(bad), "SCHEMA_INVALID");
		}
	});

	it("throws a clear error when prevHeadId is omitted", () => {
		const full = minimalValidManifest();
		const { prevHeadId: _p, ...withoutPrev } = full;
		try {
			validateManifestSchema(withoutPrev);
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(WtfocError);
			expect((e as WtfocError).message).toContain("prevHeadId is required");
		}
	});

	it("throws when segment summary is invalid", () => {
		const input = minimalValidManifest({
			segments: [{ id: "", sourceTypes: ["x"], chunkCount: 0 }],
		});
		expectWtfocCode(() => validateManifestSchema(input), "SCHEMA_INVALID");
	});
});

describe("validateSegmentSchema", () => {
	it("accepts a valid segment record", () => {
		const input = minimalValidSegmentRecord();
		const out = validateSegmentSchema(input);
		expect(out.schemaVersion).toBe(1);
		expect(out.chunks).toHaveLength(1);
		expect(out.edges).toHaveLength(1);
	});

	it("throws SchemaUnknownError for unsupported schemaVersion", () => {
		expectWtfocCode(() => validateSegmentSchema({ ...minimalValidSegmentRecord(), schemaVersion: 99 }), "SCHEMA_UNKNOWN");
	});

	it("rejects embedding vector length that does not match embeddingDimensions", () => {
		const bad = minimalValidSegmentRecord({
			embeddingDimensions: 384,
			chunks: [
				{
					...(minimalValidSegmentRecord().chunks as unknown[])[0] as Record<string, unknown>,
					embedding: [0.1, 0.2],
				},
			],
		});
		expectWtfocCode(() => validateSegmentSchema(bad), "SCHEMA_INVALID");
	});

	it("rejects invalid edge shape", () => {
		const bad = minimalValidSegmentRecord({
			edges: [{ type: "x" }],
		});
		expectWtfocCode(() => validateSegmentSchema(bad), "SCHEMA_INVALID");
	});

	it("accepts optional chunk sourceUrl and timestamp", () => {
		const chunk = {
			...(minimalValidSegmentRecord().chunks as unknown[])[0] as Record<string, unknown>,
			sourceUrl: "https://example.com",
			timestamp: "2026-01-01T00:00:00.000Z",
		};
		const input = minimalValidSegmentRecord({ chunks: [chunk] });
		const out = validateSegmentSchema(input);
		expect(out.chunks[0].sourceUrl).toBe("https://example.com");
		expect(out.chunks[0].timestamp).toBe("2026-01-01T00:00:00.000Z");
	});

	it("rejects wrong type for optional chunk.sourceUrl", () => {
		const chunk = {
			...(minimalValidSegmentRecord().chunks as unknown[])[0] as Record<string, unknown>,
			sourceUrl: 123,
		};
		expectWtfocCode(() => validateSegmentSchema(minimalValidSegmentRecord({ chunks: [chunk] })), "SCHEMA_INVALID");
	});
});
