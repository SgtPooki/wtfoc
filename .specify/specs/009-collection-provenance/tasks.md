# Tasks: Collection Revisions and Provenance

**Input**: Design documents from `/specs/009-collection-provenance/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Behavior tests are required for schema evolution, head/revision persistence, metadata enforcement, diff behavior, mount semantics, and query/trace boundary preservation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. `US1`, `US2`, `US3`)
- Include exact file paths in descriptions

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Evolve shared contracts and schemas that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 Update shared manifest and collection publication schemas in `packages/common/src/schemas/manifest.ts` — rename `HeadManifest` to `CollectionHead`, add `collectionId` and `currentRevisionId` as required fields (redefine schema v1 in place), add `CollectionRevision`, `CollectionDescriptor`, `ArtifactSummaryEntry`, `DatasetRoutingMetadata`, and `ProvenanceRecord` types
- [x] T002 [P] Update shared exports in `packages/common/src/index.ts` to expose collection publication contracts
- [x] T003 Update manifest store contracts in `packages/common/src/interfaces/manifest-store.ts` so `ManifestStore` remains the owning seam for the single mutable `CollectionHead`
- [x] T004 [P] Add typed error classes in `packages/common/src/errors.ts`: `RevisionSchemaUnknownError` (code: `REVISION_SCHEMA_UNKNOWN`), `CollectionHeadConflictError` (code: `COLLECTION_HEAD_CONFLICT`), `PublishFailedError` (code: `PUBLISH_FAILED`)
- [x] T005 [P] Add schema validation coverage for `CollectionHead`, `CollectionRevision`, provenance records, and collection-revision schema-version rejection in `packages/store/src/schema.test.ts`
- [x] T006 Implement collection publication schema validation helpers, routing metadata validation, and artifact summary equality helpers in `packages/store/src/schema.ts`

**Checkpoint**: Shared schemas, seam ownership, typed errors, schema-version rejection, and metadata/equality validation are ready for story implementation.

---

## Phase 2: User Story 1 - Publish a collection with stable FOC identity (Priority: P1) 🎯 MVP

**Goal**: Support a stable collection handle, explicit dataset routing metadata rules, and ordinary collection-level artifacts stored in the collection dataset.

**Independent Test**: Create a collection, publish two revisions, and confirm both revisions use the same stable collection handle and same logical dataset mapping while storing richer collection state as ordinary artifacts.

### Tests for User Story 1 ⚠️

- [x] T007 [P] [US1] Add stable collection handle and deterministic ID tests in `packages/store/src/collection.test.ts`
- [x] T008 [P] [US1] Add dataset routing metadata allowlist and validation tests in `packages/store/src/collection.test.ts`
- [x] T009 [P] [US1] Add collection artifact placement tests for descriptor/head/revision artifacts in `packages/store/src/collection.test.ts`
- [x] T010 [P] [US1] Add slug-collision handling tests for deterministic collection IDs (hash of `{namespace}/{name}` tuple) in `packages/store/src/collection.test.ts`
- [x] T011 [P] [US1] Add lazy dataset creation tests for first publish in `packages/store/src/collection.test.ts`

### Implementation for User Story 1

- [x] T012 [US1] Evolve local manifest persistence from `HeadManifest` to `CollectionHead` in `packages/store/src/manifest/local.ts` (done in Phase 1)
- [x] T013 [US1] Add `CollectionDescriptor` persistence helpers in `packages/store/src/collection.ts`
- [x] T014 [P] [US1] Extend store factory types for collection-aware publication flows in `packages/store/src/collection.ts`
- [x] T015 [P] [US1] Update store exports for collection publication types and helpers in `packages/store/src/index.ts`
- [x] T016 [US1] Implement deterministic machine collection ID generation (hash `{storageNamespace}/{collectionName}`), collision-safe normalization, and first-publish lazy dataset creation in `packages/store/src/collection.ts`
- [x] T017 [US1] Implement dataset routing metadata enforcement, metadata allowlist validation, and artifact-placement helpers in `packages/store/src/collection.ts`

**Checkpoint**: A collection has stable identity, validated routing metadata, and collection-level artifacts persisted without abusing dataset metadata.

---

## Phase 3: User Story 2 - Publish provenance-aware collection revisions (Priority: P1)

**Goal**: Publish immutable `CollectionRevision` artifacts, preserve provenance, advance a single mutable `CollectionHead`, and define failure semantics for publication.

**Independent Test**: Publish two revisions for a collection and confirm previous revision lineage, provenance fields, head advancement, and publish failure handling are all preserved.

### Tests for User Story 2 ⚠️

- [ ] T018 [P] [US2] Add revision lineage and provenance tests in `packages/store/src/schema.test.ts`
- [ ] T019 [P] [US2] Add `CollectionHead` conflict and advancement tests in `packages/store/src/factory.test.ts`
- [ ] T020 [P] [US2] Add publish failure semantics tests for orphaned revisions, failed head advancement, and retry-safe recovery in `packages/store/src/factory.test.ts`

### Implementation for User Story 2

- [ ] T021 [US2] Implement `CollectionRevision` serialization and persistence helpers in `packages/store/src/revision.ts` (new file — separate from ingest-time segment.ts per FR-006d)
- [ ] T022 [US2] Implement provenance record validation and normalization in `packages/store/src/schema.ts`
- [ ] T023 [US2] Update local manifest store behavior to advance `CollectionHead.currentRevisionId` with single-writer conflict checks in `packages/store/src/manifest/local.ts`
- [ ] T024 [US2] Implement publication failure handling, orphan revision detection (by content-addressed ID), and retry-safe relink semantics in `packages/store/src/factory.ts`

**Checkpoint**: Collection revisions are immutable, provenance-aware, and advanced through one mutable head with explicit failure semantics.

---

## Phase 4: User Story 3 - Mount a collection from a CID or revision handle (Priority: P2)

**Goal**: Let another consumer discover a published revision, hydrate search/trace state, and reuse stored corpus embeddings without full re-embedding.

**Independent Test**: Mount a published revision in a fresh environment and run query/trace using the stored collection state, distinguishing pinned revision mounts from latest-state mounts.

### Tests for User Story 3 ⚠️

- [ ] T025 [P] [US3] Add mounted collection query reuse tests in `packages/search/src/query.test.ts`
- [ ] T026 [P] [US3] Add mounted collection trace discovery tests that prove trace can operate from explicit edges without semantic fallback in `packages/search/src/trace.test.ts`
- [ ] T027 [P] [US3] Add mounted collection boundary tests showing semantic query behavior remains separate from explicit-edge trace behavior in `packages/search/src/query.test.ts`
- [ ] T028 [P] [US3] Add mount semantics tests for pinned revision handles versus latest collection handles in `packages/search/src/query.test.ts`

### Implementation for User Story 3

- [ ] T029 [US3] Implement revision and artifact discovery helpers for mounted collections in `packages/search/src/query.ts`
- [ ] T030 [US3] Implement explicit-edge mounted trace discovery in `packages/search/src/trace.ts`
- [ ] T031 [P] [US3] Update search package exports for mounted-collection helpers in `packages/search/src/index.ts`
- [ ] T032 [US3] Add CLI surface for collection mount and inspect flows in `packages/cli/src/cli.ts` (follow SPEC.md §11 output conventions: --json, --quiet, exit codes per §10)
- [ ] T033 [US3] Add human and JSON output for mounted collection inspection in `packages/cli/src/output.ts`

**Checkpoint**: Mounted collections can be discovered and reused without full corpus re-embedding, and mount semantics are unambiguous.

---

## Phase 5: User Story 4 - Discover what changed since a prior revision (Priority: P2)

**Goal**: Provide metadata-only revision diffs based on compact artifact summary entries.

**Independent Test**: Compare two revisions and obtain added/removed artifact summaries without loading full artifact bodies.

### Tests for User Story 4 ⚠️

- [ ] T034 [P] [US4] Add artifact-summary diff tests in `packages/store/src/schema.test.ts`
- [ ] T035 [P] [US4] Add `contentIdentity` equality semantics tests (IPFS CID for FOC, SHA-256 hex for local) in `packages/store/src/schema.test.ts`
- [ ] T036 [P] [US4] Add CLI diff output tests in `packages/cli/src/output.test.ts`

### Implementation for User Story 4

- [ ] T037 [US4] Implement revision diff computation from `ArtifactSummaryEntry[]` in `packages/store/src/schema.ts`
- [ ] T038 [US4] Implement backend-neutral `contentIdentity` generation (IPFS CID for FOC, SHA-256 hex for local) in `packages/store/src/schema.ts`
- [ ] T039 [US4] Add collection diff command handling in `packages/cli/src/cli.ts` (follow SPEC.md §11 output conventions)
- [ ] T040 [US4] Add revision diff rendering in `packages/cli/src/output.ts`

**Checkpoint**: Collection revision diffs are machine-readable, metadata-only, and based on explicit equality semantics.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency, docs, and regression coverage across the new collection publication model.

- [ ] T041 [P] Add CLI publish command surface in `packages/cli/src/cli.ts` (follow SPEC.md §11 output conventions: --json, --quiet, exit codes per §10)
- [ ] T042 [P] Validate quickstart flows against implemented CLI surface in `.specify/specs/009-collection-provenance/quickstart.md`
- [ ] T043 [P] Update user-facing README for collection publication terminology in `README.md`
- [ ] T044 Run `pnpm test`, `pnpm lint:fix`, and `pnpm -r build`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies and blocks all user stories
- **User Story 1 (Phase 2)**: Depends on Foundational
- **User Story 2 (Phase 3)**: Depends on Foundational and benefits from User Story 1 collection identity work
- **User Story 3 (Phase 4)**: Depends on Foundational and User Story 2 revision publication
- **User Story 4 (Phase 5)**: Depends on Foundational and User Story 2 revision artifact structure
- **Polish (Phase 6)**: Depends on desired story phases being complete

### User Story Dependencies

- **User Story 1 (P1)**: MVP foundation for stable collection identity and dataset metadata rules
- **User Story 2 (P1)**: Builds on US1 to add immutable revisions, provenance, and publish failure semantics
- **User Story 3 (P2)**: Uses US2 revision artifacts for mount/query/trace reuse
- **User Story 4 (P2)**: Uses US2 artifact summaries for diff workflows

### Within Each User Story

- Tests should be written before implementation tasks and fail first
- Shared schema updates happen only in Phase 1
- CLI/output work should follow store/search behavior changes

### Parallel Opportunities

- T002, T004, T005 can run in parallel after T001/T003
- T007 through T011 can run in parallel
- T014 and T015 can run in parallel after T012/T013
- T018 through T020 can run in parallel
- T025 through T028 can run in parallel
- T034 through T036 can run in parallel
- T041 through T043 can run in parallel before T044

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Complete Foundational schema and contract work
2. Implement User Story 1 for stable collection identity and metadata enforcement
3. Implement User Story 2 for collection revisions, provenance, and publish failure semantics
4. Validate publication semantics before mount/diff features

### Incremental Delivery

1. Foundation ready
2. Add stable collection identity
3. Add immutable revision publication
4. Add mounted collection reuse
5. Add revision diffs

## Notes

- Keep 009 scoped to collection publication semantics, not subscriptions/change feeds
- Do not redefine ingest-time CAR bundling here
- Preserve backend-neutral identity even while targeting FOC dataset behavior
- Spec 010 (CAR Bundle Uploads) is merged. `segmentRefs` use `SegmentSummary.id` values and `bundleRefs` use `BatchRecord.carRootCid` values from the merged 010 schema
