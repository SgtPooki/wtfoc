# Tasks: Theme Clustering

**Input**: Design documents from `/specs/015-theme-clustering/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/clusterer.ts

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Interface definition and shared types

- [ ] T001 Define `Clusterer` interface and types (`ClusterRequest`, `ClusterResult`, `Cluster`, `ClusterOptions`, `ClusterState`) in packages/common/src/interfaces/clusterer.ts
- [ ] T002 Export `Clusterer` and related types from packages/common/src/index.ts
- [ ] T003 Update SPEC.md to list `Clusterer` as the 8th pluggable seam
- [ ] T004 Update .specify/memory/constitution.md to add `Clusterer` to seam list in Principle I

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cluster state persistence and cosine similarity utilities that all stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Create cosine similarity utility with pre-normalization and top-k heap in packages/search/src/clustering/cosine.ts
- [ ] T006 [P] Create cluster state read/write module (load/save JSON from `~/.wtfoc/clusters/{collection}/state.json`) in packages/search/src/clustering/cluster-state.ts
- [ ] T007 [P] Create cluster label extraction utility (first meaningful words from exemplar text, stop-word filtered) in packages/search/src/clustering/labels.ts
- [ ] T008 Create packages/search/src/clustering/index.ts re-exporting all clustering modules
- [ ] T009 Export clustering modules from packages/search/src/index.ts
- [ ] T010 [P] Write tests for cosine similarity utility in packages/search/src/clustering/cosine.test.ts
- [ ] T011 [P] Write tests for cluster state persistence in packages/search/src/clustering/cluster-state.test.ts
- [ ] T012 [P] Write tests for cluster label extraction in packages/search/src/clustering/labels.test.ts

**Checkpoint**: Foundation ready — Clusterer interface defined, utilities tested, state persistence working

---

## Phase 3: User Story 1 - Discover themes in a collection (Priority: P1) MVP

**Goal**: `wtfoc themes -c foc-ecosystem` outputs ranked theme clusters with exemplars, terms, source distribution, and signal aggregates.

**Independent Test**: Run the command against a collection with 100+ chunks and verify output contains clusters with representative content, source breakdowns, and signal summaries.

### Implementation for User Story 1

- [ ] T013 [US1] Implement `AnnClusterer` with batch mode (greedy threshold-based single-pass clustering) in packages/search/src/clustering/ann-clusterer.ts
- [ ] T014 [US1] Implement exemplar selection (3 closest to cluster centroid) in the AnnClusterer
- [ ] T015 [US1] Implement `enrichClusters()` — builds ThemeCluster output from ClusterResult + segment data (exemplar content, source distribution, signal aggregates, exemplar-text labels) in packages/search/src/clustering/enrich.ts
- [ ] T016 [US1] Create `registerThemesCommand()` in packages/cli/src/commands/themes.ts — loads collection via mountCollection, runs clusterer, enriches, outputs ranked clusters (top 20, largest first)
- [ ] T017 [US1] Register themes command in packages/cli/src/cli.ts
- [ ] T018 [US1] Write tests for AnnClusterer batch mode with synthetic fixtures in packages/search/src/clustering/ann-clusterer.test.ts
- [ ] T019 [US1] Write tests for cluster enrichment in packages/search/src/clustering/enrich.test.ts

**Checkpoint**: `wtfoc themes -c <collection>` works end-to-end with batch clustering

---

## Phase 4: User Story 2 - Filter themes by signal type (Priority: P2)

**Goal**: `wtfoc themes --signal pain -c foc-ecosystem` shows only clusters where pain is the highest-scoring signal type.

**Independent Test**: Run with `--signal pain` and verify all returned clusters have pain as their dominant signal.

### Implementation for User Story 2

- [ ] T020 [US2] Add `--signal <type>` flag to themes command in packages/cli/src/commands/themes.ts
- [ ] T021 [US2] Implement signal filtering in `enrichClusters()` — compute dominant signal per cluster, filter output in packages/search/src/clustering/enrich.ts
- [ ] T022 [US2] Add tests for signal-filtered clustering output in packages/search/src/clustering/enrich.test.ts

**Checkpoint**: Signal filtering works — `--signal pain` returns only pain-dominant clusters

---

## Phase 5: User Story 3 - Incremental cluster updates (Priority: P2)

**Goal**: After new ingestion, `wtfoc themes` assigns new chunks to existing clusters without full rebuild.

**Independent Test**: Ingest new content, run themes, verify new chunks appear in clusters without full cluster set changing.

### Implementation for User Story 3

- [ ] T023 [US3] Implement incremental `assign` mode in AnnClusterer — top-12 NN search, 2+ cluster agreement, 1.5x runner-up margin, new cluster formation for outliers in packages/search/src/clustering/ann-clusterer.ts
- [ ] T024 [US3] Wire incremental mode into themes command — detect new chunks by comparing collection chunk IDs vs clustered chunk IDs in cluster state, auto-select batch vs incremental in packages/cli/src/commands/themes.ts
- [ ] T025 [US3] Add `--rebuild` flag to force batch mode in packages/cli/src/commands/themes.ts
- [ ] T026 [US3] Write tests for incremental assignment with synthetic fixtures in packages/search/src/clustering/ann-clusterer.test.ts

**Checkpoint**: Incremental clustering works — new chunks assigned without full rebuild, `--rebuild` forces full recluster

---

## Phase 6: User Story 4 - JSON output (Priority: P3)

**Goal**: `wtfoc themes --json -c foc-ecosystem` outputs valid JSON with stable schema.

**Independent Test**: Run with `--json` and parse output as valid JSON with expected fields.

### Implementation for User Story 4

- [ ] T027 [US4] Add `--json` output mode to themes command — structured JSON with clusters array, each containing id, size, label, topTerms, exemplars, sourceDistribution, signalAggregates, confidence in packages/cli/src/commands/themes.ts
- [ ] T028 [US4] Add `--target-clusters <number>` hint flag in packages/cli/src/commands/themes.ts

**Checkpoint**: JSON output is parseable and contains all documented fields

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, web API, and cleanup

- [ ] T029 [P] Add `/api/collections/:name/themes` endpoint to apps/web/server/index.ts
- [ ] T030 [P] Update packages/search/AGENTS.md with clustering rules
- [ ] T031 Run `pnpm build && pnpm test && pnpm lint:fix` across all packages
- [ ] T032 Validate quickstart.md scenarios work end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — core batch clustering
- **US2 (Phase 4)**: Depends on Phase 3 (needs enrichClusters working)
- **US3 (Phase 5)**: Depends on Phase 3 (extends AnnClusterer with incremental mode)
- **US4 (Phase 6)**: Depends on Phase 3 (needs themes command working)
- **Polish (Phase 7)**: Depends on all desired stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no dependencies on other stories
- **US2 (P2)**: Depends on US1 (enrichClusters must exist)
- **US3 (P2)**: Depends on US1 (AnnClusterer batch mode must exist) — can run in parallel with US2
- **US4 (P3)**: Depends on US1 (themes command must exist) — can run in parallel with US2/US3

### Parallel Opportunities

- T005, T006, T007 can run in parallel (different files)
- T010, T011, T012 can run in parallel (different test files)
- US2 and US3 can run in parallel after US1
- US4 can run in parallel with US2/US3
- T029, T030 can run in parallel

---

## Parallel Example: Phase 2

```bash
# Launch all foundational utilities together:
Task: "Create cosine similarity utility in packages/search/src/clustering/cosine.ts"
Task: "Create cluster state persistence in packages/search/src/clustering/cluster-state.ts"
Task: "Create TF-IDF term extraction in packages/search/src/clustering/terms.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (interface + types)
2. Complete Phase 2: Foundational (cosine, state persistence, TF-IDF)
3. Complete Phase 3: User Story 1 (batch clustering + CLI command)
4. **STOP and VALIDATE**: Run `wtfoc themes -c foc-ecosystem` and verify output
5. Demo if ready

### Incremental Delivery

1. Setup + Foundational → Interface and utilities ready
2. Add US1 → `wtfoc themes` works with batch clustering (MVP!)
3. Add US2 → Signal filtering works
4. Add US3 → Incremental clustering works
5. Add US4 → JSON output works
6. Polish → Web API endpoint, docs

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story
- Each user story is independently testable after Phase 2
- Commit after each task with `relates to #59`
- Use `fixes #59` only on the final task
