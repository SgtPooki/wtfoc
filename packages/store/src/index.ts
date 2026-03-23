// @wtfoc/store — Blob storage + manifest management
// See SPEC.md for storage architecture

export { FocStorageBackend, type FocStorageBackendOptions } from "./backends/foc.js";
export { LocalStorageBackend } from "./backends/local.js";
export { type BundleSegment, type BundleUploadResult, bundleAndUpload } from "./bundler.js";
export { type RevisionDiff, computeRevisionDiff, generateContentIdentity } from "./diff.js";
export {
	createCollectionDescriptor,
	createCollectionHead,
	createCollectionRevision,
	generateCollectionId,
	validateRoutingMetadata,
} from "./collection.js";
export type { Store, StoreConfig } from "./factory.js";
export { createStore } from "./factory.js";
export { LocalManifestStore } from "./manifest/local.js";
export {
	MAX_SUPPORTED_SCHEMA_VERSION,
	validateManifestSchema,
	validateSegmentSchema,
} from "./schema.js";
export { deserializeRevision, serializeRevision } from "./revision.js";
export { deserializeSegment, serializeSegment } from "./segment.js";
