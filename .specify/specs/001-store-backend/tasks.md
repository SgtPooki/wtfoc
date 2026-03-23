# Tasks: Store Backend

**Input**: Design documents from `/specs/001-store-backend/`
**Prerequisites**: plan.md (required), spec.md (required)

## Phase 1: Setup (COMPLETE)

- [x] T001 Project structure created (packages/store/)
- [x] T002 Package.json with @wtfoc/common dependency
- [x] T003 TypeScript config with project references

---

## Phase 2: Foundational — Schema Validation (Blocking)

**Purpose**: Shared validation that all storage operations depend on

- [ ] T004 [US4] Create `packages/store/src/schema.ts` with `validateManifestSchema(data: unknown): HeadManifest` that validates schemaVersion and required fields, throws SchemaUnknownError for unknown versions
- [ ] T005 [P] [US4] Create `packages/store/src/schema.test.ts` with tests: valid manifest passes, unknown schemaVersion throws, missing required fields throw
- [ ] T006 [US4] Create `serializeSegment(segment: Segment): Uint8Array` and `deserializeSegment(data: Uint8Array): Segment` in `packages/store/src/segment.ts` with schema validation
- [ ] T007 [P] [US4] Create `packages/store/src/segment.test.ts` with tests: round-trip serialization, schema validation, embeddingModel/embeddingDimensions preserved

**Checkpoint**: Schema validation ready — all storage operations can validate data on read/write

---

## Phase 3: User Story 1 — Local Storage (COMPLETE)

- [x] T008 [US1] LocalStorageBackend with content-hash put/get/verify + AbortSignal
- [x] T009 [US1] Tests: round-trip, deterministic ids, not-found error, verify, auto-create dir, abort

**Checkpoint**: Local blob storage fully functional

---

## Phase 4: User Story 3 — Local Manifest Store (COMPLETE)

- [x] T010 [US3] LocalManifestStore with headId conflict detection
- [x] T011 [US3] Tests: create, chain, conflict rejection, list, schema preservation

**Checkpoint**: Local manifest management fully functional

---

## Phase 5: User Story 5 — Factory (COMPLETE)

- [x] T012 [US5] createStore() factory with local/foc/custom backends
- [x] T013 [US5] Tests: local store, foc rejection, custom backend, custom manifest store

**Checkpoint**: Store factory composing backends

---

## Phase 6: User Story 2 — FOC Storage Backend

**Goal**: Store and retrieve blobs on FOC with dual CIDs

**Independent Test**: Upload bytes to calibration testnet, download by PieceCID, verify CID resolves

### Tests for User Story 2

- [ ] T014 [P] [US2] Unit test for FocStorageBackend with mocked synapse-sdk: upload returns StorageResult with id/pieceCid/ipfsCid, download returns bytes, verify confirms existence
- [ ] T015 [P] [US2] Unit test for FOC error mapping: network error → StorageUnreachableError, insufficient balance → StorageInsufficientBalanceError, not found → StorageNotFoundError

### Implementation for User Story 2

- [ ] T016 [US2] Create `packages/store/src/backends/foc.ts` implementing StorageBackend using @filoz/synapse-sdk for upload/download and filecoin-pin for CAR creation + IPFS CIDs
- [ ] T017 [US2] Map synapse-sdk errors to wtfoc typed errors (StorageUnreachableError, StorageInsufficientBalanceError, StorageNotFoundError)
- [ ] T018 [US2] Set `source: 'wtfoc'` for synapse-sdk namespace isolation (FR-011)
- [ ] T019 [US2] Return StorageResult with `id` = PieceCID (durable), `pieceCid`, `ipfsCid` from filecoin-pin CAR metadata
- [ ] T020 [US2] Support AbortSignal on upload/download/verify
- [ ] T021 [US2] Update createStore() factory to instantiate FocStorageBackend when `storage: 'foc'` is passed
- [ ] T022 [P] [US2] Optional integration test (skipped by default, runs with FOC_TEST=1 env var): real upload/download/verify on calibration testnet
- [ ] T023 [US2] Export FocStorageBackend from packages/store/src/index.ts

**Checkpoint**: FOC storage fully functional with dual CIDs

---

## Phase 7: Polish

- [ ] T024 [P] Add packages/store/README.md with usage examples for local + FOC + custom backends
- [ ] T025 Update packages/store/src/index.ts exports to include schema validation and segment helpers
- [ ] T026 [P] Ensure all tests pass: `pnpm test` from root
- [ ] T027 [P] Ensure lint passes: `pnpm lint` from root

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: COMPLETE
- **Phase 2 (Schema)**: No dependencies on other phases — can start immediately
- **Phase 3 (Local Storage)**: COMPLETE
- **Phase 4 (Local Manifest)**: COMPLETE
- **Phase 5 (Factory)**: COMPLETE
- **Phase 6 (FOC Backend)**: Depends on Phase 2 (schema validation needed for segment handling)
- **Phase 7 (Polish)**: Depends on Phase 6 completion

### Parallel Opportunities

- T004/T005 (schema) and T006/T007 (segment) can run in parallel
- T014 and T015 (FOC tests) can run in parallel
- T022 (integration test) is independent and can run any time after T016-T020
- All Phase 7 tasks marked [P] can run in parallel

### Agent Assignment Suggestion

- **Phase 2 (Schema)**: Any agent — small, self-contained
- **Phase 6 (FOC Backend)**: Best for an agent with access to synapse-sdk + filecoin-pin codebases for reference
- **Phase 7 (Polish)**: Any agent
