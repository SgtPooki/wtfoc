// @wtfoc/common — Pure contracts, schemas, and types
// See SPEC.md Rule #2 for seam definitions

export type {
	EmbedderConfig,
	EmbedderProfile,
	ExtractorConfig,
	PoolingStrategy,
	PrefixFormatter,
	ProjectConfig,
	ResolvedConfig,
	ResolvedEmbedderConfig,
	ResolvedExtractorConfig,
} from "./config-types.js";
export {
	BUILTIN_IGNORE_PATTERNS,
	URL_SHORTCUTS,
	VALID_POOLING_STRATEGIES,
} from "./config-types.js";
export {
	CollectionHeadConflictError,
	ConfigParseError,
	ConfigValidationError,
	EmbedFailedError,
	GitHubApiError,
	GitHubCliMissingError,
	GitHubNotFoundError,
	GitHubRateLimitError,
	ManifestConflictError,
	PublishFailedError,
	RateLimitError,
	RevisionSchemaUnknownError,
	SchemaUnknownError,
	SessionExpiredError,
	SessionKeyRevokedError,
	StorageInsufficientBalanceError,
	StorageNotFoundError,
	StorageUnreachableError,
	VectorDimensionMismatchError,
	WalletVerificationError,
	WtfocError,
} from "./errors.js";
export type { ChunkScorer } from "./interfaces/chunk-scorer.js";
export type {
	Clusterer,
	ClusterOptions,
	ClusterRequest,
	ClusterResult,
	ThemeCluster,
} from "./interfaces/clusterer.js";
export type { EdgeExtractor } from "./interfaces/edge-extractor.js";
export type { Embedder } from "./interfaces/embedder.js";
export type { ManifestStore, StoredHead } from "./interfaces/manifest-store.js";
export type { SourceAdapter } from "./interfaces/source-adapter.js";
export type { StorageBackend, StorageResult } from "./interfaces/storage-backend.js";
export type {
	ScoredEntry,
	SerializableVectorIndex,
	VectorEntry,
	VectorIndex,
} from "./interfaces/vector-index.js";
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
	NoiseCategory,
	ProvenanceRecord,
	Segment,
	SegmentSummary,
	ThemeSnapshot,
} from "./schemas/manifest.js";
export { CURRENT_SCHEMA_VERSION, MAX_SUPPORTED_SCHEMA_VERSION } from "./version.js";
