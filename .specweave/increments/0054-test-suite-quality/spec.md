---
increment: 0054-test-suite-quality
title: 'Test suite quality: deduplicate, strengthen mocks, add real E2E'
type: refactor
priority: P1
status: completed
created: 2026-04-13T00:00:00.000Z
structure: user-stories
test_mode: TDD
coverage_target: 80
---

# Feature: Test suite quality: deduplicate, strengthen mocks, add real E2E

## Overview

A Codex peer review of all 70 test files (~960 test blocks) identified structural quality issues: over-mocked search/trace tests that prove plumbing but not ranking, duplicated edge extraction tests across unit/integration boundaries, "API-level" E2E tests that bypass the actual ingest HTTP path, and low-specificity adapter assertions. This increment addresses the HIGH and MEDIUM findings to raise confidence that tests catch real regressions.

## User Stories

### US-001: Replace over-mocked search/trace indexes with real InMemoryVectorIndex (P1)
**Project**: wtfoc3

**As a** developer running the test suite
**I want** `query.test.ts` and `trace.test.ts` to use `InMemoryVectorIndex` with real cosine similarity instead of fake indexes that ignore the query vector
**So that** the tests prove semantic ranking actually works, not just that plumbing passes data through

**Acceptance Criteria**:
- [x] **AC-US1-01**: `query.test.ts` uses `InMemoryVectorIndex` (from `@wtfoc/search`) instead of the inline `createMockIndex` that returns `entries.slice(0, topK)` with canned scores
- [x] **AC-US1-02**: `trace.test.ts` uses `InMemoryVectorIndex` instead of the inline `createMockIndex` with identical canned-score behavior
- [x] **AC-US1-03**: The "returns ranked results with scores" test in `query.test.ts` asserts that a vector closer to the query scores higher than a distant vector (real cosine similarity), not just that `first.score >= second.score` from canned data
- [x] **AC-US1-04**: The "filters by minScore" test validates against real similarity scores, not the fake `1.0 - i * 0.1` progression
- [x] **AC-US1-05**: All existing test assertions in both files continue to pass (no behavioral regressions)
- [x] **AC-US1-06**: The mock embedder may remain (it controls the query vector), but the index must compute real cosine similarity

---

### US-002: Deduplicate edge extraction tests and establish ownership boundaries (P1)
**Project**: wtfoc3

**As a** developer maintaining the edge extraction test suite
**I want** duplicated test behaviors consolidated so each behavior is tested in exactly one place
**So that** refactors don't require updating the same assertion in multiple files and test ownership is clear

**Acceptance Criteria**:
- [x] **AC-US2-01**: JSON parsing of LLM responses is tested ONLY in `llm-client.test.ts` (unit tests for `parseJsonResponse`); the `llm.test.ts` "handles fenced JSON block response" test is removed or refactored to test only the LlmEdgeExtractor orchestration path, not JSON parsing itself
- [x] **AC-US2-02**: Transport fail-open behavior is tested ONLY in `tree-sitter-client.test.ts` (unit tests for the HTTP client); duplicated fail-open tests in `tree-sitter.test.ts` are removed or refactored to test only TreeSitterEdgeExtractor-level behavior
- [x] **AC-US2-03**: Edge merge/dedup logic is tested ONLY in `merge.test.ts`; the duplicate merge assertion in `composite.test.ts` (lines ~58-75) is refactored to verify CompositeEdgeExtractor delegates to merge correctly, not re-test the merge algorithm
- [x] **AC-US2-04**: Dependency manifest parsing (package.json, requirements.txt) is tested ONLY in `dependency-parser.test.ts`; duplicated dependency parsing tests in `code.test.ts` (lines ~160-179) are removed, and `code.test.ts` tests only CodeEdgeExtractor routing/dispatch
- [x] **AC-US2-05**: Each test file has a comment header documenting its ownership boundary (what it tests and what it delegates to other files)
- [x] **AC-US2-06**: No net reduction in behavior coverage — every currently tested behavior remains tested in exactly one location

---

### US-003: Add real server HTTP E2E coverage (P1)
**Project**: wtfoc3

**As a** developer verifying the CLI server's public HTTP surface end-to-end
**I want** at least one E2E test that starts the real server and exercises the read/query endpoints against a seeded collection
**So that** server startup, route wiring, and response behavior are proven under real HTTP conditions

**Note**: `serve.ts` does not yet expose an ingest endpoint, so this E2E coverage targets the read-only API.

**Acceptance Criteria**:
- [x] **AC-US3-01**: A new E2E test file starts the real server and verifies query/read responses over HTTP for a seeded collection
- [x] **AC-US3-02**: Test setup seeds fixture data directly through storage/manifests before serving, and the test verifies the HTTP API can read that data end-to-end
- [x] **AC-US3-03**: The test validates HTTP behavior for the currently exposed read-only routes (status, query, trace, collections, sources, edges, CORS, 404)
- [x] **AC-US3-04**: The increment documents that `serve.ts` does not yet expose an ingest endpoint, so coverage targets the read-only API
- [x] **AC-US3-05**: The test uses the refactored `startServer` which returns a `ServerHandle` for testability

---

### US-004: Tighten adapter test assertions with golden fixtures (P2)
**Project**: wtfoc3

**As a** developer changing adapter normalization logic
**I want** `repo.test.ts` adapter assertions to validate exact normalized outputs against golden fixtures instead of `> 0` checks
**So that** regressions in chunking, metadata extraction, or normalization are caught immediately

**Acceptance Criteria**:
- [x] **AC-US4-01**: The "yields chunks from a local directory" test asserts an exact expected chunk count for the test-repo fixture, not just `> 0`
- [x] **AC-US4-02**: The "produces code chunks for .ts files" test asserts the expected number of code chunks and validates at least one chunk's `content` substring and `metadata.language` value against golden data
- [x] **AC-US4-03**: The "produces markdown chunks for .md files" test validates exact count and at least one chunk's content substring
- [x] **AC-US4-04**: The "includes filePath and repo in metadata" test validates specific expected filePath values from the fixture, not just `toBeTruthy()`
- [x] **AC-US4-05**: A comment documents how to update golden values if the test-repo fixture changes

---

### US-005: Extract shared test helpers for edge test files (P2)
**Project**: wtfoc3

**As a** developer writing new edge extractor tests
**I want** common `makeChunk` and `makeEdge` factory functions in a shared test helper module
**So that** new edge tests don't re-invent the same factories and existing tests are DRY

**Acceptance Criteria**:
- [x] **AC-US5-01**: A shared `packages/ingest/src/edges/__test-helpers.ts` (or similar) module exports `makeChunk` and `makeEdge` factories with sensible defaults and override support
- [x] **AC-US5-02**: At least 5 of the 8+ edge test files that define local `makeChunk`/`makeEdge` are migrated to use the shared helper
- [x] **AC-US5-03**: Tests that need specialized chunk shapes (e.g., `makeCodeChunk` in `code.test.ts`) may keep local variants but import the base factory for composition
- [x] **AC-US5-04**: The shared helper is test-only (not exported from the package's public API)

## Functional Requirements

### FR-001: InMemoryVectorIndex in unit tests
Replace fake `createMockIndex` implementations in `packages/search/src/query.test.ts` and `packages/search/src/trace.test.ts` with `InMemoryVectorIndex` from `packages/search/src/index/in-memory.ts`. The mock embedder may stay since it controls query vector generation, but the index must perform real cosine similarity ranking.

### FR-002: Test deduplication preserves coverage
When removing duplicate tests, verify that the remaining test (in the "owner" file) covers the same edge cases. Use `pnpm test` pass rate as the gate — zero regressions allowed.

### FR-003: True HTTP ingest E2E
The new E2E test must exercise the actual `/api/collections/:name/ingest` endpoint (or whatever the real ingest path is). If no HTTP ingest endpoint currently exists, document this finding and test the closest available path — but the spec must be updated to reflect reality.

### FR-004: Golden fixture maintenance
Golden assertion values must be derivable from the test-repo fixture. If the fixture changes, the test should fail loudly (exact count mismatch) rather than silently pass with `> 0`.

## Success Criteria

- All tests pass: `pnpm test` green across all packages
- Zero net loss of tested behaviors (behaviors may move between files but not disappear)
- `makeChunk`/`makeEdge` duplication reduced from 8+ definitions to 3 or fewer (shared + specialized variants)
- `query.test.ts` and `trace.test.ts` no longer contain any `createMockIndex` with canned scores
- At least one E2E test exercises real HTTP ingest (not pre-seeded)

## Out of Scope

- Refactoring `mount.test.ts` to be less refactor-hostile (LOW priority, deferred)
- Enhancing Playwright/UI E2E tests beyond smoke checks (LOW priority, deferred — no Playwright tests currently exist in the repo)
- Adding new test coverage for untested code paths (this is a quality improvement of existing tests, not a coverage expansion)
- Changing production code (this is test-only; production code changes only if needed to expose test seams)

## Dependencies

- `InMemoryVectorIndex` from `packages/search/src/index/in-memory.ts` must be importable in test files (already is)
- Test-repo fixture at `fixtures/test-repo` must be stable for golden assertions
- Existing E2E helpers (`startServer`, `seedCollection`) in `tests/e2e/helpers/`
