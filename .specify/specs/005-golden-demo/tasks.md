# Tasks: Golden Demo

**Input**: Design documents from `/specs/005-golden-demo/`

## Phase 1: Golden Dataset (US1)

- [ ] T001 [US1] Create `fixtures/golden-incident/slack-export.json` — synthetic Slack messages about "upload failures", referencing #142, containing URLs
- [ ] T002 [P] [US1] Create `fixtures/golden-incident/github-issues.json` — synthetic gh CLI output with issue #142 "Upload timeout on large files"
- [ ] T003 [P] [US1] Create `fixtures/golden-incident/github-prs.json` — synthetic gh CLI output with PR #156 "Fix upload retry logic", closing #142, with changed files + commit SHAs
- [ ] T004 [P] [US1] Create `fixtures/golden-incident/code-snippet.ts` — synthetic code file representing the changed file from PR #156

## Phase 2: Demo Smoke (US2)

- [ ] T005 [US2] Create `scripts/demo-smoke.sh` — ingests golden dataset with `wtfoc ingest`, runs `wtfoc trace "upload failures"`, asserts output contains expected hops (Slack, Issue, PR, Code)
- [ ] T006 [P] [US2] Create `packages/cli/src/commands/demo-smoke.ts` — programmatic version that exits 0/1

## Phase 3: Demo Script (US3)

- [ ] T007 [US3] Create `scripts/demo.sh` — full formatted demo flow suitable for 2-minute recording
- [ ] T008 [P] [US3] Ensure demo completes in under 2 minutes with local storage

## Dependencies

- Depends on ALL other specs being implemented (ingest, search, cli)
- Should be the last spec implemented
