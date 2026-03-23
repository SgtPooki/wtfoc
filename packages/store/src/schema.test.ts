import type { CollectionHead } from "@wtfoc/common";
import { SchemaUnknownError, WtfocError } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import {
	MAX_SUPPORTED_SCHEMA_VERSION,
	validateManifestSchema,
	validateSegmentSchema,
} from "./schema.js";
import { expectWtfocCode } from "./test-helpers.js";

function minimalValidManifest(overrides?: Partial<CollectionHead>): CollectionHead {
	return {
		schemaVersion: 1,
		collectionId: "test-collection-id",
		name: "proj",
		currentRevisionId: null,
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
				content: "test chunk content",
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

		expectWtfocCode(
			() => validateManifestSchema({ ...base, schemaVersion: 1.5 }),
			"SCHEMA_INVALID",
		);
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

	it("accepts a manifest without batches (pre-bundling / local-only)", () => {
		const input = minimalValidManifest();
		const out = validateManifestSchema(input);
		expect(out.batches).toBeUndefined();
	});

	it("accepts a manifest with a valid batches array", () => {
		const input = minimalValidManifest({
			batches: [
				{
					pieceCid: "baga6ea4seaq1234",
					carRootCid: "bafybeigdyrzt",
					segmentIds: ["seg-1"],
					createdAt: "2026-03-23T12:00:00.000Z",
				},
			],
		});
		const out = validateManifestSchema(input);
		expect(out.batches).toHaveLength(1);
		expect(out.batches?.[0].pieceCid).toBe("baga6ea4seaq1234");
		expect(out.batches?.[0].carRootCid).toBe("bafybeigdyrzt");
		expect(out.batches?.[0].segmentIds).toEqual(["seg-1"]);
	});

	it("accepts a manifest with an empty batches array", () => {
		const input = minimalValidManifest({ batches: [] });
		const out = validateManifestSchema(input);
		expect(out.batches).toEqual([]);
	});

	it("throws when batch record has empty pieceCid", () => {
		const input = minimalValidManifest({
			batches: [
				{
					pieceCid: "",
					carRootCid: "bafybeigdyrzt",
					segmentIds: ["seg-1"],
					createdAt: "2026-03-23T12:00:00.000Z",
				},
			],
		});
		expectWtfocCode(() => validateManifestSchema(input), "SCHEMA_INVALID");
	});

	it("throws when batch record has empty segmentIds", () => {
		const input = minimalValidManifest({
			batches: [
				{
					pieceCid: "baga6ea4seaq1234",
					carRootCid: "bafybeigdyrzt",
					segmentIds: [],
					createdAt: "2026-03-23T12:00:00.000Z",
				},
			],
		});
		expectWtfocCode(() => validateManifestSchema(input), "SCHEMA_INVALID");
	});

	it("throws when batch record is not an object", () => {
		const input = { ...minimalValidManifest(), batches: ["not-an-object"] };
		expectWtfocCode(() => validateManifestSchema(input), "SCHEMA_INVALID");
	});

	it("throws when batch createdAt is not a valid date", () => {
		const input = minimalValidManifest({
			batches: [
				{
					pieceCid: "baga6ea4seaq1234",
					carRootCid: "bafybeigdyrzt",
					segmentIds: ["seg-1"],
					createdAt: "not-a-date",
				},
			],
		});
		expectWtfocCode(() => validateManifestSchema(input), "SCHEMA_INVALID");
	});

	it("throws when batch segmentIds references unknown segment", () => {
		const input = minimalValidManifest({
			batches: [
				{
					pieceCid: "baga6ea4seaq1234",
					carRootCid: "bafybeigdyrzt",
					segmentIds: ["nonexistent-segment"],
					createdAt: "2026-03-23T12:00:00.000Z",
				},
			],
		});
		expectWtfocCode(() => validateManifestSchema(input), "SCHEMA_INVALID");
	});

	it("throws when same segment appears in multiple batches", () => {
		const input = minimalValidManifest({
			segments: [{ id: "seg-1", sourceTypes: ["repo"], chunkCount: 1 }],
			batches: [
				{
					pieceCid: "baga-batch1",
					carRootCid: "bafy-root1",
					segmentIds: ["seg-1"],
					createdAt: "2026-03-23T12:00:00.000Z",
				},
				{
					pieceCid: "baga-batch2",
					carRootCid: "bafy-root2",
					segmentIds: ["seg-1"],
					createdAt: "2026-03-23T13:00:00.000Z",
				},
			],
		});
		expectWtfocCode(() => validateManifestSchema(input), "SCHEMA_INVALID");
	});

	it("accepts mixed-history manifest with pre-bundling pieceCid on segments and batch records", () => {
		const input = minimalValidManifest({
			segments: [
				{ id: "seg-old", sourceTypes: ["repo"], chunkCount: 5, pieceCid: "old-piece-cid" },
				{ id: "seg-new", sourceTypes: ["repo"], chunkCount: 10 },
			],
			batches: [
				{
					pieceCid: "new-batch-piece-cid",
					carRootCid: "bafynewroot",
					segmentIds: ["seg-new"],
					createdAt: "2026-03-23T14:00:00.000Z",
				},
			],
		});
		const out = validateManifestSchema(input);
		expect(out.segments[0].pieceCid).toBe("old-piece-cid");
		expect(out.segments[1].pieceCid).toBeUndefined();
		expect(out.batches).toHaveLength(1);
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
		expectWtfocCode(
			() => validateSegmentSchema({ ...minimalValidSegmentRecord(), schemaVersion: 99 }),
			"SCHEMA_UNKNOWN",
		);
	});

	it("rejects embedding vector length that does not match embeddingDimensions", () => {
		const bad = minimalValidSegmentRecord({
			embeddingDimensions: 384,
			chunks: [
				{
					...((minimalValidSegmentRecord().chunks as unknown[])[0] as Record<string, unknown>),
					embedding: [0.1, 0.2],
				},
			],
		});
		expectWtfocCode(() => validateSegmentSchema(bad), "SCHEMA_INVALID");
	});

	it("includes full field path in error context for invalid nested chunk field", () => {
		const base = minimalValidSegmentRecord().chunks as unknown[];
		const chunk0 = { ...(base[0] as Record<string, unknown>), id: "" };
		try {
			validateSegmentSchema(minimalValidSegmentRecord({ chunks: [chunk0] }));
			expect.fail("expected throw");
		} catch (e) {
			expect(e).toBeInstanceOf(WtfocError);
			expect((e as WtfocError).context?.field).toBe("chunks[0].id");
		}
	});

	it("rejects invalid edge shape", () => {
		const bad = minimalValidSegmentRecord({
			edges: [{ type: "x" }],
		});
		expectWtfocCode(() => validateSegmentSchema(bad), "SCHEMA_INVALID");
	});

	it("accepts optional chunk sourceUrl and timestamp", () => {
		const chunk = {
			...((minimalValidSegmentRecord().chunks as unknown[])[0] as Record<string, unknown>),
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
			...((minimalValidSegmentRecord().chunks as unknown[])[0] as Record<string, unknown>),
			sourceUrl: 123,
		};
		expectWtfocCode(
			() => validateSegmentSchema(minimalValidSegmentRecord({ chunks: [chunk] })),
			"SCHEMA_INVALID",
		);
	});
});
