# Tasks: Edge Extraction Beyond Regex

**Input**: Design documents from `/specs/117-edge-extraction-pipeline/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US5)
- Exact file paths included in descriptions

## User Story Mapping

| ID | Story | Priority | Title |
|----|-------|----------|-------|
| US1 | Story 4 | P1 | Composable Extraction Pipeline |
| US2 | Story 1 | P1 | Heuristic Link Detection |
| US3 | Story 2 | P2 | Code-Aware Import/Dependency Edges |
| US4 | Story 3 | P3 | LLM-Powered Semantic Extraction |
| US5 | Story 5 | P3 | LLM Extractor Configuration |

Note: US1 (pipeline) and US2 (heuristic) are both P1 but pipeline is foundational — it must ship first.

---

## Phase 1: Setup

**Purpose**: Project initialization and dependency setup

- [x] T001 Add `provenance?: string[]` optional field to Edge schema in `packages/common/src/schemas/edge.ts`
- [ ] T002 [P] Add `web-tree-sitter` and grammar packages to `packages/ingest/package.json` dependencies
- [x] T003 [P] Create `packages/ingest/src/edges/merge.ts` module skeleton (empty exports for EdgeKey, mergeEdges, deduplicateEdges)

---

## Phase 2: Foundational — Async Interface Migration

**Purpose**: Breaking change from sync → async. MUST complete before any user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Change `EdgeExtractor` interface to async in `packages/common/src/interfaces/edge-extractor.ts`: `extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]>`
- [x] T005 Change `SourceAdapter.extractEdges()` to async in `packages/common/src/interfaces/source-adapter.ts`: `extractEdges(chunks: Chunk[]): Promise<Edge[]>`
- [x] T006 [P] Update `RegexEdgeExtractor` to return `Promise<Edge[]>` in `packages/ingest/src/edges/extractor.ts`
- [x] T007 [P] Update `RegexEdgeExtractor` tests for async in `packages/ingest/src/edges/extractor.test.ts`
- [x] T008 [P] Update GitHub adapter `extractEdges` to async in `packages/ingest/src/adapters/github/adapter.ts`
- [x] T009 [P] Update repo adapter `extractEdges` to async in `packages/ingest/src/adapters/repo/adapter.ts`
- [x] T010 [P] Update Slack adapter `extractEdges` to async in `packages/ingest/src/adapters/slack.ts`
- [x] T011 [P] Update Discord adapter `extractEdges` to async in `packages/ingest/src/adapters/discord.ts`
- [x] T012 [P] Update HackerNews adapter `extractEdges` to async in `packages/ingest/src/adapters/hackernews.ts`
- [x] T013 [P] Update Website adapter `extractEdges` to async in `packages/ingest/src/adapters/website.ts`
- [x] T014 Update CLI ingest `flushBatch` to await async extractEdges in `packages/cli/src/commands/ingest.ts`
- [x] T015 [P] Update MCP ingest `flushBatch` to await async extractEdges in `packages/mcp-server/src/tools/ingest.ts`
- [x] T016 [P] Update e2e pipeline tests for async extract in `packages/store/src/e2e-pipeline.test.ts`
- [x] T017 [P] Update adapter tests for async: `packages/ingest/src/adapters/github.test.ts`, `slack.test.ts`, `discord.test.ts`, `hackernews.test.ts`, `repo.test.ts`
- [x] T018 [P] Update `packages/ingest/README.md` code example for async extractor
- [ ] T019 Wire AbortSignal from CLI ingest command through to `edgeExtractor.extract()` call in `packages/cli/src/commands/ingest.ts`
- [x] T020 Run `pnpm lint:fix` and `pnpm test` to verify all tests pass after async migration
- [ ] T021 Add CHANGELOG entry for breaking `EdgeExtractor` and `SourceAdapter` interface changes

**Checkpoint**: All existing tests pass with async interfaces. No behavior changes — same edges, same confidence, same output.

---

## Phase 3: User Story 1 — Composable Extraction Pipeline (Priority: P1) 🎯 MVP

**Goal**: Composite orchestrator that runs multiple extractors, merges results, deduplicates by canonical key, calibrates confidence, and tracks provenance.

**Independent Test**: Run composite with regex extractor only → output identical to current regex-only path. Run composite with regex + mock extractor → verify dedup, confidence boost, provenance tracking.

### Implementation

- [x] T022 [US1] Implement edge dedup/merge logic in `packages/ingest/src/edges/merge.ts`: canonical key via `JSON.stringify([type, sourceId, targetType, targetId])`, evidence merging, confidence boost (+0.05 per agreeing extractor, capped at 1.0), provenance tracking
- [x] T023 [US1] Write tests for merge logic in `packages/ingest/src/edges/merge.test.ts`: same-key dedup, evidence merge, confidence boost, provenance set, N-way convergence
- [x] T024 [US1] Implement `CompositeEdgeExtractor` in `packages/ingest/src/edges/composite.ts`: register extractors, run all in parallel, merge results via merge.ts, respect AbortSignal, cap edges per chunk (max 100)
- [x] T025 [US1] Write tests for composite in `packages/ingest/src/edges/composite.test.ts`: single extractor pass-through, multi-extractor merge, disabled extractor skipped, abort signal respected, edge cap enforced
- [x] T026 [US1] Wire `CompositeEdgeExtractor` into CLI ingest replacing direct `RegexEdgeExtractor` usage in `packages/cli/src/commands/ingest.ts`
- [ ] T027 [US1] Wire `CompositeEdgeExtractor` into MCP ingest in `packages/mcp-server/src/tools/ingest.ts`
- [ ] T028 [US1] Update adapter migration: Slack, Discord, HackerNews, Website adapters return `[]` from `extractEdges()` (composite handles their patterns now). GitHub and Repo adapters keep source-specific edges only (changed-file edges).
- [x] T029 [US1] Export `CompositeEdgeExtractor` and merge utilities from `packages/ingest/src/index.ts`
- [x] T030 [US1] Run full test suite to verify no regressions after composite wiring

**Checkpoint**: Ingest pipeline uses CompositeEdgeExtractor with RegexEdgeExtractor as sole registered extractor. Output identical to pre-migration. Provenance field populated on edges.

---

## Phase 4: User Story 2 — Heuristic Link Detection (Priority: P1)

**Goal**: Detect Slack message permalinks, Jira ticket keys, and markdown hyperlinks without any external services.

**Independent Test**: Ingest Slack messages and markdown files containing Jira tickets and hyperlinks → verify edges appear with confidence 0.8-0.9 and correct targetType.

### Implementation

- [x] T031 [P] [US2] Implement `HeuristicEdgeExtractor` in `packages/ingest/src/edges/heuristic.ts`: Slack permalink pattern (`slack.com/archives/...`), Jira key pattern (`PROJ-123`), markdown hyperlink extraction (`[text](url)`), confidence 0.8-0.9
- [x] T032 [P] [US2] Write golden fixture tests in `packages/ingest/src/edges/heuristic.test.ts`: Slack permalink → references edge, Jira key → references edge with targetType "jira-ticket", markdown link → references edge, mixed content with GitHub refs (no duplication with regex), edge cases (false positive Jira-like patterns)
- [x] T033 [US2] Register `HeuristicEdgeExtractor` in default `CompositeEdgeExtractor` pipeline in `packages/cli/src/commands/ingest.ts` and `packages/mcp-server/src/tools/ingest.ts`
- [x] T034 [US2] Export `HeuristicEdgeExtractor` from `packages/ingest/src/index.ts`
- [x] T035 [US2] Run full test suite to verify heuristic edges appear alongside regex edges without duplication

**Checkpoint**: Ingesting Slack/Jira/markdown content produces heuristic edges merged with regex edges. Dedup verified.

---

## Phase 5: User Story 3 — Code-Aware Import/Dependency Edges (Priority: P2)

**Goal**: Tree-sitter-based import and dependency detection for TypeScript, JavaScript, and Python source code.

**Independent Test**: Ingest a repo with known import relationships → verify `imports` and `depends-on` edges with confidence 0.95-1.0.

### Implementation

- [ ] T036 [US3] Configure `web-tree-sitter` WASM loading for Node.js in `packages/ingest/src/edges/tree-sitter-loader.ts`: lazy grammar loading, WASM file path resolution from bundled npm package
- [ ] T037 [P] [US3] Implement `TreeSitterEdgeExtractor` in `packages/ingest/src/edges/tree-sitter.ts`: parse TS/JS import statements, parse Python import/from statements, produce `imports` edges with confidence 0.95-1.0, skip unsupported languages gracefully
- [ ] T038 [P] [US3] Implement dependency manifest parser in `packages/ingest/src/edges/dependency-parser.ts`: parse `package.json` dependencies (JSON parser), parse `requirements.txt` (line parser), produce `depends-on` edges with confidence 1.0
- [ ] T039 [P] [US3] Write tests for tree-sitter extractor in `packages/ingest/src/edges/tree-sitter.test.ts`: TS import → imports edge, Python from-import → imports edge, unsupported language → graceful skip, multiline imports
- [ ] T040 [P] [US3] Write tests for dependency parser in `packages/ingest/src/edges/dependency-parser.test.ts`: package.json deps → depends-on edges, requirements.txt → depends-on edges
- [ ] T041 [US3] Register `TreeSitterEdgeExtractor` in composite pipeline for `sourceType: "code"` chunks in `packages/cli/src/commands/ingest.ts`
- [ ] T042 [US3] Export `TreeSitterEdgeExtractor` from `packages/ingest/src/index.ts`
- [ ] T043 [US3] Run full test suite including e2e pipeline tests

**Checkpoint**: Repo ingest produces import and dependency edges alongside regex and heuristic edges.

---

## Phase 6: User Story 4 — LLM-Powered Semantic Extraction (Priority: P3)

**Goal**: Optional LLM-based edge extraction via any OpenAI-compatible endpoint. Fail-open, non-blocking, incremental, re-runnable.

**Independent Test**: Configure LLM endpoint → run `wtfoc extract-edges` → verify semantic edges appear in overlay file. Disconnect LLM → verify ingest succeeds with deterministic edges only.

### Implementation

- [ ] T044 [US4] Implement OpenAI-compatible chat completion client in `packages/ingest/src/edges/llm-client.ts`: raw fetch to `/chat/completions`, JSON mode with three-tier fallback (constrained → plain → fenced block repair), timeout, AbortSignal
- [ ] T045 [P] [US4] Implement extraction prompt template in `packages/ingest/src/edges/llm-prompt.ts`: system prompt with ontology and rules, 2-4 few-shot examples spanning source types, source-type-aware extraction rules, temperature 0
- [ ] T046 [US4] Implement `LlmEdgeExtractor` in `packages/ingest/src/edges/llm.ts`: call LLM client with prompt, parse response into Edge objects, reject edges with empty evidence, assign confidence 0.3-0.8 based on evidence quality, fail-open (return [] on any error), respect AbortSignal, rate limiting with semaphore (maxConcurrency)
- [ ] T047 [US4] Implement artifact-context batching in `packages/ingest/src/edges/llm-batcher.ts`: group chunks by artifact context (PR+comments, Slack thread, code file), compute contextId and contextHash, respect 2k-6k token budget per batch
- [ ] T048 [US4] Implement incremental extraction status tracking in `packages/ingest/src/edges/extraction-status.ts`: read/write `.extraction-status.json`, per-context status (pending/completed/failed), model change detection (re-run all if model differs), atomic writes (temp + rename)
- [ ] T049 [US4] Implement overlay edge store in `packages/ingest/src/edges/overlay-store.ts`: read/write `edges-overlay.json`, merge new edges with existing via canonical dedup, atomic writes
- [ ] T050 [P] [US4] Write tests for LLM client in `packages/ingest/src/edges/llm-client.test.ts`: successful JSON response, fenced block fallback, timeout handling, AbortSignal
- [ ] T051 [P] [US4] Write tests for LlmEdgeExtractor in `packages/ingest/src/edges/llm.test.ts`: mock LLM responses → edge output, empty evidence rejection, fail-open on error, confidence assignment
- [ ] T052 [P] [US4] Write tests for extraction status in `packages/ingest/src/edges/extraction-status.test.ts`: read/write status, skip completed, retry failed, model change invalidation, context hash change
- [ ] T053 [P] [US4] Write tests for overlay store in `packages/ingest/src/edges/overlay-store.test.ts`: read/write/merge overlay edges, canonical dedup
- [ ] T054 [US4] Integrate overlay edge loading into `mountCollection` in `packages/search/src/mount.ts`: load overlay edges at mount time, merge into segment edges
- [ ] T055 [US4] Export LLM extractor components from `packages/ingest/src/index.ts`

**Checkpoint**: LLM extraction works end-to-end with local LM Studio. Overlay edges merge at mount time. Re-run picks up where it left off.

---

## Phase 7: User Story 5 — LLM Extractor Configuration (Priority: P3)

**Goal**: Separate config from embedder. CLI flags, env vars, .wtfoc.json support. Standalone `extract-edges` command.

**Independent Test**: Provide different config sources (CLI, env, file) → verify extractor uses correct values. Misconfiguration → clear error.

### Implementation

- [ ] T056 [US5] Implement config resolver in `packages/cli/src/extractor-config.ts`: discriminated union (disabled | enabled), precedence: CLI > .wtfoc.json > env > defaults, validation (url required when enabled, model required when enabled)
- [ ] T057 [US5] Add `withExtractorOptions()` CLI flag helper in `packages/cli/src/helpers.ts`: `--extractor-url`, `--extractor-model`, `--extractor-key`, `--extractor-enabled`, `--extractor-json-mode`, `--extractor-timeout`, `--extractor-concurrency`
- [ ] T058 [US5] Wire extractor config into ingest command in `packages/cli/src/commands/ingest.ts`: resolve config, register LlmEdgeExtractor in composite if enabled, pass config to LLM client
- [ ] T059 [US5] Implement `wtfoc extract-edges` standalone command in `packages/cli/src/commands/extract-edges.ts`: load collection, resolve extractor config, run LlmEdgeExtractor incrementally, write overlay edges
- [ ] T060 [US5] Register `extract-edges` command in CLI entry point `packages/cli/src/cli.ts`
- [ ] T061 [P] [US5] Write tests for config resolver in `packages/cli/src/extractor-config.test.ts`: CLI override, env fallback, file config, disabled default, validation errors
- [ ] T062 [US5] Wire extractor config into MCP ingest in `packages/mcp-server/src/tools/ingest.ts`

**Checkpoint**: `wtfoc extract-edges --extractor-url http://localhost:1234/v1 --extractor-model qwen...` works end-to-end. Config from all sources.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T063 [P] Update `packages/ingest/README.md` with composite extractor usage examples
- [ ] T064 Run `pnpm lint:fix` across all modified packages
- [ ] T065 Run full test suite (`pnpm test`) and fix any failures
- [ ] T066 Validate quickstart.md scenarios end-to-end
- [ ] T067 Update SPEC.md if EdgeExtractor interface description needs amendment

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 Pipeline (Phase 3)**: Depends on Phase 2 — BLOCKS US2-US5 (composite is prerequisite)
- **US2 Heuristic (Phase 4)**: Depends on Phase 3 (needs composite to register into)
- **US3 Tree-sitter (Phase 5)**: Depends on Phase 3 (needs composite). Can run in parallel with US2.
- **US4 LLM (Phase 6)**: Depends on Phase 3. Can run in parallel with US2/US3.
- **US5 Config (Phase 7)**: Depends on Phase 6 (needs LlmEdgeExtractor to configure)
- **Polish (Phase 8)**: Depends on all desired stories being complete

### Parallel Opportunities

```
Phase 1 (Setup)
  ↓
Phase 2 (Async Migration) — T006-T018 all [P]
  ↓
Phase 3 (US1: Composite Pipeline)
  ↓
┌──────────────────┬──────────────────┬──────────────────┐
│ Phase 4 (US2)    │ Phase 5 (US3)    │ Phase 6 (US4)    │
│ Heuristic        │ Tree-sitter      │ LLM Extraction   │
│ (can parallel)   │ (can parallel)   │ (can parallel)   │
└──────────────────┴──────────────────┴──────────────────┘
                          ↓
                   Phase 7 (US5: Config) — depends on US4
                          ↓
                   Phase 8 (Polish)
```

### Within Each User Story

- Tests and implementation can be developed together (test files are [P])
- Models/utilities before integration
- Integration before pipeline wiring
- Run full test suite at each checkpoint

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + 3 Only)

1. Complete Phase 1: Setup (provenance field, deps)
2. Complete Phase 2: Async migration (mechanical, all tests pass)
3. Complete Phase 3: Composite pipeline with regex only
4. **STOP and VALIDATE**: Ingest produces identical output to pre-migration
5. Deploy/demo — foundation ready for all extractors

### Incremental Delivery

1. Setup + Async Migration + Composite → Foundation ready (MVP)
2. Add Heuristic Extractor → Slack/Jira/markdown edges (immediate user value)
3. Add Tree-sitter → Code import/dependency edges (repo intelligence)
4. Add LLM Extractor + Config → Semantic edges via local model (full pipeline)
5. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story
- Constitution requires test-first where practical (Phase VI)
- Run `pnpm lint:fix` (never manually fix auto-fixable lint issues)
- Commit after each task or logical group per atomic commits rule
- Stop at any checkpoint to validate independently
