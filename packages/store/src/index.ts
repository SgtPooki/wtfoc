// @wtfoc/store — Blob storage + manifest management
// See SPEC.md for storage architecture

export { LocalStorageBackend } from "./backends/local.js";
export type { Store, StoreConfig } from "./factory.js";
export { createStore } from "./factory.js";
export { LocalManifestStore } from "./manifest/local.js";
