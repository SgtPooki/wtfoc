import type { CollectionHead, StorageBackend } from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { CID } from "multiformats/cid";
import { CidReadableStorage } from "./backends/cid-reader.js";
import { validateManifestSchema } from "./schema.js";

export interface CidResolvedCollection {
	manifest: CollectionHead;
	/** A storage backend that resolves segment IDs to their IPFS CIDs for download. */
	storage: StorageBackend;
}

/**
 * Resolve a collection by its manifest CID.
 *
 * 1. Validates the CID format
 * 2. Fetches the manifest JSON via verified-fetch
 * 3. Validates the manifest schema
 * 4. Returns a storage backend that maps segment IDs → IPFS CIDs for download
 */
export async function resolveCollectionByCid(
	cidString: string,
	signal?: AbortSignal,
): Promise<CidResolvedCollection> {
	// Validate CID format
	let parsedCid: CID;
	try {
		parsedCid = CID.parse(cidString);
	} catch {
		throw new WtfocError(`Invalid CID: "${cidString}"`, "CID_INVALID", { cid: cidString });
	}

	const reader = new CidReadableStorage();
	const cidStr = parsedCid.toString();

	// Fetch manifest
	let manifestBytes: Uint8Array;
	try {
		manifestBytes = await reader.download(cidStr, signal);
	} catch (err) {
		if (err instanceof WtfocError && err.code === "CID_INVALID") throw err;
		throw new WtfocError(
			`Failed to fetch manifest from CID ${cidStr}: ${err instanceof Error ? err.message : String(err)}`,
			"CID_FETCH_FAILED",
			{ cid: cidStr, cause: err },
		);
	}

	// Parse and validate
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
	} catch {
		throw new WtfocError(
			`CID ${cidStr} does not contain valid JSON — not a wtfoc manifest`,
			"CID_NOT_MANIFEST",
			{ cid: cidStr },
		);
	}

	let manifest: CollectionHead;
	try {
		manifest = validateManifestSchema(parsed);
	} catch (err) {
		throw new WtfocError(
			`CID ${cidStr} contains JSON but not a valid CollectionHead`,
			"CID_NOT_MANIFEST",
			{ cid: cidStr, cause: err },
		);
	}

	// Build a storage backend that maps segment IDs → IPFS CIDs
	// mountCollection() calls storage.download(segmentSummary.id), but IPFS
	// needs the segment's ipfsCid. This wrapper does the translation.
	const cidBySegmentId = new Map<string, string>();
	for (const seg of manifest.segments) {
		if (seg.ipfsCid) {
			cidBySegmentId.set(seg.id, seg.ipfsCid);
		}
	}

	const storage: StorageBackend = {
		async download(id: string, sig?: AbortSignal): Promise<Uint8Array> {
			const resolvedCid = cidBySegmentId.get(id) ?? id;
			return reader.download(resolvedCid, sig);
		},
		async upload(): Promise<never> {
			throw new WtfocError("CID-resolved storage is read-only", "CID_READ_ONLY");
		},
	};

	return { manifest, storage };
}
