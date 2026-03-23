# Tasks: Ingest Pipeline

**Input**: Design documents from `/specs/002-ingest-pipeline/`

## Phase 1: Chunker (US1)

- [ ] T001 [US1] Create `packages/ingest/src/chunker.ts` with `chunkMarkdown(text, source, options?)` and `chunkText(text, source, options?)` functions. Markdown-aware splitting: headers > paragraphs > sentences > chars. Chunk ID = SHA-256 of content.
- [ ] T002 [P] [US1] Create `packages/ingest/src/chunker.test.ts`: deterministic IDs, header-boundary splitting, configurable size/overlap, empty input handling.

**Checkpoint**: Chunking works independently

---

## Phase 2: Edge Extraction (US2, US3)

- [ ] T003 [US2] Create `packages/ingest/src/edges/extractor.ts` implementing `EdgeExtractor` — regex-based extraction of `#123`, `owner/repo#456`, GitHub URLs, "Closes/Fixes #N" keywords.
- [ ] T004 [P] [US2] Create `packages/ingest/src/edges/extractor.test.ts`: references from `#123`, `owner/repo#456`, URLs; closes from "Closes #N", "Fixes #N"; confidence = 1.0 for all regex matches.
- [ ] T005 [US3] Add PR changed-files edge extraction: `type: 'changes'`, `targetType: 'file'`, `targetId` with repo + path + commitSha.
- [ ] T006 [P] [US3] Test changed-files edge extraction with mock PR data.

**Checkpoint**: Edge extraction works on raw text

---

## Phase 3: Slack Adapter (US2)

- [ ] T007 [US2] Create `packages/ingest/src/adapters/slack.ts` implementing `SourceAdapter` — parses Slack workspace export JSON format, produces chunks with `sourceType: 'slack-message'`, handles threads.
- [ ] T008 [P] [US2] Create `packages/ingest/src/adapters/slack.test.ts` with fixture JSON: messages → chunks, threads grouped, edge extraction from message text, empty export → no error.
- [ ] T009 [P] [US2] Create `fixtures/slack-export-sample.json` — synthetic Slack export with messages containing `#issue` refs and URLs (no real customer data).

**Checkpoint**: Slack ingest works with export files

---

## Phase 4: GitHub Adapter (US3)

- [ ] T010 [US3] Create `packages/ingest/src/adapters/github.ts` implementing `SourceAdapter` — uses `gh` CLI (via child_process) to fetch issues, PRs, and PR changed files. Produces typed chunks with sourceUrl.
- [ ] T011 [P] [US3] Create `packages/ingest/src/adapters/github.test.ts` with mocked `gh` CLI output: issues → chunks, PRs → chunks + closing edges + changed-file edges with commit anchors.
- [ ] T012 [P] [US3] Create `fixtures/github-issues-sample.json` and `fixtures/github-prs-sample.json` — synthetic gh CLI output.

**Checkpoint**: GitHub ingest works with mocked CLI

---

## Phase 5: Segment Builder (US4)

- [ ] T013 [US4] Create `packages/ingest/src/segment-builder.ts` — takes chunks[] + edges[] + embedding metadata, produces a `Segment` object with schemaVersion.
- [ ] T014 [P] [US4] Create `packages/ingest/src/segment-builder.test.ts`: multi-source segment, schema fields preserved, empty chunks/edges handled.

**Checkpoint**: Full ingest pipeline: source → chunks → edges → segment

---

## Phase 6: Public API + Exports (US5)

- [ ] T015 [US5] Update `packages/ingest/src/index.ts` — export chunker, edge extractor, adapters, segment builder.
- [ ] T016 [P] [US5] Create `packages/ingest/README.md` with usage examples.
- [ ] T017 [P] Ensure `pnpm test` and `pnpm lint` pass from root.

---

## Dependencies

- **Phase 1 (Chunker)**: No dependencies — start immediately
- **Phase 2 (Edges)**: No dependencies — can parallel with Phase 1
- **Phase 3 (Slack)**: Depends on Phase 1 (chunker) + Phase 2 (edges)
- **Phase 4 (GitHub)**: Depends on Phase 1 + Phase 2
- **Phase 5 (Segment)**: Depends on Phase 1 + Phase 2
- **Phase 6 (API)**: Depends on all above

### Parallel Opportunities

- Phase 1 and Phase 2 can run in parallel (different files)
- T008/T009 (Slack tests/fixtures) can run in parallel
- T010/T011/T012 (GitHub impl/tests/fixtures) have parallel test+fixture tasks
- Phase 3 and Phase 4 can run in parallel after Phases 1+2
