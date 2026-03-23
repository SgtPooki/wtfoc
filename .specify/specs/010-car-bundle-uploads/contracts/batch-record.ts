/**
 * Contract: BatchRecord — links one FOC upload (CAR bundle) to the segments it contains.
 *
 * Added as an optional `batches` field on HeadManifest.
 * No schema version bump required (optional field, ignored by older readers).
 */

/** A single CAR bundle upload record */
export interface BatchRecord {
	/** FOC PieceCID for the entire CAR bundle */
	pieceCid: string;
	/** IPFS root CID of the directory CAR */
	carRootCid: string;
	/** Segment IDs contained in this CAR (references segments[].id) */
	segmentIds: string[];
	/** ISO 8601 timestamp of the upload */
	createdAt: string;
}

/** Result of the bundle-and-upload orchestration */
export interface BundleUploadResult {
	/** The batch record to add to the manifest */
	batch: BatchRecord;
	/** Per-segment upload results (segment CID → StorageResult-like info) */
	segmentCids: Map<string, string>;
}

/**
 * Orchestration function signature.
 *
 * Takes serialized segments, bundles them into a CAR, uploads via the
 * storage backend, and returns the batch record + per-segment CIDs.
 *
 * - Computes per-segment CIDs deterministically before upload
 * - Builds a directory CAR with stable paths: segments/{segmentId}.json
 * - Calls storage.upload() once with the pre-built CAR bytes
 * - Verifies the upload result includes a valid PieceCID
 * - Returns the batch record ready to append to manifest.batches
 */
export interface BundleAndUpload {
	(
		segments: Array<{ id: string; data: Uint8Array }>,
		storage: { upload: (data: Uint8Array, metadata?: Record<string, string>) => Promise<{ id: string; pieceCid?: string; ipfsCid?: string }> },
		signal?: AbortSignal,
	): Promise<BundleUploadResult>;
}
