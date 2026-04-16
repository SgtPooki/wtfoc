import { createHash } from "node:crypto";
import type { CollectionHead, PublishedArtifactRef, PublishedSidecarRole } from "@wtfoc/common";
import { catalogFilePath, readCatalog } from "./document-catalog.js";
import { archiveIndexPath, readArchiveIndex } from "./raw-source-archive.js";

/**
 * One artifact pulled together for promotion. `getBytes()` is lazy so the
 * caller can stream through the generator without holding every artifact's
 * bytes in memory simultaneously. `id` is the caller's logical key used to
 * correlate back to the resulting CID after upload; for blobs it is the
 * local `storageId`, for sidecars it is a synthetic key of the form
 * `sidecar:<role>`.
 */
export interface PromotableArtifact {
	id: string;
	kind: PublishedArtifactRef["kind"];
	/** Sidecar-only: role within the collection. Undefined for blobs. */
	sidecarRole?: PublishedSidecarRole;
	/** Optional metadata that the published ref will carry back onto the manifest. */
	metadata: PromotableArtifactMetadata;
	/** Lazily fetch the artifact bytes (download from local storage or read sidecar file). */
	getBytes(): Promise<Uint8Array>;
	/** Caller-chosen path inside the published CAR. */
	carPath: string;
}

export type PromotableArtifactMetadata =
	| { kind: "segment" }
	| { kind: "derived-edge-layer"; extractorId: string; edgeCount: number }
	| { kind: "raw-source-blob"; documentId: string; documentVersionId: string; sha256: string }
	| { kind: "sidecar"; role: PublishedSidecarRole };

/**
 * Enumerate every artifact that must travel with a collection for full-fidelity
 * pull. This is the canonical publication index — both CLI promote and the
 * web-app promote worker iterate this generator.
 *
 * Coverage:
 * - segments (head.segments[])
 * - derived edge layer blobs (head.derivedEdgeLayers[])
 * - raw-source-index sidecar + every raw-source blob it references (if present)
 * - document-catalog sidecar (if present)
 *
 * Explicitly excluded:
 * - `<name>.ingest-cursors.json` — local resume state, not content
 * - `<name>.edge-overlays/` staging dir — pre-materialize intermediate; promote
 *   already refuses to proceed if unmaterialized overlays exist
 */
export async function* enumeratePromotableArtifacts(
	head: CollectionHead,
	collectionName: string,
	manifestDir: string,
	downloadBlob: (storageId: string) => Promise<Uint8Array>,
): AsyncIterable<PromotableArtifact> {
	// 1. Segments
	for (const seg of head.segments) {
		yield {
			id: seg.id,
			kind: "segment",
			metadata: { kind: "segment" },
			carPath: `segments/${seg.id}.json`,
			getBytes: () => downloadBlob(seg.id),
		};
	}

	// 2. Derived edge layers
	for (const layer of head.derivedEdgeLayers ?? []) {
		yield {
			id: layer.id,
			kind: "derived-edge-layer",
			metadata: {
				kind: "derived-edge-layer",
				extractorId: layer.extractorId,
				edgeCount: layer.edgeCount,
			},
			carPath: `derived-edges/${layer.id}.json`,
			getBytes: () => downloadBlob(layer.id),
		};
	}

	// 3. Raw-source sidecar + referenced blobs
	const rawIndex = await readArchiveIndex(archiveIndexPath(manifestDir, collectionName));
	if (rawIndex) {
		const indexBytes = new TextEncoder().encode(JSON.stringify(rawIndex));
		yield {
			id: sidecarId("raw-source-index"),
			kind: "sidecar",
			sidecarRole: "raw-source-index",
			metadata: { kind: "sidecar", role: "raw-source-index" },
			carPath: `sidecars/${collectionName}.raw-source-index.json`,
			getBytes: async () => indexBytes,
		};

		for (const entry of Object.values(rawIndex.entries)) {
			yield {
				id: entry.storageId,
				kind: "raw-source-blob",
				metadata: {
					kind: "raw-source-blob",
					documentId: entry.documentId,
					documentVersionId: entry.documentVersionId,
					sha256: entry.checksum,
				},
				carPath: `raw-sources/${entry.storageId}`,
				getBytes: () => downloadBlob(entry.storageId),
			};
		}
	}

	// 4. Document-catalog sidecar
	const catalog = await readCatalog(catalogFilePath(manifestDir, collectionName));
	if (catalog) {
		const catalogBytes = new TextEncoder().encode(JSON.stringify(catalog));
		yield {
			id: sidecarId("document-catalog"),
			kind: "sidecar",
			sidecarRole: "document-catalog",
			metadata: { kind: "sidecar", role: "document-catalog" },
			carPath: `sidecars/${collectionName}.document-catalog.json`,
			getBytes: async () => catalogBytes,
		};
	}
}

/**
 * Test/introspection helper — drain the generator into an array. Useful for
 * assertions (`collectedArtifacts.filter(a => a.kind === 'segment')`) but not
 * for production: the point of the generator is streaming.
 */
export async function collectPromotableArtifacts(
	head: CollectionHead,
	collectionName: string,
	manifestDir: string,
	downloadBlob: (storageId: string) => Promise<Uint8Array>,
): Promise<PromotableArtifact[]> {
	const artifacts: PromotableArtifact[] = [];
	for await (const artifact of enumeratePromotableArtifacts(
		head,
		collectionName,
		manifestDir,
		downloadBlob,
	)) {
		artifacts.push(artifact);
	}
	return artifacts;
}

/**
 * Synthetic id for sidecar artifacts — sidecars have no local `storageId`.
 * The prefix is intentional so sidecar ids can't collide with blob ids.
 */
export function sidecarId(role: PublishedSidecarRole): string {
	return `sidecar:${role}`;
}

/** Compute the SHA-256 of a raw byte buffer as hex. (The `sha256Hex` exported
 * from `chunker.js` takes a `string` and is UTF-8 based — distinct use case.) */
export function sha256HexBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build a `CollectionHead` with artifactRefs[], per-segment ipfsCid,
 * per-derived-edge-layer ipfsCid, and a new batch record attached. Used by
 * both the CLI promote command and the web-app promote worker so the two
 * publishing paths produce byte-identical manifests for the same inputs.
 */
export function buildEnrichedCollectionHead(args: {
	head: CollectionHead;
	enumerated: Array<{ artifact: PromotableArtifact; bytes: Uint8Array }>;
	artifactCids: Map<string, string>;
	newBatch: NonNullable<CollectionHead["batches"]>[number];
	existingBatches: NonNullable<CollectionHead["batches"]>;
}): CollectionHead {
	const { head, enumerated, artifactCids, newBatch, existingBatches } = args;

	const artifactRefs: PublishedArtifactRef[] = enumerated.map(({ artifact, bytes }) => {
		const ipfsCid = artifactCids.get(artifact.id);
		if (!ipfsCid) {
			throw new Error(
				`BUG: bundleAndUpload did not return a CID for artifact ${artifact.id} (kind=${artifact.kind})`,
			);
		}
		return toPublishedArtifactRef(artifact, ipfsCid, bytes.length, sha256HexBytes(bytes));
	});

	return {
		...head,
		segments: head.segments.map((seg) => {
			const cid = artifactCids.get(seg.id);
			return cid ? { ...seg, ipfsCid: cid } : seg;
		}),
		derivedEdgeLayers: head.derivedEdgeLayers?.map((layer) => {
			const cid = artifactCids.get(layer.id);
			return cid ? { ...layer, ipfsCid: cid } : layer;
		}),
		artifactRefs,
		batches: [...existingBatches, newBatch],
		updatedAt: newBatch.createdAt,
	};
}

/**
 * Convert an in-flight `PromotableArtifact` (with resolved bytes + CID) into
 * its `PublishedArtifactRef` form for writing onto the manifest. This is the
 * single discriminated-switch that promote uses to build the publication index —
 * adding a new `PromotableArtifactMetadata` variant breaks compile here until
 * the handler is extended.
 */
export function toPublishedArtifactRef(
	artifact: PromotableArtifact,
	ipfsCid: string,
	byteLength: number,
	sha256: string,
): PublishedArtifactRef {
	switch (artifact.metadata.kind) {
		case "segment":
			return {
				kind: "segment",
				storageId: artifact.id,
				ipfsCid,
				byteLength,
			};
		case "derived-edge-layer":
			return {
				kind: "derived-edge-layer",
				storageId: artifact.id,
				ipfsCid,
				extractorId: artifact.metadata.extractorId,
				edgeCount: artifact.metadata.edgeCount,
				byteLength,
			};
		case "raw-source-blob":
			return {
				kind: "raw-source-blob",
				storageId: artifact.id,
				ipfsCid,
				documentId: artifact.metadata.documentId,
				documentVersionId: artifact.metadata.documentVersionId,
				byteLength,
				sha256: artifact.metadata.sha256,
			};
		case "sidecar":
			return {
				kind: "sidecar",
				role: artifact.metadata.role,
				ipfsCid,
				byteLength,
				sha256,
			};
		default: {
			const exhaustive: never = artifact.metadata;
			throw new Error(`Unhandled PromotableArtifact metadata kind: ${JSON.stringify(exhaustive)}`);
		}
	}
}
