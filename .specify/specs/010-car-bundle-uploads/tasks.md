# Tasks: CAR Bundle Uploads

**Input**: Design documents from `/specs/010-car-bundle-uploads/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/batch-record.ts

**Tests**: Included — constitution requires tests for all changes (principle VI).

**Organization**: Tasks grouped by user story. US1 (single ingest → one upload) is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Schema additions and shared infrastructure needed before any story

- [x] T001 Add `BatchRecord` interface and optional `batches` field to `HeadManifest` in `packages/common/src/schemas/manifest.ts`
- [x] T002 Export `BatchRecord` from `packages/common/src/index.ts`
- [x] T003 Add `batches` array validation (optional field, validate each `BatchRecord` shape) in `packages/store/src/schema.ts`
- [x] T004 Add unit tests for manifest validation with and without `batches` field in `packages/store/src/schema.test.ts`

**Checkpoint**: Schema changes complete. Existing tests still pass. `pnpm test` green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The bundler orchestration module that both user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 Create `bundleAndUpload()` orchestration function in `packages/store/src/bundler.ts` that:
  - Takes an array of `{ id: string, data: Uint8Array }` segments and a `StorageBackend`
  - Computes per-segment IPFS CIDs via `filecoin-pin.createCarFromFile(file, { bare: true })`
  - Builds a directory CAR via `filecoin-pin.createCarFromFiles(files)` with stable paths `segments/{segmentId}.json`
  - Calls `storage.upload(carBytes, { prebuiltCar: "true", carRootCid: "<rootCid>" })` once
  - Verifies the result includes a valid `pieceCid` (FR-011)
  - Throws a typed error if CAR assembly fails (e.g., OOM, corrupted segment data)
  - Returns a `BundleUploadResult` with the `BatchRecord` and per-segment CID map
  - Respects `AbortSignal` for cancellation (FR-012)
- [x] T006 Update `FocStorageBackend.upload()` in `packages/store/src/backends/foc.ts` to check `metadata?.prebuiltCar === "true"` and skip internal CAR creation when the data is already a pre-built CAR. When `prebuiltCar` is set, read `metadata.carRootCid` for the root CID and upload the raw bytes directly via `filecoin-pin.executeUpload()`. Full metadata contract: `{ prebuiltCar: "true", carRootCid: "<cid>" }`.
- [x] T007 Export `bundleAndUpload` and `BundleUploadResult` from `packages/store/src/index.ts`
- [x] T008 [P] Create unit tests for `bundleAndUpload()` in `packages/store/src/bundler.test.ts`:
  - Mock `StorageBackend` to verify `upload()` is called exactly once
  - Verify returned `BatchRecord` has correct `pieceCid`, `carRootCid`, `segmentIds`, `createdAt`
  - Verify per-segment CIDs are deterministic (same input → same CID)
  - Verify `AbortSignal` cancellation during assembly and upload
  - Verify error when `pieceCid` is missing from upload result
- [x] T009 [P] Add unit tests for `FocStorageBackend` pre-built CAR path in `packages/store/src/backends/foc.test.ts` (or extend existing tests):
  - Verify `prebuiltCar` metadata skips internal CAR creation
  - Verify raw bytes are passed through to upload
  - NOTE: Covered by bundler tests (T008) which exercise the full prebuiltCar flow through mock storage. No standalone foc.test.ts exists; creating one would require mocking the entire synapse upload chain.

**Checkpoint**: Bundler module complete and tested. `pnpm test` green. `pnpm -r build` succeeds.

---

## Phase 3: User Story 1 — Single ingest produces one FOC upload (Priority: P1) MVP

**Goal**: Each `wtfoc ingest` with FOC storage bundles all segments into one CAR and produces one PieceCID. Manifest records a `BatchRecord`.

**Independent Test**: Run `wtfoc ingest --storage foc` against a repo source, verify one upload occurs, manifest has a batch record with PieceCID and segment IDs.

### Implementation for User Story 1

- [x] T010 [US1] Modify the ingest command in `packages/cli/src/cli.ts` (lines ~248-279) to:
  - If zero chunks produced, skip upload and manifest update entirely (FR-008)
  - Check if storage backend is FOC via the CLI's `--storage` config value (not `instanceof` — avoids coupling CLI to concrete backend class)
  - If FOC: call `bundleAndUpload([{ id: segmentId(segment), data: segmentBytes }], store.storage)` instead of `store.storage.upload(segmentBytes)`
  - Use the returned `BatchRecord` when building the manifest
  - If local: keep existing direct `store.storage.upload()` path unchanged (FR-005)
- [x] T011 [US1] Update manifest construction in `packages/cli/src/cli.ts` to:
  - Use per-segment CIDs from the bundler result as `SegmentSummary.id` (FR-006)
  - Append the `BatchRecord` to `manifest.batches` (creating the array if absent)
  - Do NOT set `SegmentSummary.pieceCid` for bundled ingests (FR-007)
- [x] T012 [US1] Add integration test in `packages/cli/src/cli.test.ts` (or new `packages/store/src/bundler.integration.test.ts`):
  - Use a mock/spy `StorageBackend` that records calls
  - Verify exactly one `upload()` call for FOC path
  - Verify manifest contains `batches` array with one entry
  - Verify `SegmentSummary.id` matches the per-segment CID from bundler
  - Verify `SegmentSummary.pieceCid` is NOT set on bundled segments

**Checkpoint**: US1 complete. `wtfoc ingest` with FOC storage produces one CAR upload and correct manifest with batch record. `pnpm test` green.

---

## Phase 4: User Story 2 — Individual artifacts remain retrievable after bundling (Priority: P1)

**Goal**: Segments uploaded inside a bundled CAR can be individually downloaded by their IPFS CIDs. Existing `trace`, `query`, and `download` paths work without regression.

**Independent Test**: Bundle and upload segments, then download each segment by its `SegmentSummary.id` and verify content matches the original.

### Implementation for User Story 2

- [x] T013 [US2] Verify that `FocStorageBackend.download(id)` in `packages/store/src/backends/foc.ts` works correctly with per-segment CIDs from bundled CARs (these are standard IPFS CIDs — existing gateway download path should work). Add a test case if needed.
- [x] T014 [US2] Add round-trip test in `packages/store/src/bundler.test.ts`:
  - Build a bundled CAR locally
  - Extract per-segment CIDs
  - Verify each CID is deterministically computed from segment content
  - Verify CID matches what `createCarFromFile(file, { bare: true })` produces for that segment alone
- [x] T015 [US2] Add regression test verifying `trace` and `query` work with bundled manifests:
  - Create a manifest with `batches` array and segment summaries
  - Load segments via `SegmentSummary.id` (the per-segment CID)
  - Run trace/query and verify results are correct

**Checkpoint**: US2 complete. Retrieval by per-segment CID works. `trace` and `query` are unaffected. `pnpm test` green.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Mixed-history compatibility, cleanup, and validation

- [x] T016 [P] Add test for mixed-history manifests in `packages/store/src/schema.test.ts`: manifest with both pre-bundling segments (having `pieceCid` on summaries) and post-bundling segments (with batch records) validates correctly
- [x] T017 [P] Add edge case test: empty ingest (zero chunks) produces no CAR and no manifest update
- [x] T018 Run `pnpm lint:fix` across all changed packages
- [x] T019 Run `pnpm -r build` and verify all packages build
- [x] T020 Run `pnpm test` and verify all tests pass (existing + new)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema types must exist)
- **User Story 1 (Phase 3)**: Depends on Phase 2 (bundler must exist)
- **User Story 2 (Phase 4)**: Depends on Phase 2 (bundler must exist). Can run in parallel with US1.
- **Polish (Phase 5)**: Depends on Phase 3 and Phase 4

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Foundational only. No dependency on US2.
- **User Story 2 (P1)**: Depends on Foundational only. No dependency on US1. Can run in parallel.

### Within Each Phase

- T001 → T002 (export depends on type existing)
- T003 → T004 (tests depend on validation code)
- T005 → T006 (foc.ts change depends on bundler contract)
- T005 → T007 (export depends on module)
- T008, T009 can run in parallel after T005/T006
- T010 → T011 (manifest update depends on ingest changes)
- T010, T011 → T012 (integration test depends on implementation)

### Parallel Opportunities

- T003 and T005 can start in parallel (different packages)
- T008 and T009 can run in parallel (different test files)
- US1 (Phase 3) and US2 (Phase 4) can run in parallel after Phase 2
- T016 and T017 can run in parallel (different test concerns)

---

## Parallel Example: Foundational Phase

```bash
# After T005 and T006 are complete, launch tests in parallel:
Task T008: "Unit tests for bundleAndUpload() in packages/store/src/bundler.test.ts"
Task T009: "Unit tests for FocStorageBackend prebuiltCar path in packages/store/src/backends/foc.test.ts"
```

## Parallel Example: User Stories

```bash
# After Phase 2, US1 and US2 can run in parallel:
Phase 3 (US1): T010 → T011 → T012
Phase 4 (US2): T013 → T014 → T015
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T009)
3. Complete Phase 3: User Story 1 (T010-T012)
4. **STOP and VALIDATE**: `wtfoc ingest` with FOC produces one upload, manifest has batch record
5. Can demo/deploy at this point

### Incremental Delivery

1. Setup + Foundational → Schema and bundler ready
2. User Story 1 → Single-upload ingest works → MVP!
3. User Story 2 → Retrieval verification → Full confidence
4. Polish → Mixed-history, edge cases, lint/build validation
5. Each story adds value without breaking previous stories
