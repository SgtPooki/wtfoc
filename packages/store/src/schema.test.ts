import type { HeadManifest } from "@wtfoc/common";
import { SchemaUnknownError, WtfocError } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { MAX_SUPPORTED_SCHEMA_VERSION, validateManifestSchema } from "./schema.js";

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

	it("throws when segment summary is invalid", () => {
		const input = minimalValidManifest({
			segments: [{ id: "", sourceTypes: ["x"], chunkCount: 0 }],
		});
		expectWtfocCode(() => validateManifestSchema(input), "SCHEMA_INVALID");
	});
});
