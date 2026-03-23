# Tasks: E2E Integration Pipeline

**Input**: Design documents from `.specify/specs/012-e2e-integration-pipeline/`
**Prerequisites**: plan.md (required), spec.md (required), research.md

**Tests**: This feature IS the test. The entire deliverable is a test file.

**Organization**: Tasks grouped by user story. Single test file, built incrementally.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)

## Phase 1: Setup

**Purpose**: Create the test file with shared fixtures and mock embedder.

- [x] T001 Create test file with mock embedder, shared temp dir setup/teardown, and synthetic markdown fixtures in `packages/store/src/e2e-pipeline.test.ts`

**Checkpoint**: Test file exists, vitest discovers it, mock embedder produces deterministic vectors.

---

## Phase 2: User Story 1 — Full ingest-to-query pipeline (Priority: P1) MVP

**Goal**: Prove ingest → chunk → embed → store → mount → query works end-to-end.

**Independent Test**: Ingest synthetic markdown, store segment, reload from storage, query, verify results.

- [x] T002 [US1] Add test: ingest synthetic markdown, chunk it, embed with mock embedder, extract edges, build segment, store with LocalStorageBackend, update CollectionHead via LocalManifestStore — assert collectionId is set and currentRevisionId is null (FR-006) in `packages/store/src/e2e-pipeline.test.ts`
- [x] T003 [US1] Add test: reload stored segment from storage, deserialize, validate it passes schema validation (round-trip integrity) in `packages/store/src/e2e-pipeline.test.ts`
- [x] T004 [US1] Add test: mount collection from CollectionHead using mountCollection(), run query(), verify results contain expected content with non-zero scores in `packages/store/src/e2e-pipeline.test.ts`

**Checkpoint**: US1 complete — full ingest → store → mount → query pipeline verified.

---

## Phase 3: User Story 2 — Full ingest-to-trace pipeline with edge following (Priority: P1)

**Goal**: Prove edge extraction and trace traversal work end-to-end.

**Independent Test**: Ingest data with cross-references, trace, verify edge hops with evidence.

- [x] T005 [US2] Add test: ingest markdown with "Refs #123" cross-references, verify edges are stored in segment with correct type/source/target/evidence in `packages/store/src/e2e-pipeline.test.ts`
- [x] T006 [US2] Add test: run trace() on collection with edges, verify trace result includes hops following explicit edges with evidence in `packages/store/src/e2e-pipeline.test.ts`
- [x] T007 [US2] Add test: trace on data with no cross-references produces semantic-only results (no edge hops) in `packages/store/src/e2e-pipeline.test.ts`

**Checkpoint**: US2 complete — edge extraction and trace traversal verified.

---

## Phase 4: User Story 3 — Multi-source ingest into single collection (Priority: P2)

**Goal**: Prove multiple sources can be ingested into one collection with unified query.

- [x] T008 [US3] Add test: ingest two different synthetic sources into same collection with correct prevHeadId chaining, verify CollectionHead has two segments in `packages/store/src/e2e-pipeline.test.ts`
- [x] T009 [US3] Add test: query multi-source collection, verify results span both sources in `packages/store/src/e2e-pipeline.test.ts`

**Checkpoint**: US3 complete — multi-source pipeline verified.

---

## Phase 5: Edge Cases

**Purpose**: Cover boundary conditions from the spec.

- [x] T010 [P] Add test: empty ingest (zero chunks) produces no segment and no CollectionHead update in `packages/store/src/e2e-pipeline.test.ts`
- [x] T011 [P] Add test: query empty collection returns zero results without error in `packages/store/src/e2e-pipeline.test.ts`
- [x] T012 [P] Add test: CollectionHead conflict detection rejects write with wrong prevHeadId in `packages/store/src/e2e-pipeline.test.ts`

**Checkpoint**: Edge cases covered.

---

## Phase 6: Polish

- [x] T013 Run `pnpm lint:fix` across changed files
- [x] T014 Run `pnpm -r build` and verify all packages build
- [x] T015 Run `pnpm test` and verify all tests pass (existing + new)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **US1 (Phase 2)**: Depends on Phase 1 (mock embedder + fixtures)
- **US2 (Phase 3)**: Depends on Phase 1 (reuses fixtures). Can run in parallel with US1.
- **US3 (Phase 4)**: Depends on Phase 1. Can run in parallel with US1/US2.
- **Edge Cases (Phase 5)**: Depends on Phase 1. Can run in parallel with user stories.
- **Polish (Phase 6)**: Depends on all previous phases.

### Parallel Opportunities

- T005-T007 (US2) can run in parallel with T002-T004 (US1) since they're in the same file but test different scenarios
- T010-T012 (edge cases) are independent of each other

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: US1 (T002-T004)
3. **STOP and VALIDATE**: Full ingest → store → mount → query pipeline works
4. This alone proves the architecture

### Incremental Delivery

1. Setup → mock embedder + fixtures ready
2. US1 → ingest/store/query pipeline proven
3. US2 → edge extraction + trace proven
4. US3 → multi-source proven
5. Edge cases → boundary conditions covered

## Notes

- All tests share one file to minimize vitest overhead and fixture duplication
- Mock embedder uses content hashing for deterministic vectors
- Temp directories are created per test suite and cleaned up in afterAll
- Test file imports from package public APIs only (no internal module paths)
