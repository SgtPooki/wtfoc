# Tasks: Incremental Ingest Pipeline

**Input**: Design documents from `.specify/specs/118-incremental-ingest/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Tests are included as this project requires test-first development per constitution.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new project setup needed — this feature extends existing packages. This phase covers the shared cursor store module used by all user stories.

- [x] T001 Create cursor store module with read/write/path functions in `packages/ingest/src/cursor-store.ts`
- [x] T002 [P] Create cursor store unit tests in `packages/ingest/src/cursor-store.test.ts`
- [x] T003 Export cursor store from `packages/ingest/src/index.ts`

**Checkpoint**: Cursor store is independently testable and exported.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No additional foundational work needed — cursor store (Phase 1) is the only shared prerequisite.

**⚠️ CRITICAL**: Phase 1 must complete before user story phases begin.

---

## Phase 3: User Story 1 - Incremental Source Fetching (Priority: P1) 🎯 MVP

**Goal**: Re-running `wtfoc ingest github` automatically resumes from last successful position, fetching only new/updated items.

**Independent Test**: Run `wtfoc ingest github owner/repo -c test` twice — second run should only fetch new items.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T004 [P] [US1] Unit test for GitHub adapter cursor integration in `packages/ingest/src/cursor-integration.test.ts` — cursor lifecycle tests covering read, write, override, failure, and multi-source scenarios
- [x] T005 [P] [US1] Integration test for incremental ingest CLI flow in `packages/ingest/src/cursor-integration.test.ts` — test cursor read before ingest, cursor write after success, no write on failure, explicit `--since` override

### Implementation for User Story 1

- [x] T006 [US1] Wire cursor read into `packages/cli/src/commands/ingest.ts` — before adapter.ingest(), read cursor file, build source key, inject cursorValue as `since` if no explicit `--since` flag
- [x] T007 [US1] Compute max timestamp from ingested chunks in `packages/cli/src/commands/ingest.ts` — track the maximum `updatedAt`/`timestamp` from all yielded chunks during the ingest loop
- [x] T008 [US1] Wire cursor write after successful ingest in `packages/cli/src/commands/ingest.ts` — after all batches flush successfully, write the computed max timestamp as the new cursor value
- [x] T009 [US1] Add CLI output for cursor status in `packages/cli/src/commands/ingest.ts` — log "Resuming from cursor: {timestamp}" when using stored cursor, "Saved cursor for next run" after write
- [ ] T010 [US1] Add cursor support to repo adapter in `packages/ingest/src/adapters/repo/adapter.ts` — deferred: repo adapter uses file walking, not timestamp-based API; cursor injection happens at CLI layer via `since` config

**Checkpoint**: `wtfoc ingest github owner/repo -c test` uses stored cursors automatically. Explicit `--since` overrides. Failed ingests don't advance cursor.

---

## Phase 4: User Story 2 - Incremental Vector Indexing (Priority: P2)

**Goal**: Reloading a collection into a persistent vector backend skips already-indexed segments.

**Independent Test**: Mount a collection, add new segments via ingest, re-mount — only new segments should be downloaded and indexed.

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T011 [P] [US2] Unit test for mount with skipSegmentIds in `packages/search/src/mount.test.ts` — test that segments in skipSegmentIds are not downloaded or added to the vector index

### Implementation for User Story 2

- [x] T012 [US2] Add `skipSegmentIds` option to MountOptions in `packages/search/src/mount.ts` — extend MountOptions interface with optional `skipSegmentIds: ReadonlySet<string>`
- [x] T013 [US2] Implement segment skipping in mountCollection in `packages/search/src/mount.ts` — skip download/parse/add for segments whose ID is in skipSegmentIds; log count of skipped vs processed segments
- [x] T014 [US2] Export updated types from `packages/search/src/index.ts` — MountOptions already re-exported, no changes needed

**Checkpoint**: `mountCollection()` with `skipSegmentIds` skips already-indexed segments. Without it, behavior is unchanged (backward compatible).

---

## Phase 5: User Story 3 - Partial Re-chunking (Priority: P3)

**Goal**: `reindex --rechunk` only re-chunks and re-embeds oversized chunks; chunks within size limit keep their original IDs and embeddings.

**Independent Test**: Create a collection with mixed chunk sizes, run `reindex --rechunk --max-chunk-chars 2000` — only oversized chunks should be re-processed.

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T015 [P] [US3] Unit test for partial rechunk logic in `packages/cli/src/commands/reindex.test.ts` — test that chunks within size limit are preserved with original embeddings, only oversized chunks are re-split and re-embedded

### Implementation for User Story 3

- [x] T016 [US3] Separate chunks into keep/rechunk sets in `packages/cli/src/commands/reindex.ts` — when `--rechunk` is active, partition loaded chunks into those within maxChars (keep with original embeddings) and those exceeding it (need rechunk + re-embed)
- [x] T017 [US3] Preserve original embeddings for unchanged chunks in `packages/cli/src/commands/reindex.ts` — build segments from kept chunks using their existing embeddings (loaded from source segments) instead of re-embedding
- [x] T018 [US3] Only re-embed the re-chunked chunks in `packages/cli/src/commands/reindex.ts` — call embedder.embedBatch only for newly split chunks, merge with preserved chunks into final segments
- [x] T019 [US3] Add CLI output for partial rechunk stats in `packages/cli/src/commands/reindex.ts` — log "Preserved N chunks, re-chunked M oversized → K new chunks"

**Checkpoint**: `reindex --rechunk` preserves chunks within size limit (same IDs, same embeddings). Only oversized chunks are re-split and re-embedded.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T020 [P] Run `pnpm lint:fix` across all modified packages
- [x] T021 [P] Run `pnpm test` to verify all tests pass (520/520 pass)
- [x] T022 Run `pnpm build` to verify compilation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **User Story 1 (Phase 3)**: Depends on Phase 1 (cursor store)
- **User Story 2 (Phase 4)**: No dependencies on Phase 1 — can start after Setup or in parallel with US1
- **User Story 3 (Phase 5)**: No dependencies on Phase 1 or other stories — can start in parallel
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on cursor store (T001-T003). Core MVP.
- **User Story 2 (P2)**: Independent of cursor store. Only modifies mount.ts.
- **User Story 3 (P3)**: Independent of cursor store. Only modifies reindex.ts.

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Implementation follows the task order within the story
- Story complete before moving to polish

### Parallel Opportunities

- T002 (cursor store tests) can run in parallel with T001 (cursor store implementation)
- US2 (T011-T014) and US3 (T015-T019) can run in parallel with US1 (T004-T010)
- All test tasks within different stories can run in parallel
- T020, T021 can run in parallel

---

## Parallel Example: All User Stories

```bash
# After Phase 1 (cursor store) is complete, all three stories can start in parallel:

# Story 1: Incremental Source Fetching
Task: T004 "Unit test for GitHub adapter cursor integration"
Task: T005 "Integration test for incremental ingest CLI flow"
# then T006 → T007 → T008 → T009 → T010

# Story 2: Incremental Vector Indexing (can start immediately — no cursor dependency)
Task: T011 "Unit test for mount with skipSegmentIds"
# then T012 → T013 → T014

# Story 3: Partial Re-chunking (can start immediately — no cursor dependency)
Task: T015 "Unit test for partial rechunk logic"
# then T016 → T017 → T018 → T019
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Cursor Store
2. Complete Phase 3: Incremental Source Fetching (US1)
3. **STOP and VALIDATE**: Run `wtfoc ingest github` twice, verify cursor behavior
4. Deploy/demo if ready

### Incremental Delivery

1. Cursor Store → US1 (incremental ingest) → Test → Deploy (MVP!)
2. Add US2 (incremental mount) → Test → Deploy
3. Add US3 (partial rechunk) → Test → Deploy
4. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Constitution requires: test-first, atomic commits, `pnpm lint:fix`, no `any`
