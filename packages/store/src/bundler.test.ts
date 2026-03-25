import type { StorageBackend, StorageResult } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { CID } from "multiformats/cid";
import { describe, expect, it } from "vitest";
import { bundleAndUpload } from "./bundler.js";

/** Creates a mock StorageBackend that records upload calls */
function mockStorage(result?: Partial<StorageResult>): StorageBackend & {
	uploadCalls: Array<{ data: Uint8Array; metadata?: Record<string, string> }>;
} {
	const uploadCalls: Array<{ data: Uint8Array; metadata?: Record<string, string> }> = [];
	return {
		uploadCalls,
		async upload(data: Uint8Array, metadata?: Record<string, string>): Promise<StorageResult> {
			uploadCalls.push({ data, metadata });
			return {
				id: "car-root-cid",
				pieceCid: "baga6ea4seaq-test-piece",
				ipfsCid: "car-root-cid",
				...result,
			};
		},
		async download(): Promise<Uint8Array> {
			return new Uint8Array();
		},
	};
}

function makeSegmentData(content: string): Uint8Array {
	return new TextEncoder().encode(JSON.stringify({ content, schemaVersion: 1 }));
}

describe("bundleAndUpload", () => {
	it("calls storage.upload() exactly once for multiple segments", async () => {
		const storage = mockStorage();
		const segments = [
			{ id: "seg-1", data: makeSegmentData("first segment") },
			{ id: "seg-2", data: makeSegmentData("second segment") },
		];

		const result = await bundleAndUpload(segments, storage);

		expect(storage.uploadCalls).toHaveLength(1);
		// PieceCID is now computed locally from the segments-only CAR
		const Piece = await import("@filoz/synapse-core/piece");
		expect(Piece.isPieceCID(CID.parse(result.batch.pieceCid))).toBe(true);
		// segmentIds contain IPFS CIDs (not input IDs) matching manifest segments[].id
		expect(result.batch.segmentIds).toHaveLength(2);
		for (const sid of result.batch.segmentIds) {
			expect(sid).toMatch(/^baf/);
		}
		expect(result.batch.carRootCid).toBeTruthy();
		expect(result.batch.createdAt).toBeTruthy();
	});

	it("passes prebuiltCar and carRootCid metadata to storage.upload()", async () => {
		const storage = mockStorage();
		const segments = [{ id: "seg-1", data: makeSegmentData("content") }];

		await bundleAndUpload(segments, storage);

		expect(storage.uploadCalls[0].metadata).toMatchObject({
			prebuiltCar: "true",
			carRootCid: expect.any(String),
		});
	});

	it("returns deterministic per-segment CIDs (same input → same CID)", async () => {
		const storage = mockStorage();
		const data = makeSegmentData("deterministic content");
		const segments = [{ id: "seg-1", data }];

		const result1 = await bundleAndUpload(segments, storage);
		const result2 = await bundleAndUpload(segments, storage);

		const cid1 = result1.segmentCids.get("seg-1");
		const cid2 = result2.segmentCids.get("seg-1");
		expect(cid1).toBeTruthy();
		expect(cid1).toBe(cid2);
	});

	it("returns a segmentCids entry for each input segment", async () => {
		const storage = mockStorage();
		const segments = [
			{ id: "seg-a", data: makeSegmentData("a") },
			{ id: "seg-b", data: makeSegmentData("b") },
		];

		const result = await bundleAndUpload(segments, storage);

		expect(result.segmentCids.size).toBe(2);
		expect(result.segmentCids.has("seg-a")).toBe(true);
		expect(result.segmentCids.has("seg-b")).toBe(true);
	});

	it("throws BUNDLE_NO_PIECE_CID when upload returns no pieceCid", async () => {
		const storage = mockStorage({ pieceCid: undefined });
		const segments = [{ id: "seg-1", data: makeSegmentData("content") }];

		await expect(bundleAndUpload(segments, storage)).rejects.toThrow(WtfocError);
		try {
			await bundleAndUpload(segments, storage);
		} catch (e) {
			expect(e).toBeInstanceOf(WtfocError);
			expect((e as WtfocError).code).toBe("BUNDLE_NO_PIECE_CID");
		}
	});

	it("throws BUNDLE_EMPTY for zero segments", async () => {
		const storage = mockStorage();

		await expect(bundleAndUpload([], storage)).rejects.toThrow(WtfocError);
		try {
			await bundleAndUpload([], storage);
		} catch (e) {
			expect(e).toBeInstanceOf(WtfocError);
			expect((e as WtfocError).code).toBe("BUNDLE_EMPTY");
		}
	});

	it("respects AbortSignal cancellation before upload", async () => {
		const storage = mockStorage();
		const segments = [{ id: "seg-1", data: makeSegmentData("content") }];
		const controller = new AbortController();
		controller.abort();

		await expect(bundleAndUpload(segments, storage, controller.signal)).rejects.toThrow();
		expect(storage.uploadCalls).toHaveLength(0);
	});

	it("[US2] per-segment CID matches bare CAR CID for same content", async () => {
		// Verify the bundler's per-segment CID matches what createCarFromFile({ bare: true }) produces.
		// Must use bare mode — bare CIDs are the raw content blocks that appear inside
		// directory CARs. Non-bare (wrapped) CIDs add a directory wrapper that doesn't
		// match blocks in the directory CAR (issue #139).
		const storage = mockStorage();
		const data = makeSegmentData("round-trip content");
		const segments = [{ id: "seg-rt", data }];

		const bundleResult = await bundleAndUpload(segments, storage);
		const cidFromBundle = bundleResult.segmentCids.get("seg-rt");

		// Independently compute the CID using bare mode (matching bundler)
		const fp = await import("filecoin-pin");
		const file = new File([Buffer.from(data)], "seg-rt.json", { type: "application/json" });
		const bareCar = await fp.createCarFromFile(file, { bare: true });
		const cidFromBare = bareCar.rootCid.toString();

		expect(cidFromBundle).toBe(cidFromBare);
	});

	it("[US2] SegmentSummary.id from bundler is a valid IPFS CID", async () => {
		const storage = mockStorage();
		const segments = [{ id: "seg-cid", data: makeSegmentData("cid check") }];

		const result = await bundleAndUpload(segments, storage);
		const cid = result.segmentCids.get("seg-cid");

		// IPFS CIDs start with "baf" (CIDv1 base32)
		expect(cid).toBeTruthy();
		expect(cid).toMatch(/^baf/);
	});
});
