// @wtfoc/common — Pure contracts, schemas, and types
// See SPEC.md Rule #2 for seam definitions

export {
	CollectionHeadConflictError,
	EmbedFailedError,
	ManifestConflictError,
	PublishFailedError,
	RevisionSchemaUnknownError,
	SchemaUnknownError,
	StorageInsufficientBalanceError,
	StorageNotFoundError,
	StorageUnreachableError,
	VectorDimensionMismatchError,
	WtfocError,
} from "./errors.js";
export type { EdgeExtractor } from "./interfaces/edge-extractor.js";
export type { Embedder } from "./interfaces/embedder.js";
export type { ManifestStore, StoredHead } from "./interfaces/manifest-store.js";
export type { SourceAdapter } from "./interfaces/source-adapter.js";
export type { StorageBackend, StorageResult } from "./interfaces/storage-backend.js";
export type { ScoredEntry, VectorEntry, VectorIndex } from "./interfaces/vector-index.js";
export type { Chunk } from "./schemas/chunk.js";
export type { Edge } from "./schemas/edge.js";
export type {
	ArtifactRole,
	ArtifactSummaryEntry,
	BatchRecord,
	CollectionDescriptor,
	CollectionHead,
	CollectionRevision,
	DatasetRoutingMetadata,
	HeadManifest,
	ProvenanceRecord,
	Segment,
	SegmentSummary,
} from "./schemas/manifest.js";
export { CURRENT_SCHEMA_VERSION, MAX_SUPPORTED_SCHEMA_VERSION } from "./version.js";
