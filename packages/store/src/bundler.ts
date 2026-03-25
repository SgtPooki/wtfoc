import type { BatchRecord, CollectionHead, StorageBackend } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";

/** Result of IPNI validation for a single CID */
export interface IpniValidationResult {
	cid: string;
	indexed: boolean;
}

/**
 * Validate that CIDs are indexed on IPNI by querying filecoinpin.contact.
 * Returns results for each CID. Does not throw on 404 — caller decides policy.
 */
export async function validateIpniIndexing(
	cids: string[],
	options?: { indexerUrl?: string; signal?: AbortSignal },
): Promise<IpniValidationResult[]> {
	const baseUrl = options?.indexerUrl ?? "https://filecoinpin.contact";
	const results: IpniValidationResult[] = [];

	for (const cid of cids) {
		options?.signal?.throwIfAborted();
		try {
			const response = await fetch(`${baseUrl}/cid/${cid}`, {
				signal: options?.signal,
			});
			results.push({ cid, indexed: response.ok });
		} catch {
			results.push({ cid, indexed: false });
		}
	}

	return results;
}

/**
 * Compute bare (raw content) CIDs for a set of segments.
 * These CIDs match the actual blocks inside directory CARs.
 */
export async function computeSegmentCids(
	segments: BundleSegment[],
	signal?: AbortSignal,
): Promise<Map<string, string>> {
	const fp = await import("filecoin-pin");
	const cids = new Map<string, string>();
	for (const seg of segments) {
		signal?.throwIfAborted();
		const file = new File([Buffer.from(seg.data)], `${seg.id}.json`, {
			type: "application/json",
		});
		const bareCar = await fp.createCarFromFile(file, { bare: true });
		cids.set(seg.id, bareCar.rootCid.toString());
	}
	return cids;
}

/** Input segment for bundling — id + serialized bytes */
export interface BundleSegment {
	id: string;
	data: Uint8Array;
}

/** Options for bundleAndUpload */
export interface BundleOptions {
	/**
	 * Manifest builder: receives segment CIDs and the pre-computed PieceCID
	 * of the segments-only CAR, returns a CollectionHead to include in the
	 * final CAR. This lets the manifest contain the full batch record.
	 */
	buildManifest?: (info: {
		segmentCids: Map<string, string>;
		pieceCid: string;
		carRootCid: string;
	}) => CollectionHead;
	/** Number of storage copies (default 2) */
	copies?: number;
	signal?: AbortSignal;
}

/** Result of the bundle-and-upload orchestration */
export interface BundleUploadResult {
	/** The batch record to add to the manifest */
	batch: BatchRecord;
	/** Per-segment CID map (segmentId → IPFS CID) */
	segmentCids: Map<string, string>;
	/** CID of the manifest within the CAR (if buildManifest was provided) */
	manifestCid?: string;
	/** Segment + manifest CIDs that should be validated on IPNI */
	childBlockCids: string[];
}

/**
 * Bundle segments into a single CAR and upload once.
 *
 * Flow:
 * 1. Compute per-segment bare CIDs (raw content, matches directory CAR blocks)
 * 2. Build segments-only CAR → stable bytes
 * 3. Compute PieceCID locally from segments-only CAR via @filoz/synapse-core
 * 4. If buildManifest provided: build manifest with full batch record (incl PieceCID),
 *    then build final CAR with segments + manifest
 * 5. Validate all segment CIDs exist as blocks in the final CAR
 * 6. Upload once
 */
export async function bundleAndUpload(
	segments: BundleSegment[],
	storage: StorageBackend,
	optionsOrSignal?: BundleOptions | AbortSignal,
): Promise<BundleUploadResult> {
	// Support legacy signature: bundleAndUpload(segments, storage, signal?)
	const options: BundleOptions =
		optionsOrSignal instanceof AbortSignal ? { signal: optionsOrSignal } : (optionsOrSignal ?? {});
	const { signal, buildManifest, copies } = options;

	if (segments.length === 0) {
		throw new WtfocError(
			"Cannot bundle zero segments — skip bundling for empty ingests",
			"BUNDLE_EMPTY",
		);
	}

	signal?.throwIfAborted();

	const fp = await import("filecoin-pin");
	const { CarBlockIterator } = await import("@ipld/car");
	const Piece = await import("@filoz/synapse-core/piece");

	// Step 1: Compute per-segment CIDs using bare mode (raw content CIDs).
	// Bare mode produces the same CID as the raw content block inside the
	// directory CAR. Non-bare (wrapped) mode adds a directory wrapper node
	// whose CID does NOT appear in the directory CAR — that's the bug (#139).
	const segmentCids = await computeSegmentCids(segments, signal);

	signal?.throwIfAborted();

	// Step 2: Build segments-only CAR (stable bytes — content doesn't change)
	const segmentFiles: File[] = segments.map(
		(seg) =>
			new File([Buffer.from(seg.data)], `segments/${seg.id}.json`, {
				type: "application/json",
			}),
	);

	let segmentsCar: { carBytes: Uint8Array; rootCid: { toString(): string } };
	try {
		segmentsCar = await fp.createCarFromFiles(segmentFiles);
	} catch (err) {
		throw new WtfocError(
			`CAR assembly failed: ${err instanceof Error ? err.message : String(err)}`,
			"BUNDLE_ASSEMBLY_FAILED",
			{ cause: err },
		);
	}

	signal?.throwIfAborted();

	// Step 3: Compute PieceCID locally from the segments-only CAR.
	// This is deterministic and doesn't require a network call.
	// The PieceCID is for the segments-only CAR, NOT the final CAR —
	// this is intentional and avoids the chicken-and-egg problem.
	const segmentsPieceCid = Piece.calculate(segmentsCar.carBytes).toString();
	const segmentsCarRootCid = segmentsCar.rootCid.toString();

	// Step 4: Build batch record with the pre-computed PieceCID
	const batch: BatchRecord = {
		pieceCid: segmentsPieceCid,
		carRootCid: segmentsCarRootCid,
		segmentIds: segments.map((s) => {
			const cid = segmentCids.get(s.id);
			if (!cid) throw new WtfocError(`Missing CID for segment ${s.id}`, "BUNDLE_INTERNAL");
			return cid;
		}),
		createdAt: new Date().toISOString(),
	};

	// Step 5: Build the final CAR — segments + manifest (if provided)
	let finalCar = segmentsCar;
	let manifestCid: string | undefined;

	if (buildManifest) {
		const manifest = buildManifest({
			segmentCids,
			pieceCid: segmentsPieceCid,
			carRootCid: segmentsCarRootCid,
		});

		const manifestJson = JSON.stringify(manifest);
		const manifestBytes = new TextEncoder().encode(manifestJson);
		const manifestFile = new File([Buffer.from(manifestBytes)], "manifest.json", {
			type: "application/json",
		});

		// Compute manifest CID (bare = raw content)
		const manifestCar = await fp.createCarFromFile(manifestFile, { bare: true });
		manifestCid = manifestCar.rootCid.toString();

		// Build final CAR with segments + manifest
		try {
			finalCar = await fp.createCarFromFiles([...segmentFiles, manifestFile]);
		} catch (err) {
			throw new WtfocError(
				`Final CAR assembly failed: ${err instanceof Error ? err.message : String(err)}`,
				"BUNDLE_ASSEMBLY_FAILED",
				{ cause: err },
			);
		}
	}

	signal?.throwIfAborted();

	// Step 6: Pre-upload validation — walk the final CAR and verify all
	// segment CIDs (and manifest CID) exist as blocks
	const blockCidsInCar = new Set<string>();
	const iterator = await CarBlockIterator.fromBytes(finalCar.carBytes);
	for await (const block of iterator) {
		blockCidsInCar.add(block.cid.toString());
	}

	const missingCids: string[] = [];
	for (const [segId, cid] of segmentCids) {
		if (!blockCidsInCar.has(cid)) {
			missingCids.push(`segment ${segId}: ${cid}`);
		}
	}
	if (manifestCid && !blockCidsInCar.has(manifestCid)) {
		missingCids.push(`manifest: ${manifestCid}`);
	}
	if (missingCids.length > 0) {
		throw new WtfocError(
			`CAR validation failed — CIDs not found as blocks in directory CAR:\n  ${missingCids.join("\n  ")}`,
			"BUNDLE_CID_MISMATCH",
		);
	}

	// Only pass segment + manifest CIDs for IPNI validation, not all
	// internal UnixFS/directory blocks (which can be huge and aren't
	// user-relevant for retrieval)
	const childBlockCids: string[] = [...segmentCids.values()];
	if (manifestCid) childBlockCids.push(manifestCid);

	const finalCarRootCid = finalCar.rootCid.toString();

	// Step 7: Upload the final CAR once
	const metadata: Record<string, string> = {
		prebuiltCar: "true",
		carRootCid: finalCarRootCid,
		childBlockCids: JSON.stringify(childBlockCids),
	};
	if (copies != null) {
		metadata.copies = String(copies);
	}
	const result = await storage.upload(finalCar.carBytes, metadata, signal);

	// Step 8: Verify upload returned a PieceCID
	if (!result.pieceCid) {
		throw new WtfocError(
			"Bundle upload succeeded but no PieceCID returned — cannot verify on-chain storage",
			"BUNDLE_NO_PIECE_CID",
		);
	}

	return { batch, segmentCids, manifestCid, childBlockCids };
}
