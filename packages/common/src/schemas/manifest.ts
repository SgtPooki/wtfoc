/**
 * Summary of a segment stored in the head manifest.
 * Enables targeted queries without downloading all segments.
 */
export interface SegmentSummary {
	/** Storage ID of the segment blob */
	id: string;
	/** IPFS CID (if available) */
	ipfsCid?: string;
	/** FOC PieceCID (if available) */
	pieceCid?: string;
	/** Source types contained in this segment */
	sourceTypes: string[];
	/** Time range of content in this segment */
	timeRange?: { from: string; to: string };
	/** Repo identifiers present */
	repoIds?: string[];
	/** Number of chunks in this segment */
	chunkCount: number;
}

/**
 * Record of a single CAR bundle upload to FOC.
 * Links one PieceCID to the segment IDs it contains.
 * Each FOC ingest upload produces one batch record.
 */
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

/**
 * Head manifest — the mutable pointer over immutable segments.
 * Small, updated on every ingest. Contains routing metadata
 * so queries can skip irrelevant segments.
 */
export interface HeadManifest {
	schemaVersion: number;
	name: string;
	prevHeadId: string | null;
	segments: SegmentSummary[];
	totalChunks: number;
	/** Embedding model used (e.g. "Xenova/all-MiniLM-L6-v2") */
	embeddingModel: string;
	/** Embedding dimensions (e.g. 384) */
	embeddingDimensions: number;
	createdAt: string;
	updatedAt: string;
	/**
	 * CAR bundle upload records. Each entry links one PieceCID to the
	 * segment IDs it contains. Optional — absent for local-only or
	 * pre-bundling manifests. No schemaVersion bump required.
	 */
	batches?: BatchRecord[];
}

/**
 * A segment blob — immutable, write-once batch of chunks with
 * embeddings and edges. Uploaded to storage once, referenced
 * by the head manifest.
 */
export interface Segment {
	schemaVersion: number;
	/** Embedding model used to produce vectors in this segment */
	embeddingModel: string;
	/** Embedding dimensions (must match vectors in chunks) */
	embeddingDimensions: number;
	chunks: Array<{
		id: string;
		storageId: string;
		/** The actual text content of this chunk (for display in results) */
		content: string;
		embedding: number[];
		terms: string[];
		source: string;
		sourceType: string;
		sourceUrl?: string;
		timestamp?: string;
		metadata: Record<string, string>;
	}>;
	edges: Array<{
		type: string;
		sourceId: string;
		targetType: string;
		targetId: string;
		evidence: string;
		confidence: number;
	}>;
}
