---
id: US-004
feature: FS-054
title: "Tighten adapter test assertions with golden fixtures (P2)"
status: completed
priority: P1
created: 2026-04-13T00:00:00.000Z
tldr: "**As a** developer changing adapter normalization logic."
project: wtfoc3
---

# US-004: Tighten adapter test assertions with golden fixtures (P2)

**Feature**: [FS-054](./FEATURE.md)

**As a** developer changing adapter normalization logic
**I want** `repo.test.ts` adapter assertions to validate exact normalized outputs against golden fixtures instead of `> 0` checks
**So that** regressions in chunking, metadata extraction, or normalization are caught immediately

---

## Acceptance Criteria

- [x] **AC-US4-01**: The "yields chunks from a local directory" test asserts an exact expected chunk count for the test-repo fixture, not just `> 0`
- [x] **AC-US4-02**: The "produces code chunks for .ts files" test asserts the expected number of code chunks and validates at least one chunk's `content` substring and `metadata.language` value against golden data
- [x] **AC-US4-03**: The "produces markdown chunks for .md files" test validates exact count and at least one chunk's content substring
- [x] **AC-US4-04**: The "includes filePath and repo in metadata" test validates specific expected filePath values from the fixture, not just `toBeTruthy()`
- [x] **AC-US4-05**: A comment documents how to update golden values if the test-repo fixture changes

---

## Implementation

**Increment**: [0054-test-suite-quality](../../../../../increments/0054-test-suite-quality/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

- [x] **T-014**: Full test suite and lint pass
