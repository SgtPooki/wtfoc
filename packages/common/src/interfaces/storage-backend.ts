/**
 * Result of storing an artifact. `id` is always present.
 * CIDs are optional — only populated when the backend supports them.
 */
export interface StorageResult {
	/** Backend-neutral artifact identifier (always present) */
	id: string;
	/** IPFS CID — present when backend supports IPFS (FOC, IPFS-only) */
	ipfsCid?: string;
	/** Filecoin PieceCID — present when backend supports FOC */
	pieceCid?: string;
	/** Verification proof — present when backend supports verification */
	proof?: string;
}

/**
 * Pluggable storage backend. FOC is the default; users can swap to
 * local filesystem, S3, GCS, IPFS-only, or any blob store.
 */
export interface StorageBackend {
	upload(data: Uint8Array, metadata?: Record<string, string>): Promise<StorageResult>;
	download(id: string): Promise<Uint8Array>;
	verify?(id: string): Promise<{ exists: boolean; size: number }>;
}
