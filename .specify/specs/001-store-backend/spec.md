# Feature Specification: Store Backend

**Feature Branch**: `001-store-backend`
**Created**: 2026-03-23
**Status**: Revised (addressing Cursor + Codex cross-review)
**Spec**: [`SPEC.md` rules 2-5, 7-8](../../SPEC.md)
**Package**: `@wtfoc/store`

## Overview

Implement the `@wtfoc/store` package — the foundational storage layer that all other packages depend on. Provides pluggable blob storage and manifest management with backend-neutral artifact identity.

Two built-in storage backends:
1. **LocalStorageBackend** — filesystem, no wallet, no network
2. **FocStorageBackend** — FOC via `@filoz/synapse-sdk` + `filecoin-pin`, dual CIDs

One built-in manifest store:
1. **LocalManifestStore** — JSON files on local filesystem

FOC-backed ManifestStore is **out of scope** for this spec (deferred to a future spec when FOC manifest persistence is needed).

## Definitions

- **`StorageResult.id`** — a durable, backend-assigned identifier sufficient for retrieval after process restart. For local backend: content SHA-256 hash. For FOC backend: PieceCID string.
- **`StoredHead.headId`** — a store-assigned identifier for a head manifest revision. Used for conflict detection. For local: content hash of the serialized manifest JSON.
- **`schemaVersion`** — format version of persisted data (manifests, segments). Currently `1`. Not a chain revision counter.

## User Scenarios & Testing

### User Story 1 — Store and retrieve a blob locally (Priority: P1)

A developer stores arbitrary bytes and retrieves them by ID without any network setup.

**Why this priority**: Everything else depends on working put/get.

**Acceptance Scenarios**:

1. **Given** a LocalStorageBackend with a temp directory, **When** I upload a `Uint8Array`, **Then** I receive a `StorageResult` with a non-empty `id` and no `ipfsCid`/`pieceCid`.
2. **Given** a stored blob, **When** I download by `id`, **Then** I get the exact same bytes.
3. **Given** a stored blob, **When** I call `verify(id)`, **Then** it returns `{ exists: true, size: N }`.
4. **Given** an ID that was never stored, **When** I download, **Then** it throws `StorageNotFoundError` with code `STORAGE_NOT_FOUND`.
5. **Given** a non-existent data directory, **When** I upload, **Then** the directory is created automatically.
6. **Given** an AbortSignal that is already aborted, **When** I upload, **Then** it rejects immediately.

---

### User Story 2 — Store and retrieve a blob on FOC (Priority: P1)

A developer stores bytes on FOC and gets back dual CIDs for verification.

**Why this priority**: Core value proposition — verifiable decentralized storage.

**Note**: FOC acceptance scenarios are **integration tests** (opt-in, require wallet + network). Unit tests mock the FOC SDK.

**Acceptance Scenarios**:

1. **Given** a FocStorageBackend with a valid wallet on calibration testnet, **When** I upload a `Uint8Array`, **Then** I receive a `StorageResult` with `id` (= PieceCID), `pieceCid`, and `ipfsCid` all populated.
2. **Given** a stored blob on FOC, **When** I download by `id`, **Then** I get the exact same bytes.
3. **Given** a stored blob on FOC, **When** I call `verify(id)`, **Then** it confirms the piece exists.
4. **Given** no network access, **When** I upload, **Then** it throws `StorageUnreachableError`.
5. **Given** insufficient wallet balance, **When** I upload, **Then** it throws `StorageInsufficientBalanceError`.
6. **Given** `id` is a PieceCID string, **Then** it is durable across process restarts and sufficient for later retrieval.

---

### User Story 3 — Manage head manifests with conflict detection (Priority: P1)

A developer creates and updates head manifests with single-writer enforcement.

**Why this priority**: The manifest chain is the mutable index over immutable data.

**Acceptance Scenarios**:

1. **Given** no existing manifest for project "test", **When** I call `getHead("test")`, **Then** it returns `null`.
2. **Given** no existing manifest, **When** I call `putHead("test", manifest, null)`, **Then** it returns a `StoredHead` with a non-empty `headId`.
3. **Given** an existing head with `headId: "abc"`, **When** I `putHead("test", newManifest, "abc")`, **Then** it succeeds and returns a new `StoredHead` with a different `headId`.
4. **Given** an existing head with `headId: "abc"`, **When** I `putHead("test", newManifest, "stale-id")`, **Then** it throws `ManifestConflictError` with `expected: "stale-id"` and `actual: "abc"`.
5. **Given** multiple projects, **When** I call `listProjects()`, **Then** it returns all project names.
6. **Given** a manifest with `schemaVersion: 1`, **When** stored and retrieved, **Then** `schemaVersion` is preserved.

---

### User Story 4 — Upload and validate segment blobs (Priority: P2)

A developer uploads a segment and validates schema version handling.

**Acceptance Scenarios**:

1. **Given** a `Segment` with `schemaVersion: 1`, `embeddingModel`, and `embeddingDimensions`, **When** serialized to JSON and uploaded, **Then** I get a `StorageResult`.
2. **Given** a stored segment, **When** downloaded and deserialized, **Then** all fields match including `embeddingModel` and `embeddingDimensions`.
3. **Given** a segment JSON with `schemaVersion: 99`, **When** a reader validates it, **Then** it throws `SchemaUnknownError`.

---

### User Story 5 — Swap backends at initialization (Priority: P2)

A developer chooses storage backend and manifest store at init time, or provides custom implementations.

**Acceptance Scenarios**:

1. **Given** `createStore({ storage: 'local', dataDir: '/tmp/test' })`, **Then** it uses LocalStorageBackend and LocalManifestStore.
2. **Given** `createStore({ storage: 'foc', privateKey: '0x...', network: 'calibration' })`, **Then** it uses FocStorageBackend and LocalManifestStore.
3. **Given** `createStore({ storage: myCustomBackend, manifests: myCustomManifestStore })`, **Then** both custom implementations are used.
4. **Given** a custom backend that doesn't implement `verify`, **Then** `verify()` calls return `undefined` gracefully.

### Edge Cases

- Non-existent local data directory → created automatically
- FOC insufficient balance → `StorageInsufficientBalanceError`
- Two processes updating same manifest → `ManifestConflictError` via `prevHeadId` mismatch
- Segment upload succeeds but manifest update fails → orphan segment (harmless), manifest unchanged, safe to retry
- Calibration testnet reset → `StorageUnreachableError` / `StorageNotFoundError`
- AbortSignal fired mid-upload → operation rejected, no partial state

## Requirements

### Functional Requirements

- **FR-001**: System MUST implement `StorageBackend` interface from `@wtfoc/common` (including `AbortSignal` support)
- **FR-002**: `LocalStorageBackend` stores blobs as files named by content SHA-256 hash
- **FR-003**: `FocStorageBackend` stores blobs via `@filoz/synapse-sdk`, returns `StorageResult` with `id` = PieceCID (durable, survives restarts)
- **FR-004**: `FocStorageBackend` uses `filecoin-pin` for CAR creation to produce IPFS CIDs alongside PieceCIDs
- **FR-005**: System MUST implement `ManifestStore` interface with `getHead`, `putHead(name, manifest, prevHeadId)`, `listProjects`
- **FR-006**: `LocalManifestStore` persists head manifests as JSON files. Path is **configurable** (default provided by CLI, not hardcoded)
- **FR-007**: `putHead` compares `prevHeadId` to current `StoredHead.headId`; rejects on mismatch with `ManifestConflictError`
- **FR-008**: `createStore()` factory accepts storage backend config + optional `ManifestStore` instance
- **FR-009**: All manifests and segments include `schemaVersion: 1`
- **FR-010**: Readers reject unknown `schemaVersion` with `SchemaUnknownError`
- **FR-011**: `FocStorageBackend` uses `source: 'wtfoc'` for synapse-sdk namespace isolation
- **FR-012**: Segments include `embeddingModel` and `embeddingDimensions` metadata
- **FR-013**: `StorageNotFoundError` for missing artifacts, `StorageUnreachableError` for backend connectivity failures

### Key Entities

- **StorageResult**: `{ id, ipfsCid?, pieceCid?, proof? }` — `id` is always durable and sufficient for later retrieval
- **StoredHead**: `{ headId, manifest }` — returned from `getHead`/`putHead`, `headId` used for conflict detection
- **HeadManifest**: `{ schemaVersion, name, prevHeadId, segments[], totalChunks, embeddingModel, embeddingDimensions, createdAt, updatedAt }`
- **Segment**: `{ schemaVersion, embeddingModel, embeddingDimensions, chunks[], edges[] }`
- **SegmentSummary**: `{ id, ipfsCid?, pieceCid?, sourceTypes[], timeRange?, repoIds?, chunkCount }`

## Success Criteria

- **SC-001**: Local storage round-trip works (upload → download → verify match)
- **SC-002**: FOC storage round-trip works on calibration (**integration test, opt-in**)
- **SC-003**: Manifest conflict detection rejects stale writes 100% of the time
- **SC-004**: Schema version rejection blocks unknown versions
- **SC-005**: Custom backend + custom manifest store plug in with zero internal changes
- **SC-006**: All unit tests pass with local backends only (no network, no wallet)
- **SC-007**: Segment round-trip preserves `embeddingModel` and `embeddingDimensions`

## Testing Strategy

- **Unit tests**: LocalStorageBackend, LocalManifestStore, schema validation, error mapping. All use temp directories, no network.
- **Integration tests** (opt-in, CI secret-gated): FocStorageBackend against calibration testnet. Skipped by default.
- **Contract tests**: Custom backend mock implementing `StorageBackend` — verifies the interface contract is sufficient.

## Dependencies

- `@wtfoc/common` — interfaces, schemas, errors
- `@filoz/synapse-sdk` — FOC storage operations
- `filecoin-pin` — CAR creation for dual CIDs
- `viem` — wallet client for FOC

## Out of Scope

- FOC-backed `ManifestStore` (future spec)
- Manifest compaction / garbage collection
- Multi-writer / CAS semantics (MVP is single-writer)
- BM25 / hybrid search (that's `@wtfoc/search`)

## References

- [SPEC.md](../../SPEC.md) — rules 2, 4, 5, 7, 8
- [Issue #1](https://github.com/SgtPooki/wtfoc/issues/1) — architecture discussion
- [synapse-sdk](https://github.com/FilOzone/synapse-sdk) — `Synapse.create()`, `storage.upload()`, `storage.download()`
- [filecoin-pin](https://github.com/filecoin-project/filecoin-pin) — `createCarFromFile()`, `executeUpload()`
