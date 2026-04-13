---
id: US-001
feature: FS-054
title: "Replace over-mocked search/trace indexes with real InMemoryVectorIndex (P1)"
status: completed
priority: P1
created: 2026-04-13T00:00:00.000Z
tldr: "**As a** developer running the test suite."
project: wtfoc3
---

# US-001: Replace over-mocked search/trace indexes with real InMemoryVectorIndex (P1)

**Feature**: [FS-054](./FEATURE.md)

**As a** developer running the test suite
**I want** `query.test.ts` and `trace.test.ts` to use `InMemoryVectorIndex` with real cosine similarity instead of fake indexes that ignore the query vector
**So that** the tests prove semantic ranking actually works, not just that plumbing passes data through

---

## Acceptance Criteria

- [x] **AC-US1-01**: `query.test.ts` uses `InMemoryVectorIndex` (from `@wtfoc/search`) instead of the inline `createMockIndex` that returns `entries.slice(0, topK)` with canned scores
- [x] **AC-US1-02**: `trace.test.ts` uses `InMemoryVectorIndex` instead of the inline `createMockIndex` with identical canned-score behavior
- [x] **AC-US1-03**: The "returns ranked results with scores" test in `query.test.ts` asserts that a vector closer to the query scores higher than a distant vector (real cosine similarity), not just that `first.score >= second.score` from canned data
- [x] **AC-US1-04**: The "filters by minScore" test validates against real similarity scores, not the fake `1.0 - i * 0.1` progression
- [x] **AC-US1-05**: All existing test assertions in both files continue to pass (no behavioral regressions)
- [x] **AC-US1-06**: The mock embedder may remain (it controls the query vector), but the index must compute real cosine similarity

---

## Implementation

**Increment**: [0054-test-suite-quality](../../../../../increments/0054-test-suite-quality/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

- [x] **T-014**: Full test suite and lint pass
