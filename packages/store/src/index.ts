// @wtfoc/store — Blob storage + manifest management
// See SPEC.md for storage architecture

export { CidReadableStorage } from "./backends/cid-reader.js";
export { FocStorageBackend, type FocStorageBackendOptions } from "./backends/foc.js";
export { LocalStorageBackend } from "./backends/local.js";
export {
	type BundleArtifact,
	type BundleOptions,
	type BundleSegment,
	type BundleUploadResult,
	bundleAndUpload,
	computeArtifactCids,
	computeSegmentCids,
	type IpniValidationResult,
	validateIpniIndexing,
} from "./bundler.js";
export { type CidResolvedCollection, resolveCollectionByCid } from "./cid-resolver.js";
export {
	createCollectionDescriptor,
	createCollectionHead,
	createCollectionRevision,
	generateCollectionId,
	validateRoutingMetadata,
} from "./collection.js";
export { computeRevisionDiff, generateContentIdentity, type RevisionDiff } from "./diff.js";
// Eval evaluator
export { evaluateStorage, type StorageEvalOptions } from "./eval/storage-evaluator.js";
export type { Store, StoreConfig } from "./factory.js";
export { createStore } from "./factory.js";
export { LocalManifestStore, validateCollectionName } from "./manifest/local.js";
export { getLocalManifestDir } from "./manifest-dir.js";
export { deserializeRevision, serializeRevision } from "./revision.js";
export {
	MAX_SUPPORTED_SCHEMA_VERSION,
	validateManifestSchema,
	validateSegmentSchema,
} from "./schema.js";
export { deserializeSegment, serializeSegment } from "./segment.js";
