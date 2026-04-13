---
increment: 0054-test-suite-quality
title: "Test suite quality: deduplicate, strengthen mocks, add real E2E"
status: in_progress
---

# Tasks

## Task Notation

- `[P]`: Parallelizable with other tasks at the same level
- `[ ]`: Not started | `[x]`: Completed
- Dependencies listed explicitly per task

---

## Workstream 5: Shared Test Helpers (run first — unblocks Workstream 1)

### T-001: Create shared `makeChunk` / `makeEdge` factory module
**User Story**: US-005 | **Satisfies ACs**: AC-US5-01, AC-US5-04 | **Status**: [x] completed

**Test Plan**:
- Given `packages/ingest/src/edges/__test-helpers.ts` is created
- When a test imports `makeChunk()` with no overrides
- Then it returns a valid `Chunk` with all required fields populated with sensible defaults
- When a test imports `makeEdge()` with no overrides
- Then it returns a valid `Edge` with all required fields populated with sensible defaults
- When partial overrides are passed
- Then only the overridden fields differ from defaults

**Steps**:
1. Read `Chunk` and `Edge` type definitions from `@wtfoc/common` to identify required fields
2. Read 2–3 existing `makeChunk`/`makeEdge` definitions (e.g., `composite.test.ts`, `merge.test.ts`, `heuristic.test.ts`) to capture the superset of used parameters
3. Create `packages/ingest/src/edges/__test-helpers.ts` exporting `makeChunk(overrides?: Partial<Chunk>): Chunk` and `makeEdge(overrides?: Partial<Edge>): Edge`
4. Confirm the file is NOT re-exported from `packages/ingest/src/index.ts`
5. Run `pnpm --filter @wtfoc/ingest test` to confirm the new module compiles cleanly

---

### T-002: Migrate 5+ edge test files to use shared helpers
**User Story**: US-005 | **Satisfies ACs**: AC-US5-02, AC-US5-03 | **Status**: [x] completed
**Depends on**: T-001

**Test Plan**:
- Given each migrated test file previously defined a local `makeChunk` or `makeEdge`
- When the local definition is removed and replaced with an import from `__test-helpers`
- Then all tests in those files still pass
- When `code.test.ts` needs `makeCodeChunk`
- Then it composes it from the base imported `makeChunk` (not a standalone copy)

**Steps**:
1. Identify the 5+ target files: `composite.test.ts`, `merge.test.ts`, `heuristic.test.ts`, `extractor.test.ts`, `tree-sitter.test.ts`, `llm.test.ts`, plus `segment-builder.test.ts`
2. For each file: add `import { makeChunk, makeEdge } from "./__test-helpers.js"`, remove local factory definition, run file-level tests
3. In `code.test.ts`: refactor `makeCodeChunk` to compose via `makeChunk({ ...overrides })` from the shared import
4. Run `pnpm --filter @wtfoc/ingest test` — all tests must pass

---

## Workstream 1: Deduplicate Edge Extraction Tests [P]

### T-003: Remove redundant fail-open/abort tests from `tree-sitter.test.ts`
**User Story**: US-002 | **Satisfies ACs**: AC-US2-02, AC-US2-05 | **Status**: [x] completed
**Depends on**: T-002 (shared helpers migration may touch this file)

**Test Plan**:
- Given `tree-sitter-client.test.ts` already owns transport-level fail-open and abort tests
- When duplicate tests are removed from `tree-sitter.test.ts`
- Then `tree-sitter.test.ts` still covers: extension-to-language mapping, sourceType filtering, edge field mapping, and concurrency
- And `pnpm --filter @wtfoc/ingest test` passes with no net reduction in tested behaviors

**Steps**:
1. Read `packages/ingest/src/edges/tree-sitter.test.ts` and `tree-sitter-client.test.ts` in full
2. Identify the duplicated "sidecar unreachable" fail-open test and any duplicated abort tests in `tree-sitter.test.ts`
3. Remove those tests from `tree-sitter.test.ts`
4. Add an ownership comment header to `tree-sitter.test.ts`: what it tests and what it delegates
5. Add a matching ownership comment to `tree-sitter-client.test.ts`
6. Run `pnpm --filter @wtfoc/ingest test`

---

### T-004: Simplify merge-verification test in `composite.test.ts`
**User Story**: US-002 | **Satisfies ACs**: AC-US2-03, AC-US2-05 | **Status**: [x] completed
**Depends on**: T-002 (shared helpers migration may touch this file)

**Test Plan**:
- Given `merge.test.ts` already owns evidence concatenation and confidence-boost math assertions
- When the "merges and deduplicates edges from multiple extractors" test in `composite.test.ts` is simplified
- Then it only verifies that `CompositeEdgeExtractor` delegates to merge (provenance field is non-empty, not re-tests math)
- And `merge.test.ts` remains the sole owner of merge algorithm assertions

**Steps**:
1. Read `packages/ingest/src/edges/composite.test.ts` (focus on lines ~58–75) and `merge.test.ts` in full
2. Refactor the merge-verification test to assert only: provenance exists on merged edges (delegation check)
3. Add ownership comment headers to both `composite.test.ts` and `merge.test.ts`
4. Run `pnpm --filter @wtfoc/ingest test`

---

### T-005: Replace duplicate manifest-parsing tests in `code.test.ts` with delegation check
**User Story**: US-002 | **Satisfies ACs**: AC-US2-04, AC-US2-05 | **Status**: [x] completed
**Depends on**: T-002 (shared helpers migration may touch this file)

**Test Plan**:
- Given `dependency-parser.test.ts` owns all `package.json` and `requirements.txt` parsing unit tests
- When duplicate "extracts package.json/requirements.txt dependencies" tests are removed from `code.test.ts`
- Then a single replacement "delegates to dependency parser for manifests" test verifies routing only (edge count and type, not field values)
- And `pnpm --filter @wtfoc/ingest test` passes

**Steps**:
1. Read `packages/ingest/src/edges/code.test.ts` (focus on lines ~160–179) and `dependency-parser.test.ts` in full
2. Remove the two duplicate manifest tests from `code.test.ts`
3. Add one "delegates to dependency parser for manifests" test asserting `edges.length > 0` and at least one edge's `type` or `source` indicates manifest routing
4. Add ownership comment headers to both `code.test.ts` and `dependency-parser.test.ts`
5. Run `pnpm --filter @wtfoc/ingest test`

---

## Workstream 2: Replace Over-Mocked Search/Trace Tests [P]

### T-006: Create `deterministicEmbedder` and `hashEmbedder` helpers in `packages/search/src/test-helpers.ts`
**User Story**: US-001 | **Satisfies ACs**: AC-US1-06 | **Status**: [x] completed

**Test Plan**:
- Given `deterministicEmbedder(mapping)` is called with a string-to-vector map
- When `embed(text)` is called with a key in the map
- Then it returns the mapped vector as `Float32Array`
- When `embed(text)` is called with an unknown key
- Then it throws a descriptive error (not silently wrong)
- Given `hashEmbedder(dimensions)` is created
- When `embed(text)` is called with any string
- Then it returns a deterministic unit `Float32Array` of the specified length

**Steps**:
1. Check if `packages/search/src/test-helpers.ts` already exists; if so, read it first
2. Create or append to `packages/search/src/test-helpers.ts`:
   - `deterministicEmbedder(mapping: Record<string, number[]>): Embedder`
   - `hashEmbedder(dimensions: number): Embedder` (deterministic hash of text → unit vector)
3. Run `pnpm --filter @wtfoc/search test` to confirm the module compiles

---

### T-007: Replace `createMockIndex` with `InMemoryVectorIndex` in `query.test.ts`
**User Story**: US-001 | **Satisfies ACs**: AC-US1-01, AC-US1-03, AC-US1-04, AC-US1-05 | **Status**: [x] completed
**Depends on**: T-006

**Test Plan**:
- Given `query.test.ts` uses `InMemoryVectorIndex` with hand-crafted 3D vectors
- When "returns ranked results with scores" runs with vectors `[1,0,0]`, `[0.7,0.7,0]`, `[0,0,1]` and query `[1,0,0]`
- Then the `[1,0,0]` entry scores highest (real cosine similarity, not canned)
- When "filters by minScore" runs with a known similarity gap between vectors
- Then only entries with real similarity >= `minScore` are returned
- When all other tests (topK, empty, abort) run
- Then they pass without behavioral regression
- When the file is searched for `createMockIndex`
- Then zero occurrences remain

**Steps**:
1. Read `packages/search/src/query.test.ts` in full
2. Read `packages/search/src/index/in-memory.ts` to understand `InMemoryVectorIndex` API
3. Replace `createMockIndex` usages with `new InMemoryVectorIndex()` (or its constructor pattern)
4. Redesign "returns ranked results" test with geometrically obvious 3D vectors as described above
5. Redesign "filters by minScore" test using vectors with a clear cosine similarity gap
6. Port topK, empty, and abort tests to the real index
7. Delete the `createMockIndex` function
8. Run `pnpm --filter @wtfoc/search test`

---

### T-008: Replace `createMockIndex` with `InMemoryVectorIndex` in `trace.test.ts`
**User Story**: US-001 | **Satisfies ACs**: AC-US1-02, AC-US1-05, AC-US1-06 | **Status**: [x] completed
**Depends on**: T-006

**Test Plan**:
- Given `trace.test.ts` uses `InMemoryVectorIndex` with the `hashEmbedder`
- When edge traversal tests run
- Then they pass (edge following is vector-independent)
- When the semantic fallback test ("fills underrepresented source types") runs
- Then it passes using real cosine similarity
- When the file is searched for `createMockIndex`
- Then zero occurrences remain

**Steps**:
1. Read `packages/search/src/trace.test.ts` in full
2. Replace all `createMockIndex` usages with `InMemoryVectorIndex` instantiation
3. Use `hashEmbedder` from `test-helpers.ts` for embedder-driven tests
4. For the semantic fallback test: tune embedded vectors so the expected ranking is geometrically obvious (document in a comment why vectors were chosen)
5. Delete the `createMockIndex` function from the file
6. Run `pnpm --filter @wtfoc/search test`

---

## Workstream 3: Add True Ingest-Through-HTTP E2E Test

### T-009: Refactor `serve.ts` to return server instance and throw on error
**User Story**: US-003 | **Satisfies ACs**: AC-US3-05 | **Status**: [x] completed

**Test Plan**:
- Given `startServer()` is called in a test with port 0 and a valid in-memory store
- When `startServer()` resolves
- Then it returns `{ server: http.Server, state: LoadedState }` without calling `process.exit`
- When `startServer()` is called with a missing collection
- Then it throws an `Error` (no `process.exit`)
- When the CLI's `commands/serve.ts` calls `startServer()` and it throws
- Then the command handler catches it and calls `process.exit(1)` (CLI behavior preserved)

**Steps**:
1. Read `packages/cli/src/serve.ts` in full
2. Read `packages/cli/src/commands/serve.ts` in full
3. Change `startServer` signature: return type becomes `Promise<{ server: import("node:http").Server; state: LoadedState }>`
4. Replace all `process.exit()` calls in `serve.ts` with `throw new Error(...)`
5. Return `{ server, state }` at the end of `startServer`
6. In `commands/serve.ts`: wrap `startServer` call in `try/catch`, call `process.exit(1)` in catch block
7. Run `pnpm --filter @wtfoc/cli build` to confirm TypeScript compiles
8. Run `pnpm --filter @wtfoc/cli test` (existing tests must pass)

---

### T-010: Write HTTP E2E test in `packages/cli/src/serve.test.ts`
**User Story**: US-003 | **Satisfies ACs**: AC-US3-01, AC-US3-02, AC-US3-03, AC-US3-04, AC-US3-05 | **Status**: [x] completed
**Depends on**: T-009

**Test Plan**:
- Given a server started via `startServer()` on port 0 with a seeded in-memory store
- When `GET /api/status` is called
- Then response is 200 with collection metadata JSON
- When `GET /api/query?q=<text>` is called
- Then response is 200 with a results array
- When `GET /api/trace?q=<text>` is called
- Then response is 200 with a trace structure
- When `GET /api/collections` is called
- Then response is 200 with an array listing the collection
- When `GET /nonexistent` is called
- Then response is 404
- When `OPTIONS /api/query` is called
- Then response includes `Access-Control-Allow-Origin` header

**Steps**:
1. Read `tests/e2e/tests/api/ingest-query.test.ts` to understand the existing E2E pattern
2. Read `tests/e2e/helpers/seed.ts` and `tests/e2e/helpers/embedder.ts`
3. Create `packages/cli/src/serve.test.ts`
4. In `beforeAll`: create an in-memory store with `createStore`, seed one collection, call `startServer({ port: 0, ... })`; capture the actual port from `server.address()`
5. Write one `it` block per endpoint listed in the test plan
6. In `afterAll`: call `server.close()` on the returned server
7. Run `pnpm --filter @wtfoc/cli test`

---

## Workstream 4: Tighten Adapter Assertions [P]

### T-011: Replace `> 0` assertions in `repo.test.ts` with exact counts and spot checks
**User Story**: US-004 | **Satisfies ACs**: AC-US4-01, AC-US4-02, AC-US4-03, AC-US4-04, AC-US4-05 | **Status**: [x] completed

**Test Plan**:
- Given `fixtures/test-repo` is stable
- When "yields chunks from a local directory" runs
- Then it asserts the exact chunk count (not `toBeGreaterThan(0)`)
- When "produces code chunks for .ts files" runs
- Then it asserts exact count AND validates one chunk's `content` substring and `metadata.language`
- When "produces markdown chunks for .md files" runs
- Then it asserts exact count AND validates one chunk's content substring
- When "includes filePath and repo in metadata" runs
- Then it validates a specific expected `filePath` from the fixture (not `toBeTruthy()`)

**Steps**:
1. Read `packages/ingest/src/adapters/repo.test.ts` in full
2. Read the `fixtures/test-repo` directory structure
3. Run `pnpm --filter @wtfoc/ingest test -- --reporter=verbose repo` to capture actual counts
4. Replace every `toBeGreaterThan(0)` with `toBe(N)` using the captured values
5. Add one content/metadata spot-check per test block
6. Add comment: `// If test-repo fixture changes, update counts: run pnpm --filter @wtfoc/ingest test -- repo and capture new values`
7. Run `pnpm --filter @wtfoc/ingest test -- repo` to confirm all assertions pass

---

### T-012: Replace `> 0` assertions in `discord.test.ts` with exact counts and spot checks
**User Story**: US-004 | **Satisfies ACs**: AC-US4-01 (by analogy for discord adapter) | **Status**: [x] completed

**Test Plan**:
- Given `discord.test.ts` has 3 `toBeGreaterThan(0)` instances for edge counts
- When replaced with exact counts plus spot-checks
- Then `pnpm --filter @wtfoc/ingest test -- discord` passes

**Steps**:
1. Read `packages/ingest/src/adapters/discord.test.ts` in full
2. Run the test to capture actual counts
3. Replace each `toBeGreaterThan(0)` with `toBe(N)` and add one specific edge target spot-check per assertion
4. Run `pnpm --filter @wtfoc/ingest test -- discord` to confirm

---

### T-013: Replace `> 0` assertion in `github.test.ts` with exact count and spot check
**User Story**: US-004 | **Satisfies ACs**: AC-US4-01 (by analogy for github adapter) | **Status**: [x] completed

**Test Plan**:
- Given `github.test.ts` has 1 `toBeGreaterThan(0)` instance
- When replaced with exact count and a spot-check
- Then `pnpm --filter @wtfoc/ingest test -- github` passes

**Steps**:
1. Read `packages/ingest/src/adapters/github.test.ts` in full
2. Run the test to capture the actual count
3. Replace the `toBeGreaterThan(0)` with `toBe(N)` and add one specific field spot-check
4. Run `pnpm --filter @wtfoc/ingest test -- github` to confirm

---

## Final Verification

### T-014: Full test suite and lint pass
**User Story**: US-001, US-002, US-003, US-004, US-005 | **Satisfies ACs**: All | **Status**: [x] completed
**Depends on**: T-001 through T-013

**Test Plan**:
- Given all workstream tasks are complete
- When `pnpm test` runs across all packages
- Then every test passes with zero failures
- When `pnpm lint:fix` runs
- Then no lint errors remain

**Steps**:
1. Run `pnpm test` from monorepo root
2. Run `pnpm lint:fix` from monorepo root
3. Fix any remaining failures before marking complete
4. Verify success criteria from spec.md:
   - No `createMockIndex` with canned scores remaining in `query.test.ts` or `trace.test.ts`
   - `makeChunk`/`makeEdge` definitions reduced from 8+ to ≤3 total across the edge package
   - `serve.test.ts` exists and covers at least `GET /api/status`, `GET /api/query`, `GET /nonexistent`
   - Exact `toBe(N)` count assertions in `repo.test.ts`, `discord.test.ts`, `github.test.ts`
