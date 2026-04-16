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
 * One logical artifact destined for a CAR bundle. `id` is the caller's
 * logical key (returned in the per-artifact CID map); `path` is the file
 * path inside the CAR (defaults to `segments/${id}.json` for back-compat);
 * `mediaType` defaults to `application/json`.
 */
export interface BundleArtifact {
	id: string;
	data: Uint8Array;
	/** File path inside the CAR — differentiates artifact kinds in the directory. */
	path?: string;
	/** Defaults to "application/json". */
	mediaType?: string;
}

/** @deprecated Use `BundleArtifact`. */
export type BundleSegment = BundleArtifact;

function defaultPathFor(artifact: BundleArtifact): string {
	return artifact.path ?? `segments/${artifact.id}.json`;
}

function defaultMediaTypeFor(artifact: BundleArtifact): string {
	return artifact.mediaType ?? "application/json";
}

/**
 * Compute bare (raw content) CIDs for a set of artifacts.
 * These CIDs match the actual blocks inside directory CARs.
 */
export async function computeArtifactCids(
	artifacts: BundleArtifact[],
	signal?: AbortSignal,
): Promise<Map<string, string>> {
	const fp = await import("filecoin-pin");
	const cids = new Map<string, string>();
	for (const artifact of artifacts) {
		signal?.throwIfAborted();
		const file = new File([Buffer.from(artifact.data)], defaultPathFor(artifact), {
			type: defaultMediaTypeFor(artifact),
		});
		const bareCar = await fp.createCarFromFile(file, { bare: true });
		cids.set(artifact.id, bareCar.rootCid.toString());
	}
	return cids;
}

/** @deprecated Use `computeArtifactCids`. Computes per-segment bare CIDs. */
export const computeSegmentCids = computeArtifactCids;

/** Options for bundleAndUpload */
export interface BundleOptions {
	/**
	 * Manifest builder: receives per-artifact CIDs and the pre-computed PieceCID
	 * of the artifacts-only CAR, returns a CollectionHead to include in the
	 * final CAR. This lets the manifest contain the full batch record with
	 * CIDs populated for every artifact kind.
	 */
	buildManifest?: (info: {
		artifactCids: Map<string, string>;
		/** @deprecated Alias for `artifactCids` — same Map, preserved for legacy callers. */
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
	/** Per-artifact CID map (artifact id → IPFS CID) */
	artifactCids: Map<string, string>;
	/** @deprecated Alias for `artifactCids`. */
	segmentCids: Map<string, string>;
	/** CID of the manifest within the CAR (if buildManifest was provided) */
	manifestCid?: string;
	/** Artifact + manifest CIDs that should be validated on IPNI */
	childBlockCids: string[];
}

/**
 * Bundle artifacts into a single CAR and upload once.
 *
 * Flow:
 * 1. Compute per-artifact bare CIDs (raw content, matches directory CAR blocks)
 * 2. Build artifacts-only CAR → stable bytes
 * 3. Compute PieceCID locally from artifacts-only CAR via @filoz/synapse-core
 * 4. If buildManifest provided: build manifest with full batch record (incl PieceCID),
 *    then build final CAR with artifacts + manifest
 * 5. Validate all artifact CIDs exist as blocks in the final CAR
 * 6. Upload once
 */
export async function bundleAndUpload(
	artifacts: BundleArtifact[],
	storage: StorageBackend,
	optionsOrSignal?: BundleOptions | AbortSignal,
): Promise<BundleUploadResult> {
	// Support legacy signature: bundleAndUpload(artifacts, storage, signal?)
	const options: BundleOptions =
		optionsOrSignal instanceof AbortSignal ? { signal: optionsOrSignal } : (optionsOrSignal ?? {});
	const { signal, buildManifest, copies } = options;

	if (artifacts.length === 0) {
		throw new WtfocError(
			"Cannot bundle zero artifacts — skip bundling for empty ingests",
			"BUNDLE_EMPTY",
		);
	}

	signal?.throwIfAborted();

	const fp = await import("filecoin-pin");
	const { CarBlockIterator } = await import("@ipld/car");
	const Piece = await import("@filoz/synapse-core/piece");

	// Step 1: Compute per-artifact CIDs using bare mode (raw content CIDs).
	// Bare mode produces the same CID as the raw content block inside the
	// directory CAR. Non-bare (wrapped) mode adds a directory wrapper node
	// whose CID does NOT appear in the directory CAR — that's the bug (#139).
	const artifactCids = await computeArtifactCids(artifacts, signal);

	signal?.throwIfAborted();

	// Step 2: Build artifacts-only CAR (stable bytes — content doesn't change)
	const artifactFiles: File[] = artifacts.map(
		(artifact) =>
			new File([Buffer.from(artifact.data)], defaultPathFor(artifact), {
				type: defaultMediaTypeFor(artifact),
			}),
	);

	let artifactsCar: { carBytes: Uint8Array; rootCid: { toString(): string } };
	try {
		artifactsCar = await fp.createCarFromFiles(artifactFiles);
	} catch (err) {
		throw new WtfocError(
			`CAR assembly failed: ${err instanceof Error ? err.message : String(err)}`,
			"BUNDLE_ASSEMBLY_FAILED",
			{ cause: err },
		);
	}

	signal?.throwIfAborted();

	// Step 3: Compute PieceCID locally from the artifacts-only CAR.
	// This is deterministic and doesn't require a network call.
	// The PieceCID is for the artifacts-only CAR, NOT the final CAR —
	// this is intentional and avoids the chicken-and-egg problem.
	const artifactsPieceCid = Piece.calculate(artifactsCar.carBytes).toString();
	const artifactsCarRootCid = artifactsCar.rootCid.toString();

	// Step 4: Build batch record with the pre-computed PieceCID.
	// BatchRecord.segmentIds is the legacy name but now holds CIDs for all
	// artifacts in the batch — segments, derived edge layers, raw-source blobs,
	// sidecars. Renaming is deferred to avoid churning existing persisted data.
	const batch: BatchRecord = {
		pieceCid: artifactsPieceCid,
		carRootCid: artifactsCarRootCid,
		segmentIds: artifacts.map((a) => {
			const cid = artifactCids.get(a.id);
			if (!cid) throw new WtfocError(`Missing CID for artifact ${a.id}`, "BUNDLE_INTERNAL");
			return cid;
		}),
		createdAt: new Date().toISOString(),
	};

	// Step 5: Build the final CAR — artifacts + manifest (if provided)
	let finalCar = artifactsCar;
	let manifestCid: string | undefined;

	if (buildManifest) {
		const manifest = buildManifest({
			artifactCids,
			segmentCids: artifactCids,
			pieceCid: artifactsPieceCid,
			carRootCid: artifactsCarRootCid,
		});

		const manifestJson = JSON.stringify(manifest);
		const manifestBytes = new TextEncoder().encode(manifestJson);
		const manifestFile = new File([Buffer.from(manifestBytes)], "manifest.json", {
			type: "application/json",
		});

		// Compute manifest CID (bare = raw content)
		const manifestCar = await fp.createCarFromFile(manifestFile, { bare: true });
		manifestCid = manifestCar.rootCid.toString();

		// Build final CAR with artifacts + manifest
		try {
			finalCar = await fp.createCarFromFiles([...artifactFiles, manifestFile]);
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
	// artifact CIDs (and manifest CID) exist as blocks
	const blockCidsInCar = new Set<string>();
	const iterator = await CarBlockIterator.fromBytes(finalCar.carBytes);
	for await (const block of iterator) {
		blockCidsInCar.add(block.cid.toString());
	}

	const missingCids: string[] = [];
	for (const [artifactId, cid] of artifactCids) {
		if (!blockCidsInCar.has(cid)) {
			missingCids.push(`artifact ${artifactId}: ${cid}`);
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

	// Only pass artifact + manifest CIDs for IPNI validation, not all
	// internal UnixFS/directory blocks (which can be huge and aren't
	// user-relevant for retrieval)
	const childBlockCids: string[] = [...artifactCids.values()];
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

	return {
		batch,
		artifactCids,
		segmentCids: artifactCids,
		manifestCid,
		childBlockCids,
	};
}
