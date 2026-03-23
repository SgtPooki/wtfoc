# Implementation Plan: CAR Bundle Uploads

**Branch**: `010-car-bundle-uploads` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/010-car-bundle-uploads/spec.md`

## Summary

Bundle all segments from a single `wtfoc ingest` into one CAR file (UnixFS directory) before uploading to FOC. Produces at most one PieceCID per ingest. Individual segments remain retrievable by their per-segment IPFS CIDs. A new optional `batches` array on `HeadManifest` tracks batch-to-segment mappings without breaking existing manifests.

**Technical approach**: Add a `bundleAndUpload()` orchestration function in `@wtfoc/store` that uses `filecoin-pin.createCarFromFiles()` to build a multi-file directory CAR, then calls the existing `StorageBackend.upload()` with the assembled CAR bytes. The CLI's ingest command calls this function instead of `storage.upload()` directly when using FOC storage.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >=24
**Primary Dependencies**: `filecoin-pin` (CAR creation), `@filoz/synapse-sdk` (FOC upload), `@wtfoc/common` (interfaces)
**Storage**: FOC (filecoin-pin + synapse-sdk) for bundled uploads, local filesystem for `--local` mode
**Testing**: vitest (unit + integration), local/in-memory backends for unit tests
**Target Platform**: Node.js CLI
**Project Type**: Monorepo library packages + CLI
**Performance Goals**: N/A — bundling is a one-time ingest operation, not latency-sensitive
**Constraints**: `StorageBackend` interface must not change; `filecoin-pin` SDK policy per constitution

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | PASS | `StorageBackend` interface unchanged. Bundling is orchestration, not a new seam. |
| II. Standalone Packages | PASS | Bundling logic lives in `@wtfoc/store` (or `@wtfoc/cli`), not `@wtfoc/common`. |
| III. Backend-Neutral Identity | PASS | `SegmentSummary.id` stays the retrievable per-segment CID. `batches` is optional. |
| IV. Immutable Data, Mutable Index | PASS | CARs are immutable. Manifest head (mutable) gains optional `batches` array. |
| V. Edges Are First-Class | N/A | No edge changes. |
| VI. Test-First | PASS | Unit tests with in-memory backend, no network calls. |
| VII. Bundle Uploads | PASS | This feature implements principle VII. |
| VIII. Hackathon-First | PASS | Ships working bundling; clean architecture for extension. |

**No violations. Gate passed.**

## Project Structure

### Documentation (this feature)

```text
specs/010-car-bundle-uploads/
├── plan.md              # This file
├── spec.md              # Feature specification (ratified)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── batch-record.ts  # BatchRecord type contract
└── checklists/
    └── requirements.md  # Quality checklist
```

### Source Code (files to create or modify)

```text
packages/
├── common/src/
│   └── schemas/
│       └── manifest.ts          # MODIFY: add BatchRecord type + optional batches field
├── store/src/
│   ├── backends/
│   │   └── foc.ts               # MODIFY: update to handle directory CAR uploads
│   ├── bundler.ts               # CREATE: orchestration layer — bundleAndUpload()
│   ├── bundler.test.ts          # CREATE: unit tests for bundler
│   ├── schema.ts                # MODIFY: validate optional batches array
│   └── index.ts                 # MODIFY: export bundler
└── cli/src/
    └── cli.ts                   # MODIFY: ingest command uses bundler for FOC storage
```

**Structure Decision**: Changes span three packages (`common`, `store`, `cli`) following the existing build order. The bundler is a new module in `@wtfoc/store` — it's orchestration over storage, not a new package.

## Complexity Tracking

No constitution violations. No complexity justifications needed.

## Post-Design Constitution Re-check

All gates still pass after Phase 1 design:
- `BatchRecord` type goes in `@wtfoc/common` (schemas only, no I/O) — principle II OK
- `bundler.ts` in `@wtfoc/store` uses `filecoin-pin` — principle I/VIII OK
- `metadata: { prebuiltCar: "true" }` signals pre-built CAR to `FocStorageBackend` without interface change — principle I OK
- Optional `batches` field, no schema version bump — principle IV OK

## Coordination Note

Spec 009 (Collection Provenance, Codex) confirms `HeadManifest` is renamed to `CollectionHead` — the single mutable head carrying both ingest-facing summary data and a pointer to the current immutable `CollectionRevision` (009 FR-006b/FR-006c). There is one mutable head, not two.

Our `batches` field is "ingest history" — exactly the kind of data 009 says CollectionHead carries. When 009 lands, the reconciliation is:
1. Rename `HeadManifest` → `CollectionHead` in all 010 code
2. Add 009's new fields (`collectionId`, `currentRevisionId`, etc.) alongside our `batches`
3. No structural conflict — both specs agree ingest data stays on the head

Whoever merges second does the mechanical integration. See 009 follow-on notes.
