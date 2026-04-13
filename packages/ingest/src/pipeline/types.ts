import type {
	BatchRecord,
	Chunk,
	DocumentCatalog,
	Embedder,
	ManifestStore,
	SourceAdapter,
	StorageBackend,
} from "@wtfoc/common";
import type { RawSourceIndex } from "../raw-source-archive.js";

// ── Log sink ──────────────────────────────────────────────────────────────────

/** Structured log event emitted by the pipeline instead of direct console writes. */
export interface LogEvent {
	level: "info" | "warn" | "error";
	phase: string;
	message: string;
	data?: Record<string, unknown>;
}

/** Callback for receiving pipeline log events. */
export type LogSink = (event: LogEvent) => void;

// ── Publish segment ───────────────────────────────────────────────────────────

/** Result from publishing a segment to storage. */
export interface PublishSegmentResult {
	resultId: string;
	batchRecord?: BatchRecord;
}

/** Injected function for uploading a segment to storage (FOC or local). */
export type PublishSegmentFn = (bytes: Uint8Array, segId: string) => Promise<PublishSegmentResult>;

// ── Document filters ──────────────────────────────────────────────────────────

/** CLI-driven document-level filters applied during streaming. */
export interface DocumentFilters {
	/** Restrict to specific document IDs (--document-ids). */
	documentIds: Set<string> | null;
	/** Restrict to files matching these path prefixes (--source-paths). */
	sourcePaths: string[] | null;
	/** Restrict to documents changed after this epoch ms (--changed-since). */
	changedSinceMs: number | null;
}

// ── Pipeline state ────────────────────────────────────────────────────────────

/** Mutable state container owned by orchestrate(), passed to each stage. */
export interface PipelineState {
	/** Content fingerprints for cross-version dedup. */
	knownFingerprints: Set<string>;
	/** Known chunk IDs for identity dedup. */
	knownChunkIds: Set<string>;
	/** Raw source archive index. */
	archiveIndex: RawSourceIndex;
	/** Document catalog for lifecycle management. */
	catalog: DocumentCatalog;
	/** Chunks pending catalog update, keyed by documentId. */
	catalogPendingChunks: Map<string, Chunk[]>;
	/** Current batch of chunks awaiting flush. */
	batch: Chunk[];
	/** Running batch number. */
	batchNumber: number;
	/** Stats counters. */
	stats: PipelineStats;
	/** Maximum timestamp seen from source data (for cursor persistence). */
	maxTimestamp: string;
}

/** Running counters accumulated during pipeline execution. */
export interface PipelineStats {
	chunksIngested: number;
	chunksSkipped: number;
	chunksFiltered: number;
	docsSuperseded: number;
	archivedCount: number;
	rechunkedCount: number;
	reusedFromDonors: number;
	donorCollectionNames: string[];
	batchesWritten: number;
}

// ── Ingest options ────────────────────────────────────────────────────────────

/** Configuration for a pipeline run — derived from CLI flags + config. */
export interface IngestOptions {
	collectionName: string;
	collectionId: string;
	sourceType: string;
	sourceKey: string;
	/** Parsed adapter config. */
	adapterConfig: Record<string, unknown>;
	/** Max chunks per batch. */
	maxBatch: number;
	/** Max characters per chunk before rechunking. */
	maxChunkChars: number;
	/** Whether filter flags are active (document-ids, source-paths, changed-since). */
	isPartialRun: boolean;
	/** Document-level filters. */
	filters: DocumentFilters;
	/** Embedding model name. */
	modelName: string;
	/** Whether source reuse is enabled. */
	sourceReuse: boolean;
	/** Repo source arg (e.g. "owner/repo") for repo adapters. */
	repoArg?: string;
	/** Append-only source types (e.g. "hn-story", "hn-comment"). */
	appendOnlyTypes: Set<string>;
	/** Edge extractor config (base URL, model, etc.). Null = disabled. */
	extractorConfig: ExtractorConfig | null;
	/** Tree-sitter service URL, if available. */
	treeSitterUrl: string | null;
	/** Manifest directory path for reading donor catalogs. */
	manifestDir?: string;
	/** Collection description for manifest. */
	description?: string;
	/** Git HEAD SHA for repo adapters (for cursor). */
	repoHeadSha?: string | null;
	/** Existing cursor value (for regression prevention). */
	existingCursorValue?: string | null;
	/** Pre-loaded document catalog (if available). */
	catalog?: DocumentCatalog;
	/** Pre-loaded archive index (if available). */
	archiveIndex?: RawSourceIndex;
	/** Renames from git-diff adapter metadata. */
	renames?: Array<{ oldPath: string; newPath: string }>;
}

/** LLM edge extractor configuration. */
export interface ExtractorConfig {
	baseUrl: string;
	model: string;
	apiKey?: string;
	jsonMode: "auto" | "on" | "off";
	timeoutMs: number;
	maxConcurrency: number;
	maxInputTokens: number;
}

// ── Ingest result ─────────────────────────────────────────────────────────────

/** Return value from orchestrate() — all counters and cursor info. */
export interface IngestResult {
	chunksIngested: number;
	chunksSkipped: number;
	chunksFiltered: number;
	docsSuperseded: number;
	archivedCount: number;
	rechunkedCount: number;
	reusedFromDonors: number;
	donorCollectionNames: string[];
	batchesWritten: number;
	/** True when adapter produced zero chunks and no embeddings were created. */
	empty: boolean;
	/** Cursor value to persist, or null if partial run / no data. */
	cursorValue: string | null;
	/** Reason for cursor decision. */
	cursorReason: string;
	/** Whether the catalog was modified (chunks or renames). */
	catalogModified: boolean;
	/** Updated catalog after pipeline (for CLI to persist). */
	catalog: DocumentCatalog;
	/** Updated archive index after pipeline (for CLI to persist). */
	archiveIndex: RawSourceIndex;
	/** Number of documents tracked in catalog. */
	catalogDocumentsUpdated: number;
}

// ── Orchestrate dependencies ──────────────────────────────────────────────────

/** All I/O dependencies injected into orchestrate() — no global state. */
export interface OrchestrateDeps {
	store: {
		storage: StorageBackend;
		manifests: ManifestStore;
	};
	embedder: Embedder;
	adapter: SourceAdapter;
	publishSegment: PublishSegmentFn;
	createEdgeExtractor: CreateEdgeExtractorFn;
	log: LogSink;
}

/** Factory for creating edge extractors per batch (may include tree-sitter, LLM, etc.). */
export type CreateEdgeExtractorFn = () => {
	extract: (chunks: Chunk[]) => Promise<
		Array<{
			type: string;
			sourceId: string;
			targetType: string;
			targetId: string;
			evidence: string;
			confidence: number;
		}>
	>;
};
