import type {
	CollectionHead,
	PublishedArtifactRef,
	PublishedSidecarRole,
	StorageBackend,
} from "@wtfoc/common";
import { WtfocError } from "@wtfoc/common";
import { CID } from "multiformats/cid";
import { CidReadableStorage } from "./backends/cid-reader.js";
import { validateManifestSchema } from "./schema.js";

export interface CidResolvedCollection {
	manifest: CollectionHead;
	/** Maps any local `storageId` (segment/derived-edge-layer/raw-source-blob) to its published IPFS CID for download. Falls through to treating the id as a CID directly when no mapping is known. */
	storage: StorageBackend;
	/** Look up the published CID for a sidecar role, if the manifest carries one. */
	sidecarCid(role: PublishedSidecarRole): string | undefined;
}

/**
 * Resolve a collection by its manifest CID.
 *
 * 1. Validates the CID format
 * 2. Fetches the manifest JSON via verified-fetch
 * 3. Validates the manifest schema
 * 4. Returns a storage backend that maps segment IDs → IPFS CIDs for download
 */
export interface ResolveCollectionOptions {
	/**
	 * Hard per-download timeout in ms forwarded to the internal
	 * {@link CidReadableStorage}. See its constructor docs. Default 120_000.
	 */
	downloadTimeoutMs?: number;
}

export async function resolveCollectionByCid(
	cidString: string,
	signal?: AbortSignal,
	options: ResolveCollectionOptions = {},
): Promise<CidResolvedCollection> {
	// Validate CID format
	let parsedCid: CID;
	try {
		parsedCid = CID.parse(cidString);
	} catch {
		throw new WtfocError(`Invalid CID: "${cidString}"`, "CID_INVALID", { cid: cidString });
	}

	const reader = new CidReadableStorage({
		...(options.downloadTimeoutMs !== undefined
			? { downloadTimeoutMs: options.downloadTimeoutMs }
			: {}),
	});
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

	// Build a storage-id → published-CID lookup covering every artifact kind.
	// Priority order:
	//   1. `artifactRefs[]` entries (canonical publication index — present on
	//      collections promoted with self-containment support)
	//   2. Individual `ipfsCid` fields on segments + derived-edge-layer summaries
	//      (back-compat for older promoted collections)
	// When both are absent the caller-supplied id is passed straight through to
	// the IPFS reader, which matches today's behavior for pre-artifactRefs
	// collections where segment ids happen to already be CIDs.
	const cidByStorageId = new Map<string, string>();
	const cidBySidecarRole = new Map<PublishedSidecarRole, string>();

	const artifactRefs: PublishedArtifactRef[] = manifest.artifactRefs ?? [];
	for (const ref of artifactRefs) {
		switch (ref.kind) {
			case "segment":
			case "derived-edge-layer":
			case "raw-source-blob":
				cidByStorageId.set(ref.storageId, ref.ipfsCid);
				break;
			case "sidecar":
				cidBySidecarRole.set(ref.role, ref.ipfsCid);
				break;
			default: {
				const exhaustive: never = ref;
				throw new WtfocError(
					`Unhandled PublishedArtifactRef kind: ${JSON.stringify(exhaustive)}`,
					"CID_RESOLVER_INTERNAL",
				);
			}
		}
	}

	// Back-compat: fill any gaps from individual summary entries.
	for (const seg of manifest.segments) {
		if (seg.ipfsCid && !cidByStorageId.has(seg.id)) {
			cidByStorageId.set(seg.id, seg.ipfsCid);
		}
	}
	for (const layer of manifest.derivedEdgeLayers ?? []) {
		if (layer.ipfsCid && !cidByStorageId.has(layer.id)) {
			cidByStorageId.set(layer.id, layer.ipfsCid);
		}
	}

	const storage: StorageBackend = {
		async download(id: string, sig?: AbortSignal): Promise<Uint8Array> {
			const resolvedCid = cidByStorageId.get(id) ?? id;
			return reader.download(resolvedCid, sig);
		},
		async upload(): Promise<never> {
			throw new WtfocError("CID-resolved storage is read-only", "CID_READ_ONLY");
		},
	};

	return {
		manifest,
		storage,
		sidecarCid: (role) => cidBySidecarRole.get(role),
	};
}
