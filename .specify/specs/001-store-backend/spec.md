# Feature Specification: Store Backend

**Feature Branch**: `001-store-backend`
**Created**: 2026-03-23
**Status**: Draft
**Spec**: [`SPEC.md` rules 2-5, 7-8](../../SPEC.md)
**Package**: `@wtfoc/store`

## Overview

Implement the `@wtfoc/store` package — the foundational storage layer that all other packages depend on. Provides pluggable blob storage and manifest management with backend-neutral artifact identity.

Two built-in backends:
1. **LocalStorageBackend** — filesystem, no wallet, no network (already scaffolded)
2. **FocStorageBackend** — FOC via `@filoz/synapse-sdk` + `filecoin-pin`, dual CIDs

Plus the manifest chain: head manifests (mutable pointers) over immutable segment blobs.

## User Scenarios & Testing

### User Story 1 — Store and retrieve a blob locally (Priority: P1)

A developer wants to store arbitrary bytes and retrieve them by ID without any FOC/network setup.

**Why this priority**: Everything else depends on working put/get. This unblocks all downstream packages.

**Independent Test**: Store bytes → get ID back → download by ID → bytes match.

**Acceptance Scenarios**:

1. **Given** a LocalStorageBackend configured with a temp directory, **When** I upload a `Uint8Array`, **Then** I receive a `StorageResult` with a non-empty `id` and no `ipfsCid`/`pieceCid`.
2. **Given** a stored blob, **When** I download by the returned `id`, **Then** I get back the exact same bytes.
3. **Given** a stored blob, **When** I call `verify(id)`, **Then** it returns `{ exists: true, size: N }` where N matches the original byte length.
4. **Given** an ID that was never stored, **When** I download by that ID, **Then** it throws a `StorageUnreachableError` with code `STORAGE_UNREACHABLE`.

---

### User Story 2 — Store and retrieve a blob on FOC (Priority: P1)

A developer wants to store bytes on FOC and get back both a PieceCID and IPFS CID for verification.

**Why this priority**: This is the core value proposition — verifiable decentralized storage. Without this, wtfoc is just local RAG.

**Independent Test**: Store bytes on calibration testnet → get dual CIDs → download by ID → bytes match → verify CID resolves.

**Acceptance Scenarios**:

1. **Given** a FocStorageBackend configured with a valid wallet and calibration testnet, **When** I upload a `Uint8Array`, **Then** I receive a `StorageResult` with `id`, `pieceCid`, and `ipfsCid` all populated.
2. **Given** a stored blob on FOC, **When** I download by `id`, **Then** I get back the exact same bytes.
3. **Given** a stored blob on FOC, **When** I call `verify(id)`, **Then** it confirms the piece exists on-chain.
4. **Given** no network access, **When** I try to upload, **Then** it throws `StorageUnreachableError` with context including the backend type.

---

### User Story 3 — Manage head manifests locally (Priority: P1)

A developer wants to create and update head manifests that track the current state of a project's segments.

**Why this priority**: The manifest chain is the mutable index over immutable data. Without it, there's no way to track what's been ingested.

**Independent Test**: Create manifest → update manifest → verify prevHeadId links → reject stale update.

**Acceptance Scenarios**:

1. **Given** no existing manifest for project "test", **When** I call `getHead("test")`, **Then** it returns `null`.
2. **Given** no existing manifest, **When** I call `putHead("test", manifest)`, **Then** subsequent `getHead("test")` returns that manifest.
3. **Given** an existing manifest with version 1, **When** I putHead with version 2 and `prevHeadId` matching the current head's ID, **Then** it succeeds.
4. **Given** an existing manifest, **When** I putHead with a `prevHeadId` that doesn't match the current head, **Then** it throws `ManifestConflictError`.
5. **Given** multiple projects, **When** I call `listProjects()`, **Then** it returns all project names.

---

### User Story 4 — Upload segment blobs (Priority: P2)

A developer wants to upload a segment (JSON blob of chunks + embeddings + edges) and reference it from a head manifest.

**Why this priority**: Segments are the immutable data that manifests point to. This connects storage to the ingest pipeline.

**Independent Test**: Serialize segment → upload → get ID → download → deserialize → verify contents match.

**Acceptance Scenarios**:

1. **Given** a `Segment` object, **When** I serialize it to JSON bytes and upload, **Then** I get a `StorageResult` with an ID.
2. **Given** a stored segment, **When** I download and deserialize, **Then** the `schemaVersion`, `chunks`, and `edges` match the original.
3. **Given** a segment with `schemaVersion: 1`, **When** a reader supporting only version 1 loads it, **Then** it succeeds.
4. **Given** a segment with `schemaVersion: 99`, **When** a reader supporting only version 1 loads it, **Then** it throws `SchemaUnknownError`.

---

### User Story 5 — Swap storage backend at initialization (Priority: P2)

A developer wants to choose between local and FOC storage at initialization time, or provide their own custom backend.

**Why this priority**: This validates the pluggable seam — the core architectural promise of wtfoc.

**Independent Test**: Initialize with local → works. Initialize with FOC → works. Initialize with custom → works.

**Acceptance Scenarios**:

1. **Given** `createStore({ backend: 'local', dataDir: '/tmp/test' })`, **When** I upload, **Then** it uses LocalStorageBackend.
2. **Given** `createStore({ backend: 'foc', privateKey: '0x...', network: 'calibration' })`, **When** I upload, **Then** it uses FocStorageBackend.
3. **Given** `createStore({ backend: myCustomBackend })`, where `myCustomBackend` implements `StorageBackend`, **When** I upload, **Then** it uses the custom backend.

### Edge Cases

- What happens when the local data directory doesn't exist? → Create it automatically.
- What happens when FOC wallet has insufficient balance? → Throw typed error with clear message and `code: 'STORAGE_INSUFFICIENT_BALANCE'`.
- What happens when two processes try to update the same manifest simultaneously? → Single writer wins via `prevHeadId` check; loser gets `ManifestConflictError`.
- What happens when a segment upload succeeds but manifest update fails? → Segment exists as orphan (harmless). Manifest state unchanged. Safe to retry.
- What happens when downloading a segment that was stored on FOC but calibration testnet was reset? → `StorageUnreachableError` with clear context.

## Requirements

### Functional Requirements

- **FR-001**: System MUST implement the `StorageBackend` interface from `@wtfoc/common`
- **FR-002**: System MUST provide `LocalStorageBackend` that stores blobs as files named by content SHA-256 hash
- **FR-003**: System MUST provide `FocStorageBackend` that stores blobs via `@filoz/synapse-sdk` and returns dual CIDs (PieceCID + IPFS CID)
- **FR-004**: `FocStorageBackend` MUST use `filecoin-pin` for CAR creation to get IPFS CIDs alongside PieceCIDs
- **FR-005**: System MUST implement `ManifestStore` interface with `getHead`, `putHead`, `listProjects`
- **FR-006**: System MUST provide `LocalManifestStore` that persists head manifests as JSON files in `~/.wtfoc/projects/`
- **FR-007**: `putHead` MUST verify `prevHeadId` matches current head before writing (single-writer enforcement)
- **FR-008**: System MUST provide a `createStore()` factory that accepts backend configuration and returns a composed store
- **FR-009**: All stored manifests and segments MUST include `schemaVersion: 1`
- **FR-010**: Readers MUST reject manifests/segments with unknown `schemaVersion` by throwing `SchemaUnknownError`
- **FR-011**: `FocStorageBackend` MUST use `source: 'wtfoc'` for synapse-sdk namespace isolation

### Key Entities

- **StorageResult**: `{ id, ipfsCid?, pieceCid?, proof? }` — returned from every upload
- **HeadManifest**: Mutable pointer with `schemaVersion`, `segments[]`, `prevHeadId`, `embeddingModel`, `embeddingDimensions`
- **Segment**: Immutable blob with `schemaVersion`, `chunks[]`, `edges[]`
- **SegmentSummary**: Lightweight routing metadata in head manifest: `sourceTypes`, `timeRange`, `repoIds`, `chunkCount`

## Success Criteria

### Measurable Outcomes

- **SC-001**: Local storage round-trip (upload → download → verify) works in <100ms for 1MB blobs
- **SC-002**: FOC storage round-trip works on calibration testnet (upload → download → verify CID resolves)
- **SC-003**: Manifest conflict detection correctly rejects stale writes 100% of the time
- **SC-004**: Schema version rejection correctly blocks unknown versions
- **SC-005**: Custom backend plugs in with zero changes to wtfoc internals — interface contract only
- **SC-006**: All tests pass with `--local` mode (no network, no wallet)

## Dependencies

- `@wtfoc/common` — interfaces and schemas (already scaffolded)
- `@filoz/synapse-sdk` — FOC storage operations
- `filecoin-pin` — CAR creation for dual CIDs
- `viem` — wallet client for FOC

## References

- [SPEC.md](../../SPEC.md) — rules 2 (credible exit), 4 (backend-neutral identity), 5 (immutable data), 7 (format compatibility)
- [Issue #1](https://github.com/SgtPooki/wtfoc/issues/1) — architecture discussion, Codex R1 critique on manifest design
- [synapse-sdk API](https://github.com/FilOzone/synapse-sdk) — `Synapse.create()`, `storage.upload()`, `storage.download()`
- [filecoin-pin API](https://github.com/filecoin-project/filecoin-pin) — `createCarFromFile()`, `executeUpload()`
