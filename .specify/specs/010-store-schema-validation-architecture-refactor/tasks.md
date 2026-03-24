# Tasks: Store Schema Validation Architecture Refactor

**Input**: Design documents from `.specify/specs/010-store-schema-validation-architecture-refactor/`
**Prerequisites**: plan.md, spec.md, research.md

**Tests**: Run `pnpm --filter @wtfoc/store test` plus targeted build/lint verification for `@wtfoc/store`.

**Organization**: Tasks grouped by user story so behavior preservation and structural cleanup can be verified incrementally.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2)

## Phase 1: Setup

**Purpose**: Create the target module layout without changing validation behavior.

- [ ] T001 Create `packages/store/src/schema/` internal module structure and reduce `packages/store/src/schema.ts` to a compatibility/export layer

**Checkpoint**: Public import surface is unchanged and the module structure is ready for extraction.

---

## Phase 2: User Story 1 — Manifest validation remains stable (Priority: P1)

**Goal**: Move manifest-focused logic into a dedicated module without changing manifest validation behavior.

**Independent Test**: Existing manifest tests continue to pass.

- [ ] T002 [US1] Extract manifest-specific schemas, validators, and semantic checks into `packages/store/src/schema/manifest.ts`
- [ ] T003 [US1] Extract shared manifest-related helper usage into `packages/store/src/schema/shared.ts` where generic reuse is justified
- [ ] T004 [US1] Run and update `packages/store/src/schema.test.ts` only as needed to preserve the current external contract

**Checkpoint**: Manifest validation is isolated and behaviorally unchanged.

---

## Phase 3: User Story 2 — Segment validation remains stable (Priority: P1)

**Goal**: Move segment-focused logic into a dedicated module without changing segment validation behavior.

**Independent Test**: Existing segment tests continue to pass.

- [ ] T005 [US2] Extract segment-specific schemas, chunk validation, edge validation, and semantic checks into `packages/store/src/schema/segment.ts`
- [ ] T006 [US2] Reuse shared schema helpers from `packages/store/src/schema/shared.ts` without duplicating primitive guards
- [ ] T007 [US2] Add or adjust targeted tests only if extraction reveals an uncovered segment behavior edge

**Checkpoint**: Segment validation is isolated and behaviorally unchanged.

---

## Phase 4: User Story 3 — Future changes can stay localized (Priority: P2)

**Goal**: Leave the schema validator in a maintainable structure with clear ownership boundaries.

**Independent Test**: Source tree clearly separates manifest, segment, and shared responsibilities.

- [ ] T008 [US3] Remove dead helper duplication and ensure each module owns only its domain logic
- [ ] T009 [US3] Verify `packages/store/src/schema.ts` remains a thin facade with no domain-heavy logic

**Checkpoint**: The new structure is navigable and ownership is obvious.

---

## Phase 5: Verification and Polish

- [ ] T010 Run `pnpm lint:fix`
- [ ] T011 Run `pnpm --filter @wtfoc/store test`
- [ ] T012 Run `pnpm --filter @wtfoc/store build`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **US1 (Phase 2)**: Depends on Phase 1
- **US2 (Phase 3)**: Depends on Phase 1, can proceed after the shared helper shape is established
- **US3 (Phase 4)**: Depends on Phases 2 and 3
- **Verification (Phase 5)**: Depends on all previous phases

### Parallel Opportunities

- T004 and T007 are partially parallel after the extraction work lands
- Verification tasks are sequential at the end

## Implementation Strategy

### MVP First

1. Create the new module structure
2. Extract manifest validation
3. Extract segment validation
4. Confirm all existing schema tests still pass

### Incremental Delivery

1. Public facade stays stable
2. Manifest logic becomes isolated
3. Segment logic becomes isolated
4. Final pass removes leftover coupling and verifies package quality gates
