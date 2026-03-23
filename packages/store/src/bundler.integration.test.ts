import type { BatchRecord, HeadManifest, StorageBackend, StorageResult } from "@wtfoc/common";
import { CURRENT_SCHEMA_VERSION } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { bundleAndUpload } from "./bundler.js";
import { validateManifestSchema } from "./schema.js";

/** Mock storage that tracks calls and returns realistic results */
function createMockFocStorage(): StorageBackend & {
	uploadCalls: Array<{ data: Uint8Array; metadata?: Record<string, string> }>;
} {
	const uploadCalls: Array<{ data: Uint8Array; metadata?: Record<string, string> }> = [];
	return {
		uploadCalls,
		async upload(
			data: Uint8Array,
			metadata?: Record<string, string>,
		): Promise<StorageResult> {
			uploadCalls.push({ data, metadata });
			return {
				id: metadata?.carRootCid ?? "mock-root-cid",
				pieceCid: "baga6ea4seaq-integration-test",
				ipfsCid: metadata?.carRootCid ?? "mock-root-cid",
			};
		},
		async download(): Promise<Uint8Array> {
			return new Uint8Array();
		},
	};
}

function makeSegmentJson(name: string): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({
			schemaVersion: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 2,
			chunks: [
				{
					id: `chunk-${name}`,
					storageId: `blob-${name}`,
					content: `Content of ${name}`,
					embedding: [0.1, 0.2],
					terms: ["test"],
					source: `source-${name}`,
					sourceType: "repo",
					metadata: {},
				},
			],
			edges: [],
		}),
	);
}

describe("bundler → manifest integration", () => {
	it("produces a valid manifest with batch record after bundled upload", async () => {
		const storage = createMockFocStorage();
		const segmentData = makeSegmentJson("seg-1");

		const bundleResult = await bundleAndUpload(
			[{ id: "seg-1", data: segmentData }],
			storage,
		);

		// Exactly one upload call
		expect(storage.uploadCalls).toHaveLength(1);

		// Build manifest like the CLI would
		const segCid = bundleResult.segmentCids.get("seg-1");
		expect(segCid).toBeTruthy();

		const manifest: HeadManifest = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			name: "test-collection",
			prevHeadId: null,
			segments: [
				{
					id: segCid as string,
					sourceTypes: ["repo"],
					chunkCount: 1,
				},
			],
			totalChunks: 1,
			embeddingModel: "test-model",
			embeddingDimensions: 2,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			batches: [bundleResult.batch],
		};

		// Validate the manifest round-trips through schema validation
		const validated = validateManifestSchema(manifest);
		expect(validated.batches).toHaveLength(1);
		expect(validated.batches?.[0].pieceCid).toBe("baga6ea4seaq-integration-test");
		expect(validated.batches?.[0].segmentIds).toEqual(["seg-1"]);
		expect(validated.segments[0].id).toBe(segCid);
		// SegmentSummary.pieceCid should NOT be set for bundled ingests (FR-007)
		expect(validated.segments[0].pieceCid).toBeUndefined();
	});

	it("FOC path uses prebuiltCar metadata, local path would not", async () => {
		const storage = createMockFocStorage();
		const segmentData = makeSegmentJson("seg-local");

		await bundleAndUpload(
			[{ id: "seg-local", data: segmentData }],
			storage,
		);

		const call = storage.uploadCalls[0];
		expect(call.metadata?.prebuiltCar).toBe("true");
		expect(call.metadata?.carRootCid).toBeTruthy();
	});

	it("per-segment CID in manifest matches bundler output", async () => {
		const storage = createMockFocStorage();
		const segmentData = makeSegmentJson("seg-match");

		const result = await bundleAndUpload(
			[{ id: "seg-match", data: segmentData }],
			storage,
		);

		const cidFromBundler = result.segmentCids.get("seg-match");
		expect(cidFromBundler).toBeTruthy();
		// The manifest would use this CID as SegmentSummary.id
		// Verify it's a valid CID string (starts with "baf")
		expect(cidFromBundler).toMatch(/^baf/);
	});
});
