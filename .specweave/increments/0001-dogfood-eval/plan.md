# Implementation Plan: Holistic dogfood evaluation skill

## Overview

A developer-only script (`pnpm dogfood` via `scripts/dogfood.ts`) that runs 7 evaluation stages against an existing collection, producing a unified JSON report. Each evaluator lives in its owning package (distributed ownership), exports a common `EvalStageResult` interface defined in `@wtfoc/common`, and the script orchestrates them sequentially. This is NOT a public CLI command — it uses `parseArgs` from `node:util`, not Commander.js.

The existing edge eval harness (`packages/ingest/src/edges/eval.ts`) is wrapped -- not rewritten -- as stage 2. All evaluators read collection data through the existing `Store` + `mountCollection` path (read-only).

## Architecture

### Component Map

```
@wtfoc/common          ← EvalStageResult, DogfoodReport types
@wtfoc/ingest          ← IngestEvaluator (stage 1), EdgeExtractionEvaluator (stage 2 wraps eval.ts)
@wtfoc/search          ← EdgeResolutionEvaluator (stage 3), SearchEvaluator (stage 5)
@wtfoc/store           ← StorageEvaluator (stage 4)
@wtfoc/cli             ← orchestrator script (scripts/dogfood.ts, developer-only)
```

### Evaluator Interface (in @wtfoc/common)

```typescript
/** Common result envelope for every dogfood evaluation stage. */
export interface EvalStageResult {
  /** Stage identifier: "ingest" | "edge-extraction" | "edge-resolution" | "storage" | "search" */
  stage: string;
  /** ISO timestamp when this stage started */
  startedAt: string;
  /** Wall-clock duration in ms */
  durationMs: number;
  /** Pass/warn/fail overall verdict */
  verdict: "pass" | "warn" | "fail";
  /** Human-readable summary line */
  summary: string;
  /** Stage-specific metrics (JSON-serializable) */
  metrics: Record<string, unknown>;
  /** Individual check results */
  checks: EvalCheck[];
}

export interface EvalCheck {
  name: string;
  passed: boolean;
  /** What was measured */
  actual: string | number;
  /** What was expected (threshold or target) */
  expected?: string | number;
  /** Explanation when failed */
  detail?: string;
}

/** Top-level report from `pnpm dogfood`. */
export interface DogfoodReport {
  /** Semantic version for forward compat — starts at "1.0.0" */
  reportSchemaVersion: string;
  /** ISO timestamp */
  timestamp: string;
  /** Collection evaluated */
  collectionId: string;
  collectionName: string;
  /** Per-stage results in pipeline order (array, not record — order matters) */
  stages: EvalStageResult[];
  /** Aggregate verdict: fail if any stage fails, warn if any warns, else pass */
  verdict: "pass" | "warn" | "fail";
  /** Total wall-clock duration in ms */
  durationMs: number;
}
```

### Evaluator Contract (not a formal interface -- just a convention)

Each evaluator is an exported async function in its owning package:

```typescript
// Pattern: evaluate<Stage>(data, options?) => Promise<EvalStageResult>
export async function evaluateIngest(segments: Segment[], head: CollectionHead): Promise<EvalStageResult>;
export async function evaluateEdgeExtraction(options: EvalOptions): Promise<EvalStageResult>;
export async function evaluateEdgeResolution(segments: Segment[]): Promise<EvalStageResult>;
export async function evaluateStorage(head: CollectionHead, storage: StorageBackend): Promise<EvalStageResult>;
export async function evaluateThemes(segments: Segment[], embedder?: Embedder, extractorOptions?: EvalOptions): Promise<EvalStageResult>;
export async function evaluateSignals(segments: Segment[]): Promise<EvalStageResult>;
export async function evaluateSearch(embedder: Embedder, vectorIndex: VectorIndex, segments: Segment[]): Promise<EvalStageResult>;
```

### Data Model

No new persistence -- the `DogfoodReport` is written to stdout (JSON) or formatted for humans. Optionally saved to a file via `--output <path>`.

### Developer Script (not a public CLI command)

```
pnpm dogfood --collection <name> [options]

Options:
  --collection <name>       Collection to evaluate (required)
  --stage <name>            Run single stage (ingest|edges|resolution|storage|themes|signals|search)
  --output <path>           Write JSON report to file
  --extractor-url <url>     LLM endpoint for edge eval + theme labeling
  --extractor-model <model> LLM model name
  --embedder-url <url>      Embedder endpoint for search + themes
  --embedder-model <model>  Embedder model name
  --skip-llm                Skip LLM-dependent stages (edges, themes labeling, search)
  --json                    Output JSON instead of human-readable summary
```

Orchestrator lives at `scripts/dogfood.ts`, run via `tsx`. Imports evaluators from each package directly.

## Technology Stack

- **Language**: TypeScript (ESM, matches all existing packages)
- **Script Runner**: tsx (developer-only, uses `parseArgs` from `node:util`)
- **Testing**: Vitest (TDD mode per project config)
- **Types**: `@wtfoc/common` for shared interfaces

**Architecture Decisions**:

### ADR-001: Distributed Evaluators Over Centralized Package

**Decision**: Each evaluator lives in its owning package rather than a new `@wtfoc/eval` package.

**Rationale**: Evaluators need direct access to package internals (chunker heuristics, storage verification, vector index). A centralized package would either duplicate logic or require exporting internals. Distributed evaluators follow the existing pattern where `@wtfoc/search` exports `analyzeEdgeResolution` used by `@wtfoc/cli`.

**Tradeoff**: CLI must import from all packages. This is already the case (see `@wtfoc/cli/package.json` dependencies).

### ADR-002: Wrap Existing Edge Eval, Don't Rewrite

**Decision**: Stage 2 wraps `runEdgeEval()` from `packages/ingest/src/edges/eval.ts` and maps `EvalReport` to `EvalStageResult`.

**Rationale**: The edge eval harness is battle-tested with gold-set matching, batching, gate metrics. Rewriting would be wasteful. The wrapper adapts the existing `EvalReport` (with stages[], gates, coverage, negatives) into the common `EvalStageResult` envelope.

### ADR-003: Convention Over Interface for Evaluators

**Decision**: Evaluators are plain async functions, not classes implementing a formal interface.

**Rationale**: Each stage has different input requirements (some need segments, some need storage, some need LLM config). A shared interface would require a god-object parameter or excessive generics. Plain functions with typed signatures are simpler and follow the existing codebase style (e.g., `analyzeEdgeResolution`, `query`, `trace` are all plain functions).

## Stage Details

### Stage 1: Ingest Quality (in @wtfoc/ingest)

**File**: `packages/ingest/src/eval/ingest-evaluator.ts`

Checks:
- **Chunk well-formedness**: required fields (id, content, sourceType, source) present and non-empty
- **Metadata completeness**: percentage of chunks with `documentId`, `documentVersionId`, `contentFingerprint` populated (these three enable incremental re-processing per vision goal #3)
- **Chunk sizing**: min/max/mean/median content length, flag chunks under 50 chars or over 10,000 chars
- **Per-source-type breakdown**: metadata completeness per source type so operators see which adapters lag

Inputs: `Segment[]`, `CollectionHead`

### Stage 2: Edge Extraction Quality (in @wtfoc/ingest)

**File**: `packages/ingest/src/eval/edge-extraction-evaluator.ts`

Wraps existing `runEdgeEval()`. Maps `EvalReport` fields to `EvalStageResult`:
- `metrics.stages` = EvalReport.stages (raw/normalized/gated F1)
- `metrics.gates` = EvalReport.gates (acceptance/rejection rates)
- `metrics.coverage` = EvalReport.coverage
- `metrics.negatives` = EvalReport.negatives
- verdict: fail if microF1 < 0.3, warn if < 0.5, pass otherwise

Inputs: `EvalOptions` (LLM config) -- requires `--extractor-*` flags or skipped with `--skip-llm`

### Stage 3: Edge Resolution Quality (in @wtfoc/search)

**File**: `packages/search/src/eval/edge-resolution-evaluator.ts`

Wraps existing `analyzeEdgeResolution()` + `buildSourceIndex()`. Additional checks:
- **Resolution rate**: percentage of edges that resolve to existing chunks
- **Bare ref rate**: percentage of `#N` references without repo context
- **Cross-source density**: edges that link chunks across different sourceTypes
- **Normalization quality**: percentage of edge types that are canonical (from `normalizeEdgeType`)

Inputs: `Segment[]`

### Stage 4: Storage Quality (in @wtfoc/store)

**File**: `packages/store/src/eval/storage-evaluator.ts`

Checks:
- **Segment integrity**: every segment ref in head can be downloaded and parsed as valid JSON
- **Derived layer consistency**: every `derivedEdgeLayers[].id` can be downloaded
- **Catalog accuracy**: if document catalog exists, verify chunk IDs in catalog match chunks in segments
- **Schema version**: segments and head use current schema version

Inputs: `CollectionHead`, `StorageBackend`

### Stage 5: Themes/Clustering Quality (in @wtfoc/search)

**File**: `packages/search/src/eval/themes-evaluator.ts`

Checks:
- **Cluster metrics**: cluster count, min/max/mean size, noise chunk count/percentage
- **Intra-cluster cohesion**: mean pairwise cosine similarity within each cluster
- **Source-type diversity**: distinct source types per cluster (cross-source clusters are valuable)
- **LLM label quality** (optional, when extractor configured): label count, duplicate rate, mean length
- Requires embedder (cosine similarity on embeddings)

Inputs: `Segment[]`, `Embedder` (optional for labeling: `EvalOptions`)

### Stage 6: Signal Scoring Quality (in @wtfoc/ingest)

**File**: `packages/ingest/src/eval/signal-evaluator.ts`

Checks:
- **Signal distribution**: per-type counts (pain, praise, feature_request, workaround, question)
- **Signal coverage**: percentage of chunks with at least one non-zero signal
- **Per-source-type breakdown**: which source types produce which signals
- No LLM or embedder required (purely regex-based HeuristicChunkScorer)

Inputs: `Segment[]`

### Stage 7: Search/Retrieval Quality (in @wtfoc/search)

**File**: `packages/search/src/eval/search-evaluator.ts`

Checks:
- **Index health**: vector index reports correct count matching segment chunk count
- **Self-retrieval**: sample N chunks, embed their content, verify they appear in top-K results (sanity check)
- **Source coverage**: trace a generic query, verify results span multiple source types
- **Provenance completeness**: percentage of trace hops with non-empty sourceUrl

Inputs: `Embedder`, `VectorIndex`, `Segment[]` -- requires `--embedder-*` flags or skipped with `--skip-llm`

## Implementation Phases

### Phase 1: Foundation (Types + Ingest Evaluator)
1. Add `EvalStageResult`, `EvalCheck`, `DogfoodReport` types to `@wtfoc/common`
2. Implement ingest evaluator (no LLM, pure data checks)
3. Create `scripts/dogfood.ts` orchestrator with basic stage sequencing
4. TDD: unit tests for ingest evaluator

### Phase 2: Core Evaluators
5. Implement edge extraction evaluator (wraps existing eval.ts)
6. Implement edge resolution evaluator (wraps analyzeEdgeResolution)
7. Implement storage evaluator
8. Implement themes/clustering evaluator
9. Implement signal scoring evaluator
10. TDD: unit tests for each evaluator

### Phase 3: Search + Script Polish
11. Implement search evaluator
12. Create `scripts/dogfood.ts` orchestrator + `pnpm dogfood` script entry
13. Add human-readable report formatting
14. Integration test: full pipeline against a test collection

## Testing Strategy

- **Unit tests per evaluator**: mock segments/storage, verify check logic and verdict thresholds
- **Integration test**: load a real collection (or synthetic fixture), run all stages, verify report structure
- **Existing edge eval tests**: `packages/ingest/src/edges/eval.test.ts` already covers stage 2 internals
- **TDD mode**: RED (write failing test for evaluator) -> GREEN (implement) -> REFACTOR

## Technical Challenges

### Challenge 1: Stage 5 requires embedder initialization
**Solution**: Reuse `createEmbedder()` from CLI helpers. Skip stage 5 when `--skip-llm` is passed.
**Risk**: Embedder model mismatch with collection. Mitigation: same dimension check as `query` command.

### Challenge 2: Edge eval (stage 2) uses fixture chunks, not collection data
**Solution**: Stage 2 runs the existing gold-set eval as-is (tests the extraction pipeline quality). It does NOT re-extract edges from the collection. This is intentional -- it evaluates the LLM extraction capability, while stage 3 evaluates the actual collection's edge quality.
**Risk**: Users may expect stage 2 to evaluate their collection's edges. Mitigation: clear naming ("Edge Extraction Quality" vs "Edge Resolution Quality") and summary text.

### Challenge 3: Large collections may be slow to load
**Solution**: Reuse `loadSegments` pattern from extract-edges (loads without vector index). Only stage 5 needs the vector index. Signal/abort support throughout.
**Risk**: Memory pressure. Mitigation: stages run sequentially, GC between stages.
