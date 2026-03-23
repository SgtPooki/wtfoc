# Feature Specification: CAR Bundle Uploads

**Feature Branch**: `010-car-bundle-uploads`
**Created**: 2026-03-23
**Status**: Implemented (cross-reviewed by Cursor + Codex)
**Input**: User description: "Bundle all segments from a single ingest command into one CAR file before uploading to FOC, preventing small-piece gas abuse. Each wtfoc ingest produces at most one PieceCID on-chain. Track per-segment CIDs within the CAR for granular retrieval. Refs issue #41."

## Clarifications

### Session 2026-03-23

- Q: Should the CAR-level PieceCID be duplicated on each SegmentSummary, tracked as a separate batch-level record on the manifest head, or replace the segment-level pieceCid entirely? → A: Add a batch-level record to the manifest head linking one PieceCID to its contained segment IDs. Per-segment ipfsCid stays for retrieval; batch groups segments by upload.
- Q: Should CAR bundling logic live inside the StorageBackend interface, in an orchestration layer above it, or as a separate BundleStrategy seam? → A: Orchestration layer builds CAR and calls existing upload() with assembled CAR bytes. No StorageBackend interface change. Extract a seam later only if a second bundling strategy appears.
- Q: Should minimum piece size trigger a local storage fallback for undersized CARs? → A: No. Segments always contain serialized chunks with embeddings (thousands of bytes minimum). The existing FocStorageBackend size check is sufficient — no local fallback logic needed.

### Cross-review 2026-03-23 (Cursor + Codex)

- Defined exact `BatchRecord` shape and `batches` field on manifest head.
- Pinned `SegmentSummary.id` as the directly retrievable per-segment CID (no semantic change).
- Specified `SegmentSummary.pieceCid` is unused for bundled ingests (batch record holds the PieceCID).
- Added verify-before-publish requirement for bundled uploads.
- Added upload-succeeds-but-head-fails edge case.
- Resolved "per-chunk CIDs" vs "segment only" — granularity is per-segment, not per-chunk.
- Added stable in-CAR path naming requirement.
- Separated deterministic CID computation from best-effort gateway resolution.
- Added schema versioning decision: `batches` is optional, no schema version bump needed.
- Fixed FR/SC numbering.

## Overview

Today, each `wtfoc ingest` command uploads one segment as a single CAR file to FOC. If a future multi-source ingest produces multiple segments, each would become a separate on-chain piece — costing the storage provider gas for every PDP proof. This is expensive and makes wtfoc a bad ecosystem citizen.

This feature ensures that each `wtfoc ingest` invocation bundles all its artifacts (segment JSON files) into a single CAR file structured as a UnixFS directory. One ingest = one upload = one PieceCID. Individual artifacts within the CAR remain addressable via their IPFS CIDs (indexed by IPNI).

**Note on granularity:** The unit of bundling is the **segment** (serialized JSON containing chunks + embeddings + edges), not individual chunks. Per-chunk CIDs are not tracked — chunk content lives inside the segment and is accessed by loading the segment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single ingest produces one FOC upload (Priority: P1)

An operator runs `wtfoc ingest` against a source. Regardless of how many chunks or segments are produced, the system bundles everything into one CAR and uploads it as a single piece to FOC.

**Why this priority**: This is the core gas-abuse prevention requirement and the reason the feature exists. Without it, multi-source ingests could spam the network with small pieces.

**Independent Test**: Run an ingest that produces at least one segment, confirm only one upload call occurs, and verify the result contains both an IPFS root CID and a PieceCID.

**Acceptance Scenarios**:

1. **Given** an ingest command targeting one source, **When** the ingest completes with FOC storage, **Then** exactly one CAR upload occurs and the manifest records one batch with a PieceCID.
2. **Given** an ingest command targeting one source, **When** the CAR is uploaded, **Then** the manifest head records a batch linking the PieceCID to its segment IDs, and each segment summary retains its individual IPFS CID for retrieval.
3. **Given** the system is using local storage, **When** an ingest completes, **Then** bundling is skipped and individual segment files are stored as before (local storage has no gas cost).

---

### User Story 2 - Individual artifacts remain retrievable after bundling (Priority: P1)

After a bundled upload, a consumer can still download individual segments by their IPFS CIDs. The orchestration layer computes per-segment CIDs deterministically before upload and records them in the manifest. Resolution via public gateways or IPNI may lag but is expected to converge.

**Why this priority**: Bundling is useless if it breaks granular retrieval. The download and search paths must still work with per-segment CIDs.

**Independent Test**: Build a bundled CAR locally, verify that each segment's CID is computed and recorded in the manifest before upload, then confirm the segment content round-trips correctly.

**Acceptance Scenarios**:

1. **Given** a segment was uploaded inside a bundled CAR, **When** a consumer requests the segment by its IPFS CID, **Then** the content is returned correctly.
2. **Given** a bundled CAR was uploaded, **When** the manifest is inspected, **Then** each segment summary contains its individual IPFS CID for retrieval.
3. **Given** the bundle builder has computed per-segment CIDs, **When** the CIDs are recorded in the manifest, **Then** each CID is deterministically derived from the segment content (not dependent on external indexing).

---

### Edge Cases

- CAR creation fails mid-bundle (e.g., out of memory for very large ingests)
- Upload succeeds but the returned PieceCID is missing or malformed
- A segment's individual IPFS CID is not resolvable via gateways after upload (IPNI indexing delay — operational, not a correctness bug)
- Multiple sequential ingests into the same collection — each produces its own CAR, not a merged one
- The ingest produces zero chunks (empty source) — no CAR should be created, no manifest update
- **Upload succeeds but manifest head update fails** — orphaned CAR on FOC with no manifest reference. On retry, the system should detect that segment CIDs already exist in the previous upload result and reuse them rather than re-uploading.
- AbortSignal fired during CAR assembly vs during upload — both must clean up gracefully
- Mixed history: older manifest segments have `pieceCid` on summaries (pre-bundling), newer ones use batch records — both must coexist
- Single-segment FOC ingest: still bundled into a CAR (no special-case bare CAR path)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST bundle all artifacts from a single `ingest` command into one CAR file structured as a UnixFS directory before uploading to FOC. Each segment MUST be placed at a stable, deterministic path within the directory (e.g., `segments/{segmentId}.json`) to ensure reproducible per-segment CIDs.
- **FR-002**: The system MUST produce at most one PieceCID per `ingest` invocation when using FOC storage.
- **FR-003**: The orchestration layer MUST compute per-segment IPFS CIDs deterministically from segment content during CAR assembly, before upload. These CIDs are recorded in the manifest and do not depend on external gateway or IPNI resolution.
- **FR-004**: The manifest head MUST include an optional `batches` array of `BatchRecord` objects. Each `BatchRecord` links one PieceCID to the segment IDs it contains. The `batches` field is optional (absent for local-only or pre-bundling manifests), so no `schemaVersion` bump is required. Existing manifest readers that do not recognize `batches` will ignore it safely.
- **FR-005**: The system MUST skip CAR bundling when using local storage (no behavior change for `--local` mode). Local-mode segments belong to no batch record.
- **FR-006**: `SegmentSummary.id` MUST remain the directly retrievable per-segment artifact identifier (the per-segment IPFS CID for FOC, or the local storage ID for local mode). Existing retrieval paths in `trace`, `query`, and `download` MUST NOT regress.
- **FR-007**: `SegmentSummary.pieceCid` is unused for bundled ingests — the batch record holds the PieceCID. For pre-bundling manifests, `pieceCid` on segment summaries remains valid and must still be readable.
- **FR-008**: The system MUST not create or upload a CAR when an ingest produces zero chunks. No manifest update should occur for empty ingests.
- **FR-009**: The system MUST use `filecoin-pin` for CAR creation (per SDK policy in the constitution).
- **FR-010**: The system MUST NOT change the `StorageBackend` interface. CAR assembly MUST happen in an orchestration layer above the storage backend, calling the existing `upload()` with the assembled CAR bytes. The orchestration layer must know the CAR root CID and per-segment CIDs before calling `upload()`.
- **FR-011**: The system MUST verify the uploaded CAR (confirm the upload result includes a valid PieceCID) before publishing the new manifest head, per SPEC.md rule 5 ("upload segments first, verify, then publish head").
- **FR-012**: CAR assembly and upload MUST respect `AbortSignal` for cancellation.

### Key Entities

- **CAR Bundle**: A Content-Addressable aRchive file containing all artifacts from one ingest batch, structured as a UnixFS directory with a root CID. Segment files are placed at deterministic paths (`segments/{segmentId}.json`).
- **Batch Record**: A manifest-level record with fields: `pieceCid` (the on-chain piece identifier), `carRootCid` (the IPFS root CID of the CAR), `segmentIds` (array of segment IDs contained in this CAR), and `createdAt` (ISO timestamp). Each FOC ingest upload produces one batch record. Every FOC-uploaded segment belongs to exactly one batch record.
- **Artifact IPFS CID**: The content-addressed identifier for an individual artifact (segment JSON) within the CAR, used for granular retrieval. Stored in `SegmentSummary.id`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A single `wtfoc ingest` command produces at most one FOC upload regardless of the number of chunks or segments generated.
- **SC-002**: After a bundled upload, each segment can be individually retrieved by its IPFS CID (`SegmentSummary.id`) and its content matches the original.
- **SC-003**: The manifest correctly records a batch record with PieceCID, CAR root CID, and segment IDs after a bundled upload.
- **SC-004**: Per-segment CIDs are computed deterministically during CAR assembly and match the CIDs resolvable from the uploaded CAR content.
- **SC-005**: Local-mode ingests are unaffected — no bundling overhead or behavior change.
- **SC-006**: Manifests with mixed history (pre-bundling segments with `pieceCid` on summaries + newer segments with batch records) are readable without errors.

## Out of Scope

- Multi-ingest CAR merging (combining CARs from separate ingest runs)
- Per-chunk CID tracking (chunks live inside segments; granularity is per-segment)
- CAR-level encryption or access control
- Resumable uploads for very large CARs
- Local storage fallback for undersized CARs (segments always exceed minimum piece size)
- Head compaction or batch record pruning (future optimization if head size becomes a concern)

## References

- Issue #41: Bundle uploads into CAR files — prevent small-piece gas abuse
- Constitution principle VII: Bundle Uploads — Never Spam Small Pieces
- SPEC.md rule 5: Upload segments first, verify, then publish head
- SPEC.md rule 8: SDK policy (use filecoin-pin for CAR creation)
- Spec 007: FOC Storage Backend (deferred CAR bundling to this spec)
