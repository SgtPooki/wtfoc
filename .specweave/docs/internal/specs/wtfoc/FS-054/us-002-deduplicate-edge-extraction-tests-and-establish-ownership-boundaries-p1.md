---
id: US-002
feature: FS-054
title: "Deduplicate edge extraction tests and establish ownership boundaries (P1)"
status: completed
priority: P1
created: 2026-04-13T00:00:00.000Z
tldr: "**As a** developer maintaining the edge extraction test suite."
project: wtfoc3
---

# US-002: Deduplicate edge extraction tests and establish ownership boundaries (P1)

**Feature**: [FS-054](./FEATURE.md)

**As a** developer maintaining the edge extraction test suite
**I want** duplicated test behaviors consolidated so each behavior is tested in exactly one place
**So that** refactors don't require updating the same assertion in multiple files and test ownership is clear

---

## Acceptance Criteria

- [x] **AC-US2-01**: JSON parsing of LLM responses is tested ONLY in `llm-client.test.ts` (unit tests for `parseJsonResponse`); the `llm.test.ts` "handles fenced JSON block response" test is removed or refactored to test only the LlmEdgeExtractor orchestration path, not JSON parsing itself
- [x] **AC-US2-02**: Transport fail-open behavior is tested ONLY in `tree-sitter-client.test.ts` (unit tests for the HTTP client); duplicated fail-open tests in `tree-sitter.test.ts` are removed or refactored to test only TreeSitterEdgeExtractor-level behavior
- [x] **AC-US2-03**: Edge merge/dedup logic is tested ONLY in `merge.test.ts`; the duplicate merge assertion in `composite.test.ts` (lines ~58-75) is refactored to verify CompositeEdgeExtractor delegates to merge correctly, not re-test the merge algorithm
- [x] **AC-US2-04**: Dependency manifest parsing (package.json, requirements.txt) is tested ONLY in `dependency-parser.test.ts`; duplicated dependency parsing tests in `code.test.ts` (lines ~160-179) are removed, and `code.test.ts` tests only CodeEdgeExtractor routing/dispatch
- [x] **AC-US2-05**: Each test file has a comment header documenting its ownership boundary (what it tests and what it delegates to other files)
- [x] **AC-US2-06**: No net reduction in behavior coverage — every currently tested behavior remains tested in exactly one location

---

## Implementation

**Increment**: [0054-test-suite-quality](../../../../../increments/0054-test-suite-quality/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

- [x] **T-014**: Full test suite and lint pass
