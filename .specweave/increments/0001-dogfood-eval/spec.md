---
increment: 0001-dogfood-eval
title: Holistic dogfood evaluation skill
type: feature
priority: P1
status: completed
created: 2026-04-12T00:00:00.000Z
structure: user-stories
test_mode: TDD
coverage_target: 80
---

# Feature: Holistic dogfood evaluation skill

## Overview

A developer-only script (`pnpm dogfood` via `scripts/dogfood.ts`) that runs comprehensive quality evaluation across the entire wtfoc pipeline (ingest, edge extraction, edge resolution, storage, themes/clustering, signal scoring, search/trace) and produces structured, versioned, JSON-serializable reports. Each pipeline stage has its own evaluator in its owning package; the script orchestrates them sequentially and combines results into a unified dogfood report with timestamp and schema version for longitudinal comparison. This is NOT a public CLI command.

**GitHub Issue**: #206

## North-Star Alignment

This evaluation framework directly measures how well wtfoc delivers on its vision (see `docs/vision.md`). Each eval stage maps to specific north-star goals:

| Eval Stage | Vision Goals Measured | What It Validates |
|---|---|---|
| **Ingest** | #1 Living Collections, #3 Minimal Re-Processing | Chunks are well-formed, metadata enables incremental re-processing (`contentFingerprint`, `documentVersionId`), adapters don't regress |
| **Edge Extraction** | #4 Rich, Trustworthy Edges | LLM + multi-extractor pipeline produces accurate edges with structured evidence and provenance |
| **Edge Resolution** | #2 Cross-Cutting Answers | Edges actually connect chunks across source types; resolution rate tracks whether the graph enables cross-source traversal |
| **Storage** | #5 Portable Knowledge, #7 Credible Exit | Immutable segments are intact, content-addressed storage is consistent, catalog is accurate |
| **Themes/Clustering** | #2 Cross-Cutting Answers | Semantic groupings span multiple source types; labels are meaningful and non-redundant |
| **Signal Scoring** | #1 Living Collections | Signal classification (pain/praise/feature_request) supports query boosting and collection health monitoring |
| **Search/Trace** | #2 Cross-Cutting Answers, #8 Evidence You Can Trust | `trace()` follows explicit edges across source types with verifiable provenance chains; `query()` returns relevant results |

**Key validation questions** (from vision.md "Measuring Success"):
- Does a trace query save 30min of manual cross-tool searching? (search/trace stage: edge-hop coverage, source-type diversity)
- Can an AI agent cite trace results with verifiable hops? (search/trace stage: provenance chain completeness)
- Does the edge graph surface unknown connections? (resolution stage: cross-source edge density)
- Do re-runs after changes only process changed content? (ingest stage: `contentFingerprint` population rate)

## User Stories

### US-001: Run full pipeline evaluation (P1)
**Project**: wtfoc

**As a** wtfoc developer
**I want** to run `pnpm dogfood --collection <name> --extractor-url <url> --extractor-model <model>` from the monorepo root and get a unified quality report across all pipeline stages
**So that** I can identify which parts of the pipeline are degrading and prioritize fixes

**Acceptance Criteria**:
- [x] **AC-US1-01**: A developer script at `scripts/dogfood.ts` is runnable via `pnpm dogfood` (root package.json script entry using tsx)
- [x] **AC-US1-02**: `--collection <name>` is required; the script loads the collection head from the manifest store (same pattern as existing CLI commands)
- [x] **AC-US1-03**: `--extractor-url <url>` and `--extractor-model <model>` are accepted as CLI args for stages that need LLM access (edge eval)
- [x] **AC-US1-04**: The script runs all 7 stage evaluators in sequence (ingest, edges, resolution, storage, themes, signals, search) and produces a unified `DogfoodReport` JSON object
- [x] **AC-US1-05**: The unified report includes `timestamp` (ISO 8601), `reportSchemaVersion` (starting at `"1.0.0"`), `collectionName`, `durationMs`, and a `stages` array of `EvalStageResult` in pipeline order
- [x] **AC-US1-06**: JSON output is printed to stdout when `--json` is passed; human-readable summary is printed by default
- [x] **AC-US1-07**: The script exits with code 0 on success, 1 on evaluation failure

---

### US-002: Run individual stage evaluation (P1)
**Project**: wtfoc

**As a** wtfoc developer
**I want** to run `pnpm dogfood --collection <name> --stage <stage>` to evaluate a single pipeline stage
**So that** I can iterate quickly on one area without waiting for the full pipeline eval

**Acceptance Criteria**:
- [x] **AC-US2-01**: `--stage <name>` accepts values: `ingest`, `edges`, `resolution`, `storage`, `themes`, `signals`, `search`
- [x] **AC-US2-02**: When `--stage` is specified, only that stage's evaluator runs; the unified report contains only that stage's results
- [x] **AC-US2-03**: When `--stage edges` is used, `--extractor-url` and `--extractor-model` are required (the script errors with a helpful message if missing)
- [x] **AC-US2-04**: When `--stage` is omitted, all stages run (default behavior from US-001)

---

### US-003: Ingest quality evaluation (P1)
**Project**: wtfoc

**As a** wtfoc developer
**I want** ingest quality metrics that check chunk well-formedness, metadata completeness, and incremental-processing readiness
**So that** I can catch adapter regressions before they corrupt the graph and verify the collection supports minimal re-processing (vision goal #3 — only touch what changed)

**Acceptance Criteria**:
- [x] **AC-US3-01**: The ingest evaluator loads all segments from the collection and inspects every chunk
- [x] **AC-US3-02**: Reports chunk count, source type distribution, and chunks-per-segment distribution
- [x] **AC-US3-03**: Checks metadata completeness: percentage of chunks with `documentId`, `documentVersionId`, and `contentFingerprint` populated (non-null, non-empty) — these three fields are required for incremental re-processing (vision goal #3)
- [x] **AC-US3-04**: Checks chunk sizing: reports min/max/mean/median content length in characters; flags chunks under 50 chars or over 10,000 chars as warnings
- [x] **AC-US3-05**: Checks required fields: every chunk must have non-empty `id`, `content`, `sourceType`, `source`; reports violation count
- [x] **AC-US3-06**: Reports per-source-type completeness breakdown so operators can identify which adapters are lagging on metadata population
- [x] **AC-US3-07**: Produces an `IngestEvalReport` with all metrics above, typed and JSON-serializable

---

### US-004: Edge extraction quality evaluation (P1)
**Project**: wtfoc

**As a** wtfoc developer
**I want** the existing edge eval harness from PR #204 integrated as the edge extraction stage
**So that** edge quality measurement validates vision goal #4 (rich, trustworthy edges) — LLM extraction precision/recall, acceptance gate behavior, and structured evidence quality — as part of the unified dogfood framework without rewriting existing code

**Acceptance Criteria**:
- [x] **AC-US4-01**: The edge stage delegates to the existing `runEdgeEval()` function from `@wtfoc/ingest` (`packages/ingest/src/edges/eval.ts`)
- [x] **AC-US4-02**: The existing `EvalReport` type is wrapped/mapped into the stage report structure without modifying the original harness code
- [x] **AC-US4-03**: LLM options (`baseUrl`, `model`, `apiKey`, `jsonMode`, `timeoutMs`, `maxConcurrency`, `maxInputTokens`) are forwarded from CLI extractor options to `EvalOptions`
- [x] **AC-US4-04**: The edge stage is skippable when extractor options are not provided (logged as "skipped: no extractor configured" in the unified report)
- [x] **AC-US4-05**: The wrapped report surfaces key vision-aligned metrics at the top level: gated F1 (edge accuracy), gold survival rate (how many real edges survive gates), and coverage (what percentage of fixture chunks were evaluated)

---

### US-005: Edge resolution quality evaluation (P1)
**Project**: wtfoc

**As a** wtfoc developer
**I want** resolution metrics showing what percentage of edges resolve to real chunks and how many cross source-type boundaries
**So that** I can track whether the graph enables cross-cutting answers (vision goal #2) — baseline resolution rate is ~23% per #193, and cross-source density directly measures the graph's ability to connect siloed knowledge

**Acceptance Criteria**:
- [x] **AC-US5-01**: The resolution evaluator reuses `analyzeEdgeResolution()` and `buildSourceIndex()` from `@wtfoc/search` (same logic as the `unresolved-edges` CLI command)
- [x] **AC-US5-02**: Reports: `totalEdges`, `resolvedEdges`, `bareRefs`, `unresolvedEdges`, `resolutionRate` (resolved / total), `bareRefRate`
- [x] **AC-US5-03**: Reports cross-source edge density: number of edges whose sourceId source type differs from their resolved target's source type, divided by total resolved edges — this is the key metric for vision goal #2
- [x] **AC-US5-04**: Reports top-10 unresolved target repos (same as `unresolved-edges --limit 10` output)
- [x] **AC-US5-05**: Reports source-type pair distribution for resolved cross-source edges (e.g., `github-issue -> code: 42`, `slack-message -> github-pr: 17`) to show which source boundaries the graph bridges
- [x] **AC-US5-06**: Produces a `ResolutionEvalReport` typed and JSON-serializable

---

### US-006: Storage quality evaluation (P2)
**Project**: wtfoc

**As a** wtfoc developer
**I want** storage integrity checks covering segments, derived edge layers, and the document catalog
**So that** I can detect data corruption or inconsistency before it affects search results, and verify the collection's immutable, content-addressed storage is sound (vision goals #5 portable knowledge, #7 credible exit)

**Acceptance Criteria**:
- [x] **AC-US6-01**: Verifies every segment referenced in the manifest can be downloaded and parsed as valid JSON with expected `Segment` shape (has `id`, `chunks` array, `edges` array)
- [x] **AC-US6-02**: Reports segment count, total chunk count across segments, and total edge count across segments
- [x] **AC-US6-03**: If a derived edge layer overlay file exists (from `extract-edges`), checks that every `sourceId` in overlay edges references a chunk that exists in the collection's segments
- [x] **AC-US6-04**: If a document catalog exists, checks that every `documentId` entry references chunk IDs that exist in segments; reports orphaned catalog entries
- [x] **AC-US6-05**: Produces a `StorageEvalReport` typed and JSON-serializable

---

### US-007: Search and trace quality evaluation (P2)
**Project**: wtfoc

**As a** wtfoc developer
**I want** search and trace quality metrics using canned test queries, measuring both semantic retrieval and edge-following traversal
**So that** I can verify wtfoc's core differentiator — trace follows explicit edges across source types with verifiable provenance (vision goals #2, #8)

**Acceptance Criteria**:
- [x] **AC-US7-01**: The search evaluator runs test queries using both `query()` (semantic search) and `trace()` (edge-following traversal) from `@wtfoc/search`
- [x] **AC-US7-02**: Test queries are defined in a fixture file with expected result properties (source type, source substring match) — not exact chunk IDs, since those change across ingests
- [x] **AC-US7-03**: Reports per-query for `query()`: query text, result count, top-result score, whether expected source types appeared in top-K results
- [x] **AC-US7-04**: Reports per-query for `trace()`: total hops, edge hops vs semantic hops, distinct source types reached, insight count (convergence/evidence-chain/temporal-cluster from analytical mode)
- [x] **AC-US7-05**: Reports trace provenance quality: percentage of edge-hops that have non-empty `evidence` and `edgeType` in their `connection` (validates vision goal #8 — evidence you can trust)
- [x] **AC-US7-06**: Reports aggregate: mean reciprocal rank (MRR) for query, source-type coverage for trace (distinct source types reached / total source types in collection), edge-hop ratio (edge hops / total hops — higher means the graph is doing its job)
- [x] **AC-US7-07**: Requires embedder options (`--embedder-url`, `--embedder-model`) with same semantics as the CLI's `withEmbedderOptions` (parsed via `parseArgs` in the script); skippable when not configured
- [x] **AC-US7-08**: Produces a `SearchEvalReport` typed and JSON-serializable

---

### US-008: Themes/clustering quality evaluation (P2)
**Project**: wtfoc

**As a** wtfoc developer
**I want** theme/clustering quality metrics that evaluate cluster coherence, LLM label accuracy, and noise categorization
**So that** I can verify the semantic understanding layer produces meaningful groupings for collection exploration

**Acceptance Criteria**:
- [x] **AC-US8-01**: The themes evaluator runs `GreedyClusterer` from `@wtfoc/search` against loaded chunks and reports cluster count, min/max/mean cluster size, and noise chunk count
- [x] **AC-US8-02**: Reports intra-cluster cohesion: mean pairwise cosine similarity within each cluster (higher = more coherent clusters)
- [x] **AC-US8-03**: Reports source-type diversity per cluster: how many distinct source types appear in each cluster (cross-source clusters are more valuable)
- [x] **AC-US8-04**: When extractor options are provided, runs LLM labeling via `labelClusters()` and reports: label count, duplicate label rate, mean label length
- [x] **AC-US8-05**: Skippable when embedder options are not configured (clustering requires embeddings)
- [x] **AC-US8-06**: Produces a `ThemesEvalReport` typed and JSON-serializable

---

### US-009: Signal scoring quality evaluation (P2)
**Project**: wtfoc

**As a** wtfoc developer
**I want** signal scoring metrics that evaluate the HeuristicChunkScorer's classification distribution across the collection
**So that** I can verify signal-based query boosting has meaningful data to work with and detect scoring regressions

**Acceptance Criteria**:
- [x] **AC-US9-01**: The signal evaluator runs `HeuristicChunkScorer` from `@wtfoc/ingest` against all chunks and reports per-signal-type distribution (pain, praise, feature_request, workaround, question)
- [x] **AC-US9-02**: Reports: total chunks scored, chunks with at least one non-zero signal, per-signal-type count and percentage
- [x] **AC-US9-03**: Reports per-source-type signal distribution so developers can see which source types contribute most to each signal
- [x] **AC-US9-04**: Does not require LLM or embedder options (purely heuristic/regex-based)
- [x] **AC-US9-05**: Produces a `SignalEvalReport` typed and JSON-serializable

---

### US-010: Report versioning and longitudinal comparison (P2)
**Project**: wtfoc

**As a** wtfoc developer
**I want** reports to be versioned and saved for later comparison
**So that** I can track quality trends across pipeline changes

**Acceptance Criteria**:
- [x] **AC-US10-01**: The unified `DogfoodReport` includes a `reportSchemaVersion` field (starting at `"1.0.0"`)
- [x] **AC-US10-02**: When `--output <path>` is provided, the JSON report is written to that file path
- [x] **AC-US10-03**: Report filenames default to `dogfood-<collection>-<ISO-timestamp>.json` when `--output` is a directory
- [x] **AC-US10-04**: Each stage report within the unified report includes its own `durationMs` for per-stage timing

## Functional Requirements

### FR-001: Stage evaluator interface
Each stage evaluator implements a common async interface:
```typescript
interface StageEvaluator<TReport> {
  stage: string;
  run(context: EvalContext): Promise<TReport>;
}
```
Where `EvalContext` provides: collection head, loaded segments, source index, CLI options, and abort signal.

### FR-002: Evaluator placement
- **Ingest evaluator**: `packages/ingest/src/eval/ingest-eval.ts` (new file in @wtfoc/ingest)
- **Edge evaluator**: wraps existing `packages/ingest/src/edges/eval.ts` (no changes to existing file)
- **Resolution evaluator**: `packages/search/src/eval/resolution-eval.ts` (new file in @wtfoc/search)
- **Storage evaluator**: `packages/store/src/eval/storage-eval.ts` (new file in @wtfoc/store)
- **Search evaluator**: `packages/search/src/eval/search-eval.ts` (new file in @wtfoc/search)
- **Themes evaluator**: `packages/search/src/eval/themes-eval.ts` (new file in @wtfoc/search)
- **Signal evaluator**: `packages/ingest/src/eval/signal-evaluator.ts` (new file in @wtfoc/ingest)
- **Orchestrator script**: `scripts/dogfood.ts` (developer-only, not part of public CLI)

### FR-003: Shared types
Report types (`DogfoodReport`, `IngestEvalReport`, `ResolutionEvalReport`, `StorageEvalReport`, `SearchEvalReport`, `ThemesEvalReport`, `SignalEvalReport`) are defined in `@wtfoc/common` so all packages can reference them. The existing `EvalReport` from `@wtfoc/ingest` is re-exported as-is (not duplicated).

### FR-004: OpenAI-compatible endpoint support
All LLM interactions must work with any OpenAI-compatible endpoint (vLLM, LM Studio, Ollama, OpenAI). The existing `withExtractorOptions` and URL shortcut system (`lmstudio`, `ollama`) handles this.

## Success Criteria

**Functional**:
- `pnpm dogfood --collection <name> --extractor-url lmstudio --extractor-model <model>` produces a complete report covering all 7 stages
- Individual stages can be run in isolation with `--stage <name>`
- Reports are valid JSON, parseable by downstream tools
- Edge eval stage reuses the #204 harness without modification
- Resolution rate metric matches the output of `wtfoc unresolved-edges` for the same collection

**Vision-aligned** (the report surfaces these key indicators):
- **Incremental readiness**: Ingest report shows `contentFingerprint` + `documentVersionId` population rate per adapter (goal #3)
- **Edge trustworthiness**: Edge report shows gated F1 and gold survival rate (goal #4)
- **Cross-cutting graph density**: Resolution report shows cross-source edge density and source-type pair distribution (goal #2)
- **Trace effectiveness**: Search report shows edge-hop ratio, source-type coverage, and provenance completeness for `trace()` (goals #2, #8)
- **Storage integrity**: Storage report confirms all segments parse and catalog entries resolve (goals #5, #7)
- **Theme coherence**: Themes report shows intra-cluster cohesion and cross-source diversity (goal #2)
- **Signal coverage**: Signal report shows distribution across signal types and source types (goal #1)

## Out of Scope

- **Automated thresholds / pass-fail gates**: This increment produces reports; threshold-based CI gates are a follow-up
- **Historical comparison UI**: Longitudinal comparison is manual (diff two JSON files); a dashboard is a follow-up
- **Custom gold sets**: Edge eval uses the built-in gold set from #204; user-provided gold sets are a follow-up
- **Parallel stage execution**: Stages run sequentially for simplicity; parallelization is a follow-up if perf is an issue
- **Collection creation/ingest as part of dogfood**: The dogfood command evaluates an existing collection; it does not create or populate one

## Dependencies

- **PR #204 (merged)**: Edge quality evaluation harness — `runEdgeEval()`, `EvalReport`, fixture chunks, gold set
- **@wtfoc/search**: `analyzeEdgeResolution()`, `buildSourceIndex()`, `query()`, `trace()`
- **@wtfoc/store**: `createStore()`, `LocalManifestStore` for segment loading
- **@wtfoc/common**: `Chunk`, `Edge`, `Segment`, `StructuredEvidence` types
- **@wtfoc/config**: `loadProjectConfig()` for collection config
- **Commander.js CLI patterns**: `registerXCommand()`, `withExtractorOptions()`, `withEmbedderOptions()`
