# Tasks: Real Data Demo

**Input**: Design documents from `.specify/specs/014-real-data-demo/`

## Phase 1: CLI Wiring

- [x] T001 Add `github` source type to CLI ingest command in `packages/cli/src/cli.ts` — instantiate `GitHubAdapter`, parse config from args, run ingest, embed, build segment, store, update head
- [x] T002 Handle `--since` flag for github source type, converting duration (e.g., "90d") to ISO 8601 date in `packages/cli/src/cli.ts`

## Phase 2: Demo Script

- [x] T003 Create `scripts/demo.sh` that ingests 7 FOC repos into `foc-demo` collection with `--since 90d`
- [x] T004 Add demo trace/query commands to `scripts/demo.sh` showing cross-repo results
- [x] T005 Add `wtfoc status` output to demo script showing collection stats

## Phase 3: Polish

- [x] T006 Run `pnpm lint:fix`
- [x] T007 Run `pnpm -r build`
- [x] T008 Run `pnpm test`
