# Tasks: Fix Docker Image for Hosted MCP Web Server

**Input**: Design documents from `/specs/119-fix-docker-image/`
**Prerequisites**: plan.md (required), spec.md (required), research.md

**Tests**: Not explicitly requested. Docker build verification serves as the acceptance test.

**Organization**: Tasks grouped by user story for independent implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: User Story 1 - Container starts successfully (Priority: P1) MVP

**Goal**: Fix the production Docker image so the hosted MCP web server starts without module-not-found errors.

**Independent Test**: `docker build -t wtfoc-test . && docker run --rm wtfoc-test` — container starts, logs readiness, no CrashLoopBackOff.

### Implementation for User Story 1

- [x] T001 [US1] Add COPY stanzas for packages/config (package.json, dist, node_modules) in Dockerfile production stage (after line 73, before apps/web block)
- [x] T002 [US1] Add COPY stanzas for packages/ingest (package.json, dist, node_modules) in Dockerfile production stage (after packages/config block)
- [x] T003 [US1] Add inline comment in Dockerfile documenting which packages are required and why, to prevent future regressions

**Checkpoint**: Container starts successfully with all workspace packages resolved.

---

## Phase 2: User Story 2 - Image remains lean (Priority: P2)

**Goal**: Verify that the added packages do not re-introduce pruned heavy dependencies.

**Independent Test**: Build the image and check that crawlee, discord.js, sharp are not present in the final image.

### Implementation for User Story 2

- [x] T004 [US2] Verify Docker build succeeds and image size delta is reasonable (< 10 MB increase) — Dockerfile structurally valid; Docker build requires manual verification

**Checkpoint**: Image builds, stays lean, and starts correctly.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1)**: No dependencies — start immediately
- **Phase 2 (US2)**: Depends on Phase 1 completion (need working Dockerfile to verify)

### Within User Story 1

- T001 and T002 can run in parallel (different COPY blocks, no conflict) but are in the same file so sequential is cleaner
- T003 depends on T001 and T002 (comment references the added blocks)

### Parallel Opportunities

- T001 and T002 modify the same file so sequential execution is preferred
- T004 runs after T001-T003 are complete

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Add missing COPY stanzas (T001, T002)
2. Add documentation comment (T003)
3. **STOP and VALIDATE**: Build and run the Docker image
4. Commit with `fix(docker): include config and ingest packages in production image`

### Incremental Delivery

1. T001-T003 → Container starts → Commit
2. T004 → Verify image size → Done

---

## Notes

- This is a minimal 4-task fix affecting only the Dockerfile
- The fix follows the exact same COPY pattern used for existing packages (common, store, search, mcp-server)
- No source code changes needed — only Docker build configuration
- Commit after T003 with conventional commit: `fix(docker): include config and ingest packages in production image`
