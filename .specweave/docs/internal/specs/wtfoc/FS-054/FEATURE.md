---
id: FS-054
title: "Test suite quality: deduplicate, strengthen mocks, add real E2E"
type: feature
status: completed
priority: P1
created: 2026-04-13T00:00:00.000Z
lastUpdated: 2026-04-13
tldr: "A Codex peer review of all 70 test files (~960 test blocks) identified structural quality issues: over-mocked search/trace tests that prove plumbing but not ranking, duplicated edge extraction tests across unit/integration boundaries, 'API-level' E2E tests that bypass the actual ingest HTTP path, and low-specificity adapter assertions."
complexity: high
stakeholder_relevant: true
external_tools:
  github:
    type: 'milestone'
    id: 7
    url: 'https://github.com/SgtPooki/wtfoc/milestone/7'
---

# Test suite quality: deduplicate, strengthen mocks, add real E2E

## TL;DR

**What**: A Codex peer review of all 70 test files (~960 test blocks) identified structural quality issues: over-mocked search/trace tests that prove plumbing but not ranking, duplicated edge extraction tests across unit/integration boundaries, "API-level" E2E tests that bypass the actual ingest HTTP path, and low-specificity adapter assertions.
**Status**: completed | **Priority**: P1
**User Stories**: 5

![Test suite quality: deduplicate, strengthen mocks, add real E2E illustration](assets/feature-fs-054.jpg)

## Overview

A Codex peer review of all 70 test files (~960 test blocks) identified structural quality issues: over-mocked search/trace tests that prove plumbing but not ranking, duplicated edge extraction tests across unit/integration boundaries, "API-level" E2E tests that bypass the actual ingest HTTP path, and low-specificity adapter assertions. This increment addresses the HIGH and MEDIUM findings to raise confidence that tests catch real regressions.

## Implementation History

| Increment | Status | Completion Date |
|-----------|--------|----------------|
| [0054-test-suite-quality](../../../../../increments/0054-test-suite-quality/spec.md) | ✅ completed | 2026-04-13T00:00:00.000Z |

## User Stories

- [US-001: Replace over-mocked search/trace indexes with real InMemoryVectorIndex (P1)](./us-001-replace-over-mocked-search-trace-indexes-with-real-inmemoryvectorindex-p1.md)
- [US-002: Deduplicate edge extraction tests and establish ownership boundaries (P1)](./us-002-deduplicate-edge-extraction-tests-and-establish-ownership-boundaries-p1.md)
- [US-003: Add true ingest-through-HTTP E2E test (P1)](./us-003-add-true-ingest-through-http-e2e-test-p1.md)
- [US-004: Tighten adapter test assertions with golden fixtures (P2)](./us-004-tighten-adapter-test-assertions-with-golden-fixtures-p2.md)
- [US-005: Extract shared test helpers for edge test files (P2)](./us-005-extract-shared-test-helpers-for-edge-test-files-p2.md)
