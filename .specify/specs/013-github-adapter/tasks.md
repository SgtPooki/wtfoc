# Tasks: GitHub Adapter

**Input**: Design documents from `.specify/specs/013-github-adapter/`
**Prerequisites**: plan.md, spec.md, research.md

**Tests**: Required — mocked gh CLI output for all adapter behavior.

**Organization**: Tasks grouped by user story.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Foundational

**Purpose**: Core adapter infrastructure — gh api wrapper, rate limit handling, config parsing.

- [ ] T001 Create `GitHubAdapter` class implementing `SourceAdapter` with `parseConfig()` and config types (`owner`, `repo`, `since?`, `types?`) in `packages/ingest/src/adapters/github.ts`
- [ ] T002 Implement injectable `ghApi()` helper that invokes `gh api` via an `execFn` parameter (defaults to `execFile`, injectable for tests). Parses JSON output, detects rate limit errors from stderr, supports `AbortSignal` cancellation in `packages/ingest/src/adapters/github.ts`
- [ ] T003 Implement rate limit retry wrapper: use `Retry-After` or `x-ratelimit-reset` when available, fallback to exponential backoff (5s base), max total wait 5 minutes, throw `GitHubRateLimitError` on exhaustion, respect AbortSignal during wait in `packages/ingest/src/adapters/github.ts`
- [ ] T004 [P] Add typed error classes in `packages/common/src/errors.ts`: `GitHubRateLimitError` (code: `GITHUB_RATE_LIMIT`), `GitHubNotFoundError` (code: `GITHUB_NOT_FOUND`), `GitHubCliMissingError` (code: `GITHUB_CLI_MISSING`), `GitHubApiError` (code: `GITHUB_API_ERROR`)
- [ ] T005 [P] Export `GitHubAdapter` from `packages/ingest/src/index.ts`

**Checkpoint**: Core gh api wrapper with rate limit retry is testable.

---

## Phase 2: User Story 1 — Ingest issues and PRs (Priority: P1) MVP

**Goal**: Fetch issues and PRs, produce typed chunks with cross-reference edges.

- [ ] T006 [P] [US1] Add tests for issue ingestion: mock gh api output, verify chunks have sourceType "github-issue", correct source identifier `{owner}/{repo}#N`, and metadata (number, state, labels, author) in `packages/ingest/src/adapters/github.test.ts`
- [ ] T007 [P] [US1] Add tests for PR ingestion: mock gh api output, verify chunks have sourceType "github-pr" with PR-specific metadata in `packages/ingest/src/adapters/github.test.ts`
- [ ] T008 [P] [US1] Add tests for cross-reference edge extraction from issue/PR bodies in `packages/ingest/src/adapters/github.test.ts`
- [ ] T008a [P] [US1] Add test for issue/PR dedup: mock issues endpoint returning items with `pull_request` field, verify they are filtered out in `packages/ingest/src/adapters/github.test.ts`
- [ ] T008b [P] [US1] Add test for pagination: mock multi-page gh api output, verify all pages are consumed without data loss in `packages/ingest/src/adapters/github.test.ts`
- [ ] T008c [P] [US1] Add test for metadata encoding: verify labels are comma-separated strings, merged is "true"/"false" in `packages/ingest/src/adapters/github.test.ts`
- [ ] T009 [US1] Implement `ingest()` method: fetch issues via `gh api repos/{owner}/{repo}/issues --paginate` (filter out PRs by checking `pull_request` field), parse each into Chunk with title+body content, set sourceType/source/metadata in `packages/ingest/src/adapters/github.ts`
- [ ] T010 [US1] Implement PR fetching via separate `gh api repos/{owner}/{repo}/pulls --paginate` endpoint, produce "github-pr" chunks (no overlap with issue chunks) in `packages/ingest/src/adapters/github.ts`
- [ ] T011 [US1] Implement `extractEdges()`: use `RegexEdgeExtractor` plus resolve `{owner}/{repo}#N` targets against chunk sources in `packages/ingest/src/adapters/github.ts`
- [ ] T012 [US1] Implement `--since` filtering: add `since` query param to gh api calls, skip items older than the threshold in `packages/ingest/src/adapters/github.ts`

**Checkpoint**: US1 complete — issues and PRs ingested with edges.

---

## Phase 3: User Story 2 — Ingest PR review comments (Priority: P1)

- [ ] T013 [P] [US2] Add tests for PR comment ingestion: mock gh api output, verify chunks have sourceType "github-pr-comment" linked to parent PR in `packages/ingest/src/adapters/github.test.ts`
- [ ] T014 [US2] Implement PR comment fetching: `gh api repos/{owner}/{repo}/pulls/{n}/comments --paginate`, produce "github-pr-comment" chunks. Comment chunk `source` must use `{owner}/{repo}#N` format (same as parent PR) so RegexEdgeExtractor can resolve bare `#N` references. Parent PR number stored in metadata. In `packages/ingest/src/adapters/github.ts`

**Checkpoint**: US2 complete — PR comments ingested.

---

## Phase 4: User Story 3 — Ingest discussions (Priority: P2)

- [ ] T015 [P] [US3] Add tests for discussion ingestion and graceful skip when discussions not enabled in `packages/ingest/src/adapters/github.test.ts`
- [ ] T016 [US3] Implement discussion fetching via GraphQL: `gh api graphql` with discussions query, produce "github-discussion" chunks, skip gracefully if not enabled in `packages/ingest/src/adapters/github.ts`

**Checkpoint**: US3 complete — discussions ingested when available.

---

## Phase 5: User Story 4 — Rate limit handling (Priority: P1)

- [ ] T017 [P] [US4] Add tests for rate limit detection: Retry-After header based wait, x-ratelimit-reset based wait, fallback exponential backoff, max 5min exhaustion error, and AbortSignal cancellation during backoff in `packages/ingest/src/adapters/github.test.ts`
- [ ] T018 [US4] Add tests for edge cases: repo not found (`GitHubNotFoundError`), gh not installed (`GitHubCliMissingError`), empty body skip, malformed JSON (`GitHubApiError`), auth failure vs not-found distinction in `packages/ingest/src/adapters/github.test.ts`

**Checkpoint**: US4 complete — rate limits handled, edge cases covered.

---

## Phase 6: Polish

- [ ] T019 Wire `GitHubAdapter` into CLI ingest command as `github` source type in `packages/cli/src/cli.ts`
- [ ] T020 Run `pnpm lint:fix` across changed files
- [ ] T021 Run `pnpm -r build` and verify all packages build
- [ ] T022 Run `pnpm test` and verify all tests pass

---

## Dependencies & Execution Order

- **Phase 1**: No dependencies — start immediately
- **Phase 2 (US1)**: Depends on Phase 1 (ghApi wrapper + config)
- **Phase 3 (US2)**: Depends on Phase 2 (needs PR fetching to link comments)
- **Phase 4 (US3)**: Depends on Phase 1 only. Can run in parallel with US1/US2.
- **Phase 5 (US4)**: Depends on Phase 1 (tests the retry wrapper). Can run in parallel with US1.
- **Phase 6**: Depends on all previous phases.

## Implementation Strategy

### MVP First (US1 + US4)

1. Phase 1: Core wrapper + rate limit retry
2. Phase 2: Issues + PRs
3. Phase 5: Rate limit tests
4. **STOP**: Working GitHub adapter with issues/PRs and rate limits

### Full Delivery

5. Phase 3: PR comments
6. Phase 4: Discussions
7. Phase 6: CLI integration + polish
