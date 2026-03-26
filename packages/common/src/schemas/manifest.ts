/**
 * Summary of a segment stored in the collection head.
 * Enables targeted queries without downloading all segments.
 */
export interface SegmentSummary {
	id: string;
	ipfsCid?: string;
	pieceCid?: string;
	sourceTypes: string[];
	timeRange?: { from: string; to: string };
	repoIds?: string[];
	chunkCount: number;
}

/**
 * Record of a single CAR bundle upload to FOC.
 * Links one PieceCID to the segment IDs it contains.
 */
export interface BatchRecord {
	pieceCid: string;
	carRootCid: string;
	segmentIds: string[];
	createdAt: string;
}

/** Artifact role classification for collection publication */
export type ArtifactRole = "source" | "segment" | "revision" | "descriptor";

/** Compact artifact index entry stored inside a CollectionRevision */
export interface ArtifactSummaryEntry {
	artifactId: string;
	artifactRole: ArtifactRole;
	sourceScope: string;
	/** IPFS CID for FOC-backed artifacts, SHA-256 hex for local */
	contentIdentity: string;
	storageId: string;
	ipfsCid?: string;
	pieceCid?: string;
}

/** Minimal metadata stored on FOC datasets — routing only */
export interface DatasetRoutingMetadata {
	collectionId: string;
	artifactKind: string;
	sourceNamespace: string;
	indexingFlags: Record<string, boolean>;
}

/** PROV-inspired provenance record for collection publication */
export interface ProvenanceRecord {
	artifactId: string;
	artifactKind: string;
	derivedFrom: string[];
	primarySource?: string;
	activityId: string;
	activityType: string;
	actorId: string;
	actorType: string;
	revisionOf?: string;
	derivationChain: string[];
}

/**
 * Stable identity record for a collection.
 * Created once, referenced by all heads and revisions.
 */
export interface CollectionDescriptor {
	schemaVersion: number;
	collectionId: string;
	name: string;
	storageNamespace: string;
	datasetId?: string;
	createdAt: string;
	createdBy: string;
	routingMetadata: DatasetRoutingMetadata;
}

/** A noise category from LLM summarization of unclustered chunks. */
export interface NoiseCategory {
	name: string;
	count: number;
	description: string;
}

/** Persisted theme clustering results. Travels with the manifest CID. */
export interface ThemeSnapshot {
	/** Cosine similarity threshold used */
	threshold: number;
	/** Cluster data (id, label, exemplarIds, memberIds, size) */
	clusters: Array<{
		id: string;
		label: string;
		exemplarIds: string[];
		memberIds: string[];
		size: number;
	}>;
	/** Chunk IDs that didn't fit any cluster */
	noise: string[];
	/** LLM-generated noise breakdown (empty if no LLM was used) */
	noiseCategories: NoiseCategory[];
	/** Total chunks processed (after filtering) */
	totalProcessed: number;
	/** How many config/boilerplate chunks were filtered out */
	filteredConfigChunks: number;
	/** Whether LLM was used for labeling */
	llmLabeled: boolean;
	/** LLM model used for labeling (undefined if heuristic-only) */
	llmModel?: string;
	/** LLM endpoint base URL used (undefined if heuristic-only) */
	llmBaseUrl?: string;
	/** When this snapshot was computed */
	computedAt: string;
}

/**
 * Collection Head — the single mutable pointer for a collection.
 * Evolved from HeadManifest. Carries both ingest summary data
 * and a pointer to the current immutable CollectionRevision.
 *
 * Schema v1 redefined in place — no external consumers to break.
 */
export interface CollectionHead {
	schemaVersion: number;
	collectionId: string;
	name: string;
	currentRevisionId: string | null;
	prevHeadId: string | null;
	segments: SegmentSummary[];
	totalChunks: number;
	embeddingModel: string;
	embeddingDimensions: number;
	createdAt: string;
	updatedAt: string;
	batches?: BatchRecord[];
	/** Persisted theme clustering results */
	themes?: ThemeSnapshot;
}

/**
 * @deprecated Use CollectionHead instead. Alias kept for migration.
 */
export type HeadManifest = CollectionHead;

/**
 * Immutable record of one published state of a collection.
 * Each revision references the segments and bundles it covers
 * and carries compact artifact summaries for diff workflows.
 */
export interface CollectionRevision {
	schemaVersion: number;
	revisionId: string;
	collectionId: string;
	prevRevisionId: string | null;
	artifactSummaries: ArtifactSummaryEntry[];
	/** SegmentSummary.id values from the merged spec 010 schema */
	segmentRefs: string[];
	/** BatchRecord.carRootCid values when batch records exist */
	bundleRefs: string[];
	provenance: ProvenanceRecord[];
	createdAt: string;
	publishedBy: string;
}

/**
 * A segment blob — immutable, write-once batch of chunks with
 * embeddings and edges. Uploaded to storage once, referenced
 * by the collection head.
 */
export interface Segment {
	schemaVersion: number;
	embeddingModel: string;
	embeddingDimensions: number;
	chunks: Array<{
		id: string;
		storageId: string;
		content: string;
		embedding: number[];
		terms: string[];
		source: string;
		sourceType: string;
		sourceUrl?: string;
		timestamp?: string;
		metadata: Record<string, string>;
		signalScores?: Record<string, number>;
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
