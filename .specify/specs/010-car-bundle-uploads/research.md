# Research: CAR Bundle Uploads

## R1: How to create a directory CAR with filecoin-pin

**Decision**: Use `filecoin-pin.createCarFromFiles(files: File[], options?)` to build a directory CAR from multiple segment files.

**Rationale**: `createCarFromFiles` is the browser-compatible API that takes multiple `File` objects and creates a directory CAR. It returns `{ carBytes: Uint8Array, rootCid: CID }`. The current codebase already uses `createCarFromFile` (singular) with `bare: true`, but `bare` is not supported for multiple files or directories (throws error). `createCarFromFiles` naturally produces a UnixFS directory wrapping multiple files.

**Alternatives considered**:
- `createCarFromPath(dirPath)` — Node.js only, requires writing files to a temp directory first. Viable but unnecessary indirection since we have segment bytes in memory.
- `createCarFromFileList` — preserves `webkitRelativePath`, designed for browser directory uploads. Not relevant for CLI.
- Manual CAR building — would bypass filecoin-pin, violating SDK policy.

**Key details**:
- `createCarFromFiles` does NOT support `bare: true` (throws for multiple files)
- Returns `carBytes: Uint8Array` and `rootCid: CID`
- Each `File` gets a path within the UnixFS directory based on its `name` property
- Per-file CIDs are NOT directly returned by the API — they must be computed separately or extracted from the CAR

## R2: Computing per-segment CIDs before upload

**Decision**: Compute per-segment CIDs by creating individual bare CARs with `createCarFromFile(file, { bare: true })` to get each segment's CID, then create the bundled directory CAR with `createCarFromFiles` for the actual upload.

**Rationale**: `createCarFromFiles` only returns the root CID of the directory, not per-file CIDs. To get stable per-segment CIDs we need to compute them independently. Since `createCarFromFile` with `bare: true` already computes the CID for a single file (this is what the current FOC backend does), we can reuse that to get per-segment CIDs. The extra computation is negligible compared to embedding and upload time.

**Alternatives considered**:
- Parse the CAR file to extract internal CIDs — complex, brittle, depends on CAR internals
- Use a separate CID computation library — adds a dependency when filecoin-pin already does it
- Skip per-segment CIDs entirely — breaks FR-003 and retrieval

## R3: FocStorageBackend changes vs new bundler module

**Decision**: Create a new `bundler.ts` module in `@wtfoc/store` that orchestrates bundling. `FocStorageBackend.upload()` continues to accept raw bytes (the bundled CAR bytes). The bundler calls `createCarFromFiles`, computes per-segment CIDs, and calls `storage.upload(carBytes)`.

**Rationale**: FR-009 requires no `StorageBackend` interface change. The bundler is the "orchestration layer above the storage backend" described in the spec. It sits between the CLI and the storage backend.

**Alternatives considered**:
- Modify `FocStorageBackend.upload()` to accept multiple files internally — violates FR-009 and FR-010
- Put bundling logic directly in CLI — would duplicate logic if other entry points need bundling

## R4: Schema versioning for the `batches` field

**Decision**: Add `batches?: BatchRecord[]` as an optional field on `HeadManifest`. No schema version bump. Existing readers ignore unknown optional fields.

**Rationale**: The manifest validation in `schema.ts` already uses a permissive pattern — it validates known fields and ignores extras. An optional `batches` field will be ignored by older readers (they just won't see batch information). The `schemaVersion` stays at 1.

**Alternatives considered**:
- Required field with version bump to 2 — breaks all existing manifests, requires migration
- Separate batch index file — adds complexity without benefit; manifest is already the mutable index

## R5: Upload flow with createCarFromFiles returning carBytes vs carPath

**Decision**: Use the browser-compatible `createCarFromFiles` which returns `carBytes: Uint8Array`. Pass these bytes to `FocStorageBackend.upload()`. The existing upload flow in `foc.ts` will need adjustment since it currently creates a CAR from a single File — the bundler will supply pre-built CAR bytes directly.

**Rationale**: The current `FocStorageBackend.upload()` receives `Uint8Array` and creates a CAR internally. With bundling, the CAR is pre-built by the bundler. Two options: (a) pass pre-built CAR bytes and skip internal CAR creation, or (b) have the bundler write to a temp dir and use `createCarFromPath`. Option (a) is simpler but requires `foc.ts` to detect "these bytes are already a CAR" vs "these are raw segment bytes."

**Resolution**: Add a `metadata` flag (e.g., `{ prebuiltCar: "true" }`) in the `upload()` call to signal that the data is already a CAR. The `FocStorageBackend` checks this flag and skips internal CAR creation, uploading the bytes directly. This uses the existing `metadata` parameter without changing the interface.
