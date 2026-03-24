import type { BatchRecord, StorageBackend } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";

/** Input segment for bundling — id + serialized bytes */
export interface BundleSegment {
	id: string;
	data: Uint8Array;
}

/** Result of the bundle-and-upload orchestration */
export interface BundleUploadResult {
	/** The batch record to add to the manifest */
	batch: BatchRecord;
	/** Per-segment CID map (segmentId → IPFS CID) */
	segmentCids: Map<string, string>;
}

/**
 * Bundle multiple segments into a single CAR file and upload via the
 * given storage backend. Returns a BatchRecord and per-segment CID map.
 *
 * - Computes per-segment CIDs deterministically before upload (FR-003)
 * - Builds a directory CAR with stable paths: segments/{segmentId}.json (FR-001)
 * - Calls storage.upload() once with the pre-built CAR bytes (FR-010)
 * - Verifies the upload result includes a valid PieceCID (FR-011)
 * - Respects AbortSignal for cancellation (FR-012)
 */
export async function bundleAndUpload(
	segments: BundleSegment[],
	storage: StorageBackend,
	signal?: AbortSignal,
): Promise<BundleUploadResult> {
	if (segments.length === 0) {
		throw new WtfocError(
			"Cannot bundle zero segments — skip bundling for empty ingests",
			"BUNDLE_EMPTY",
		);
	}

	signal?.throwIfAborted();

	const fp = await import("filecoin-pin");

	// Step 1: Compute per-segment CIDs deterministically via wrapped (non-bare) CAR creation.
	// IMPORTANT: Must NOT use { bare: true } — bare mode uses addByteStream which produces
	// a raw content CID, while directory CARs use addFile/addAll which produces a UnixFS
	// file CID. The CIDs must match what's inside the directory CAR for retrieval to work.
	const segmentCids = new Map<string, string>();
	for (const seg of segments) {
		signal?.throwIfAborted();
		const file = new File([Buffer.from(seg.data)], `${seg.id}.json`, {
			type: "application/json",
		});
		const wrappedCar = await fp.createCarFromFile(file);
		segmentCids.set(seg.id, wrappedCar.rootCid.toString());
	}

	signal?.throwIfAborted();

	// Step 2: Build directory CAR with stable paths segments/{segmentId}.json
	const files: File[] = segments.map(
		(seg) =>
			new File([Buffer.from(seg.data)], `segments/${seg.id}.json`, {
				type: "application/json",
			}),
	);

	let dirCar: { carBytes: Uint8Array; rootCid: { toString(): string } };
	try {
		dirCar = await fp.createCarFromFiles(files);
	} catch (err) {
		throw new WtfocError(
			`CAR assembly failed: ${err instanceof Error ? err.message : String(err)}`,
			"BUNDLE_ASSEMBLY_FAILED",
			{ cause: err },
		);
	}

	signal?.throwIfAborted();

	const carRootCid = dirCar.rootCid.toString();

	// Step 3: Upload the pre-built CAR via storage backend
	const result = await storage.upload(dirCar.carBytes, { prebuiltCar: "true", carRootCid }, signal);

	// Step 4: Verify PieceCID (FR-011)
	if (!result.pieceCid) {
		throw new WtfocError(
			"Bundle upload succeeded but no PieceCID returned — cannot verify on-chain storage",
			"BUNDLE_NO_PIECE_CID",
		);
	}

	// Step 5: Build BatchRecord
	const batch: BatchRecord = {
		pieceCid: result.pieceCid,
		carRootCid,
		segmentIds: segments.map((s) => {
			const cid = segmentCids.get(s.id);
			if (!cid) throw new WtfocError(`Missing CID for segment ${s.id}`, "BUNDLE_INTERNAL");
			return cid;
		}),
		createdAt: new Date().toISOString(),
	};

	return { batch, segmentCids };
}
