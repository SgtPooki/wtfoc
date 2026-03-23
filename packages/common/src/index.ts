// @wtfoc/common — Pure contracts, schemas, and types
// See SPEC.md Rule #2 for seam definitions

export type { Embedder } from "./interfaces/embedder.js";
export type { VectorIndex, VectorEntry, ScoredEntry } from "./interfaces/vector-index.js";
export type { StorageBackend, StorageResult } from "./interfaces/storage-backend.js";
export type { SourceAdapter, SourceConfig } from "./interfaces/source-adapter.js";
export type { ManifestStore, StoredHead } from "./interfaces/manifest-store.js";
export type { EdgeExtractor } from "./interfaces/edge-extractor.js";

export type { Edge } from "./schemas/edge.js";
export type { Chunk } from "./schemas/chunk.js";
export type { HeadManifest, Segment, SegmentSummary } from "./schemas/manifest.js";

export { WtfocError, ManifestConflictError, StorageUnreachableError, StorageNotFoundError, StorageInsufficientBalanceError, EmbedFailedError, SchemaUnknownError } from "./errors.js";
