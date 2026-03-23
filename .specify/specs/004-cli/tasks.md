# Tasks: CLI

**Input**: Design documents from `/specs/004-cli/`

## Phase 1: CLI Framework (US1)

- [ ] T001 [US1] Create `packages/cli/src/cli.ts` — Commander setup with global flags (--json, --quiet, --collection)
- [ ] T002 [P] [US1] Create `packages/cli/src/output.ts` — output formatter (human table / JSON / quiet modes), stderr for logs, stdout for data
- [ ] T003 [US1] Create `packages/cli/src/commands/init.ts` — `wtfoc init <name> [--local|--foc]`, creates project config + store
- [ ] T004 [P] [US1] Test init command: creates project, --local uses local backend, --foc validates config

## Phase 2: Ingest Command (US2)

- [ ] T005 [US2] Create `packages/cli/src/commands/ingest.ts` — `wtfoc ingest <source-type> [args]`, discovers adapters, runs ingest pipeline, stores segment, updates manifest
- [ ] T006 [P] [US2] Test ingest: slack source recognized, github source recognized, unknown source → helpful error
- [ ] T007 [US2] Wire ingest to source adapters from @wtfoc/ingest + embedder from @wtfoc/search + store from @wtfoc/store

## Phase 3: Trace + Query Commands (US1)

- [ ] T008 [US1] Create `packages/cli/src/commands/trace.ts` — `wtfoc trace <query>`, formats grouped output with edge annotations
- [ ] T009 [P] [US1] Create `packages/cli/src/commands/query.ts` — `wtfoc query <query>`, formats ranked results
- [ ] T010 [P] [US1] Test trace and query output formatting (human + JSON modes)

## Phase 4: Verify + Status + Doctor (US3)

- [ ] T011 [US3] Create `packages/cli/src/commands/verify.ts` — `wtfoc verify <id>`
- [ ] T012 [P] [US3] Create `packages/cli/src/commands/status.ts` — `wtfoc status`
- [ ] T013 [P] [US3] Create `packages/cli/src/commands/doctor.ts` — health check
- [ ] T014 [P] [US3] Test all three commands

## Phase 5: Polish

- [ ] T015 [P] packages/cli/README.md
- [ ] T016 [P] Ensure pnpm test and pnpm lint pass
