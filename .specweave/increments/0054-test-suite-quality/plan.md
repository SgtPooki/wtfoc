# Plan: Test suite quality — deduplicate, strengthen mocks, add real E2E

## Overview

This is a refactor increment — no new production code (except one minimal testability change to `serve.ts`), only test code changes. The work decomposes into five independent workstreams that can largely proceed in parallel.

## Workstream 1: Deduplicate Edge Extraction Tests

### Problem

Four test-file pairs in `packages/ingest/src/edges/` have overlapping coverage. Each pair has a `-client.test.ts` (or unit parser) and a higher-level `.test.ts` file, but the boundary between them is blurred.

### Design: Clear Ownership Boundaries

**Pair 1: LLM extraction** (`llm-client.test.ts` vs `llm.test.ts`)
- `llm-client.test.ts` — Tests `parseJsonResponse()` only (JSON parsing from LLM text). Already clean.
- `llm.test.ts` — Tests `LlmEdgeExtractor` class: validation, confidence clamping, batching, fail-open, abort. Already clean.
- **Verdict**: No duplication found. Skip.

**Pair 2: Tree-sitter extraction** (`tree-sitter-client.test.ts` vs `tree-sitter.test.ts`)
- `tree-sitter-client.test.ts` — Owns: HTTP transport (`treeSitterParse`, `treeSitterHealth`), timeout, abort propagation, listener leak, fail-open on server error/unreachable.
- `tree-sitter.test.ts` — Owns: `TreeSitterEdgeExtractor` class: extension-to-language mapping, sourceType filtering, edge field mapping, concurrency.
- **Overlap**: `tree-sitter.test.ts` has redundant fail-open ("sidecar unreachable") and abort tests that duplicate the client-level tests. Remove these from the extractor test and add ownership comments.

**Pair 3: Merge vs Composite** (`merge.test.ts` vs `composite.test.ts`)
- `merge.test.ts` — Owns: `edgeKey()`, `mergeEdges()` dedup, evidence merging, confidence boost math.
- `composite.test.ts` — Owns: `CompositeEdgeExtractor` orchestration: registration, disabled extractors, fail-open, abort, edge cap.
- **Overlap**: `composite.test.ts` "merges and deduplicates edges from multiple extractors" re-tests evidence concatenation already covered in `merge.test.ts`. Simplify to only verify that merge was invoked (check provenance exists).

**Pair 4: Dependency parser vs Code extractor** (`dependency-parser.test.ts` vs `code.test.ts`)
- `dependency-parser.test.ts` — Owns: unit tests for `extractPackageJsonDeps()` and `extractRequirementsTxtDeps()`.
- `code.test.ts` — Owns: `CodeEdgeExtractor` integration: multi-language imports, manifest delegation, multi-chunk reconstruction.
- **Overlap**: `code.test.ts` "extracts package.json dependencies" and "extracts requirements.txt dependencies" duplicate unit parser tests. Replace with a single "delegates to dependency parser for manifests" test that only checks routing (edge count, not field values).

### Files Changed

| File | Action |
|------|--------|
| `packages/ingest/src/edges/tree-sitter.test.ts` | Remove redundant fail-open/abort tests, add ownership comment |
| `packages/ingest/src/edges/composite.test.ts` | Simplify merge-verification test |
| `packages/ingest/src/edges/code.test.ts` | Replace duplicate manifest tests with delegation check |

## Workstream 2: Replace Over-Mocked Search/Trace Tests

### Problem

`packages/search/src/query.test.ts` and `packages/search/src/trace.test.ts` use a `createMockIndex()` that ignores the query vector — returns entries in insertion order with synthetic scores (`1.0 - i * 0.1`). Ranking tests are meaningless.

### Design: Use Real InMemoryVectorIndex

Replace `createMockIndex()` with `InMemoryVectorIndex` from `packages/search/src/index/in-memory.ts` which implements actual cosine similarity.

**Key decisions:**

1. **Deliberately chosen embeddings**: Use hand-crafted 3D vectors where expected ranking is geometrically obvious (e.g., query `[1,0,0]`, entries at `[1,0,0]`, `[0.7,0.7,0]`, `[0,0,1]`).

2. **Deterministic embedder helper**: Create `deterministicEmbedder(mapping: Record<string, number[]>)` that returns a known vector for each input string. Place in `packages/search/src/test-helpers.ts`.

3. **query.test.ts migration**:
   - Replace `createMockIndex` + `mockEmbedder` with `InMemoryVectorIndex` + `deterministicEmbedder`
   - "returns ranked results" — seed with entries at known vectors, verify geometric ranking
   - "filters by minScore" — use vectors with known similarity gaps
   - Other tests (topK, empty, abort) — straightforward port

4. **trace.test.ts migration**:
   - Replace `createMockIndex` with `InMemoryVectorIndex`
   - Use hash-based embedder (like `e2e-pipeline.test.ts`) for content-aware but deterministic embeddings
   - Edge traversal tests mostly unaffected (edge following is vector-independent)
   - Semantic fallback test ("fills underrepresented source types") needs real similarity to work correctly

### Files Changed

| File | Action |
|------|--------|
| `packages/search/src/test-helpers.ts` | New — `deterministicEmbedder()` helper |
| `packages/search/src/query.test.ts` | Replace mock index with InMemoryVectorIndex + deterministic embedder |
| `packages/search/src/trace.test.ts` | Replace mock index with InMemoryVectorIndex + hash-based embedder |

## Workstream 3: Add True Ingest-Through-HTTP E2E Test

### Problem

The existing E2E test (`packages/store/src/e2e-pipeline.test.ts`) exercises the full pipeline but bypasses the HTTP layer. `packages/cli/src/serve.ts` has zero test coverage.

### Design: HTTP E2E Test

**Approach:**
1. Reuse existing E2E's `mockEmbedder()` and pipeline setup
2. Refactor `startServer()` in `serve.ts` to return `{ server, state }` and not call `process.exit` (move exit to CLI command handler)
3. Start server on port `:0`, hit all API endpoints, assert response structure
4. Test lives at `packages/cli/src/serve.test.ts`

**Endpoints to test:**
- `GET /api/status` — verify collection metadata
- `GET /api/query?q=...` — verify results match programmatic query
- `GET /api/trace?q=...` — verify trace structure
- `GET /api/collections` — verify listing
- `GET /api/sources` — verify source type breakdown
- `GET /api/edges` — verify edge stats
- `GET /nonexistent` — verify 404
- `OPTIONS /api/query` — verify CORS preflight

**Production change**: Minimal refactor of `startServer` — return server instance, throw instead of `process.exit`. This is the only production code change in this increment.

### Files Changed

| File | Action |
|------|--------|
| `packages/cli/src/serve.ts` | Refactor: return server instance, throw instead of process.exit |
| `packages/cli/src/commands/serve.ts` | Catch error and process.exit here |
| `packages/cli/src/serve.test.ts` | New — HTTP E2E test |

## Workstream 4: Tighten Adapter Assertions

### Problem

Adapter tests use `expect(x.length).toBeGreaterThan(0)` — passes as long as *something* is returned, even garbage.

### Design: Golden Fixture Assertions

Replace `> 0` checks with exact counts captured from a green test run, plus spot-checks on specific values:

1. **repo.test.ts** (6 instances) — Assert exact chunk/edge counts from `fixtures/test-repo/`, plus verify at least one specific entry's content/targetId
2. **discord.test.ts** (3 instances) — Assert exact edge counts and specific edge targets
3. **github.test.ts** (1 instance) — Assert exact count and spot-check

**Implementation note**: Run tests first to capture baselines. Add comments noting that fixture changes require test count updates.

### Files Changed

| File | Action |
|------|--------|
| `packages/ingest/src/adapters/repo.test.ts` | Replace 6 `> 0` with exact counts + spot checks |
| `packages/ingest/src/adapters/discord.test.ts` | Replace 3 `> 0` with exact counts + spot checks |
| `packages/ingest/src/adapters/github.test.ts` | Replace 1 `> 0` with exact count + spot check |

## Workstream 5: Extract Shared Test Helpers (Optional)

### Problem

`makeChunk` duplicated across 8 test files with different signatures. `makeEdge` duplicated across 3 files.

### Design: Shared Test Fixture Factories

Create `packages/ingest/src/edges/__test-helpers.ts` (underscore prefix = not exported from package):

```typescript
export function makeChunk(overrides?: Partial<Chunk> & { content?: string; source?: string }): Chunk
export function makeEdge(overrides?: Partial<Edge>): Edge
```

Superset signature with sensible defaults. Keep `makeCodeChunk` in `code.test.ts` since it has unique parameters.

### Files Changed

| File | Action |
|------|--------|
| `packages/ingest/src/edges/__test-helpers.ts` | New — shared `makeChunk`, `makeEdge` |
| 8 test files in `packages/ingest/src/edges/` | Import from shared helper |
| `packages/ingest/src/segment-builder.test.ts` | Import from `./edges/__test-helpers` |

## Dependency Graph

```
Workstream 5 (shared helpers, optional) ─┐
                                          ├─> Workstream 1 (dedup edge tests)
Workstream 2 (search mock replacement)    │   (independent)
Workstream 3 (HTTP E2E)                   │   (independent)
Workstream 4 (adapter assertions)         │   (independent)
                                          │
All workstreams ──────────────────────────┴─> Final: pnpm test + pnpm lint:fix
```

Workstreams 2, 3, 4 are fully independent and parallelizable. Workstream 5 should precede Workstream 1 if attempted. Workstream 1 is independent of 2/3/4.

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Golden fixture counts break on fixture changes | Medium | Comment in tests noting fixture dependency |
| Deterministic embedder makes tests harder to read | Low | Small vectors (3D), obvious geometric relationships |
| serve.ts refactor breaks CLI | Low | Minimal change — return server + throw instead of exit |
| Shared test helpers create coupling | Low | Underscore-prefixed, not package-exported |

## No ADRs Needed

Test-only refactor with one minimal production testability change. No architectural decisions warrant an ADR.
