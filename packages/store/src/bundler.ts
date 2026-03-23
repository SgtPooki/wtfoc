import type { BatchRecord, StorageBackend, StorageResult } from "@wtfoc/common";
import { StorageUnreachableError, WtfocError } from "@wtfoc/common";

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

	// Step 1: Compute per-segment CIDs deterministically via bare CAR creation
	const segmentCids = new Map<string, string>();
	for (const seg of segments) {
		signal?.throwIfAborted();
		const file = new File([Buffer.from(seg.data)], `${seg.id}.json`, {
			type: "application/json",
		});
		const bareCar = await fp.createCarFromFile(file, { bare: true });
		segmentCids.set(seg.id, bareCar.rootCid.toString());
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
	let result: StorageResult;
	try {
		result = await storage.upload(
			dirCar.carBytes,
			{ prebuiltCar: "true", carRootCid },
			signal,
		);
	} catch (err) {
		if (err instanceof StorageUnreachableError) throw err;
		throw new StorageUnreachableError(
			"foc",
			err instanceof Error ? err : new Error(String(err)),
		);
	}

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
		segmentIds: segments.map((s) => s.id),
		createdAt: new Date().toISOString(),
	};

	return { batch, segmentCids };
}
