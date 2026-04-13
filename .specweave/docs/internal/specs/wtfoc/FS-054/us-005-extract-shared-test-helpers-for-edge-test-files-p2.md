---
id: US-005
feature: FS-054
title: "Extract shared test helpers for edge test files (P2)"
status: completed
priority: P1
created: 2026-04-13T00:00:00.000Z
tldr: "**As a** developer writing new edge extractor tests."
project: wtfoc3
---

# US-005: Extract shared test helpers for edge test files (P2)

**Feature**: [FS-054](./FEATURE.md)

**As a** developer writing new edge extractor tests
**I want** common `makeChunk` and `makeEdge` factory functions in a shared test helper module
**So that** new edge tests don't re-invent the same factories and existing tests are DRY

---

## Acceptance Criteria

- [x] **AC-US5-01**: A shared `packages/ingest/src/edges/__test-helpers.ts` (or similar) module exports `makeChunk` and `makeEdge` factories with sensible defaults and override support
- [x] **AC-US5-02**: At least 5 of the 8+ edge test files that define local `makeChunk`/`makeEdge` are migrated to use the shared helper
- [x] **AC-US5-03**: Tests that need specialized chunk shapes (e.g., `makeCodeChunk` in `code.test.ts`) may keep local variants but import the base factory for composition
- [x] **AC-US5-04**: The shared helper is test-only (not exported from the package's public API)

---

## Implementation

**Increment**: [0054-test-suite-quality](../../../../../increments/0054-test-suite-quality/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
