# Tasks: .wtfocignore Support

**Input**: Design documents from `/specs/119-wtfocignore-support/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: No setup needed — this feature modifies existing packages only.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Expand built-in ignore patterns and update `createIgnoreFilter` signature for all user stories.

- [ ] T001 [P] Expand `BUILTIN_IGNORE_PATTERNS` in `packages/common/src/config-types.ts` to include: `dist/`, `build/`, `out/`, `coverage/`, `.next/`, `.turbo/`, `__pycache__/`, `*.lock`, `*.min.js`, `*.min.css`, `*.map`
- [ ] T002 [P] Update `createIgnoreFilter` signature in `packages/config/src/ignore.ts` to accept variadic pattern sources: `createIgnoreFilter(...patternSources: (string[] | undefined)[])` — merges all sources additively after builtins. Update existing tests in `packages/config/src/ignore.test.ts` to match new signature and verify expanded defaults (e.g., `filter("dist/bundle.js")` returns false, `filter("package-lock.json")` returns false, `filter("foo.min.js")` returns false, `filter("app.js.map")` returns false)
- [ ] T003 Verify `pnpm build` and `pnpm test` pass after foundational changes

**Checkpoint**: Built-in defaults expanded, `createIgnoreFilter` accepts variadic sources, all existing tests pass.

---

## Phase 3: User Story 1 — Sensible Default Exclusions (Priority: P1) MVP

**Goal**: Ignore filter always applies for repo ingestion, even without any config file.

**Independent Test**: Run `wtfoc ingest repo .` on a repo with no `.wtfoc.json` or `.wtfocignore` — verify `*.lock`, `*.map`, `dist/` files are excluded.

### Implementation for User Story 1

- [ ] T004 [US1] Refactor `packages/cli/src/commands/ingest.ts` lines 136-141: always create ignore filter for `sourceType === "repo"` (not gated on `projectCfg` being truthy). Pass `createIgnoreFilter(projectCfg?.ignore)` to adapter config — builtins apply automatically via the function.

**Checkpoint**: Default exclusions work for all repo ingestions without any config file.

---

## Phase 4: User Story 2 — .wtfocignore File (Priority: P1)

**Goal**: Read `.wtfocignore` from the ingested repo root and merge patterns into the ignore filter.

**Independent Test**: Create a `.wtfocignore` file with `docs/internal/`, run ingestion, verify files under `docs/internal/` are excluded.

### Architecture Note

The repo path is resolved inside `adapter.ingest()` via `acquireRepo`. Rather than exposing the repo path to the CLI layer, `.wtfocignore` loading happens inside the repo adapter itself — after `acquireRepo` resolves the path, the adapter reads `.wtfocignore` from the repo root and merges those patterns into the existing `ignoreFilter`. This keeps the adapter self-contained (FR-008: works for both local and cloned repos).

### Implementation for User Story 2

- [ ] T005 [P] [US2] Implement `loadWtfocIgnore(repoRoot: string): string[]` in `packages/config/src/ignore.ts` — read `.wtfocignore` from given directory, strip comment lines (`#`) and blank lines, return array of patterns. Return empty array if file not found.
- [ ] T006 [P] [US2] Export `loadWtfocIgnore` from `packages/config/src/index.ts`
- [ ] T007 [P] [US2] Add tests for `loadWtfocIgnore` in `packages/config/src/ignore.test.ts`: file not found returns `[]`, file with patterns/comments/blanks returns correct array, file with only comments returns `[]`
- [ ] T008 [US2] Update `packages/ingest/src/adapters/repo/adapter.ts` in the `ingest()` method: after `acquireRepo` resolves `repoPath`, call `loadWtfocIgnore(repoPath)`. If patterns found, create a new merged ignore filter by calling `createIgnoreFilter(wtfocIgnorePatterns)` and compose it with the existing `ignoreFilter` (both must pass for a file to be included). Log when `.wtfocignore` is detected with pattern count (FR-009).
- [ ] T009 [US2] Verify `pnpm build` and `pnpm test` pass

**Checkpoint**: `.wtfocignore` file is read and applied during repo ingestion for both local and cloned repos.

---

## Phase 5: User Story 3 — CLI --ignore Flag (Priority: P2)

**Goal**: Support `--ignore <pattern>` CLI flag for ad-hoc exclusions.

**Independent Test**: Run `wtfoc ingest repo . --ignore "*.test.*"` and verify test files are excluded.

### Implementation for User Story 3

- [ ] T010 [US3] Add `--ignore <pattern...>` option to the ingest command in `packages/cli/src/commands/ingest.ts` (repeatable flag using commander's `.option("--ignore <pattern...>")`). Pass CLI ignore patterns as an additional source to `createIgnoreFilter` alongside `.wtfoc.json` patterns.
- [ ] T011 [US3] Verify `pnpm build` and `pnpm test` pass

**Checkpoint**: `--ignore` CLI flag works for ad-hoc pattern exclusion.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T012 [P] Add integration test in `packages/config/src/ignore.test.ts` verifying `createIgnoreFilter` with multiple pattern source arrays merges them all additively (builtins + source1 + source2 + source3), and that negation patterns in later sources can re-include files excluded by earlier sources
- [ ] T013 Run `pnpm lint:fix` across all modified packages
- [ ] T014 Run full `pnpm test` from root to verify no regressions
- [ ] T015 Run `pnpm build` to verify clean compilation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies — can start immediately
- **US1 (Phase 3)**: Depends on Phase 2 (expanded defaults + variadic signature)
- **US2 (Phase 4)**: Depends on Phase 3 (always-applied filter)
- **US3 (Phase 5)**: Depends on Phase 2 (variadic signature available)
- **Polish (Phase 6)**: Depends on all user stories complete

### Parallel Opportunities

- T001 and T002 can run in parallel (different files)
- T005, T006, T007 can run in parallel (different files)
- US1 and US3 could run in parallel after Phase 2 (independent changes)

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 2: Expand built-in defaults + variadic signature
2. Phase 3: Always apply ignore filter (US1)
3. Phase 4: .wtfocignore file support in adapter (US2)
4. **STOP and VALIDATE**: Sensible defaults + .wtfocignore working

### Full Feature

5. Phase 5: --ignore CLI flag (US3)
6. Phase 6: Polish + integration tests

---

## Notes

- This is a small, focused feature (~50 lines net new code)
- All changes are in existing files — no new packages or files needed
- The `ignore` npm package handles all gitignore semantics (negation, comments, globs)
- Architecture fix: `.wtfocignore` loading happens inside the repo adapter after `acquireRepo`, solving the repo-path-access problem for both local and cloned repos
