---
id: US-006
feature: FS-001
title: "Storage quality evaluation (P2)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-006: Storage quality evaluation (P2)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** storage integrity checks covering segments, derived edge layers, and the document catalog
**So that** I can detect data corruption or inconsistency before it affects search results, and verify the collection's immutable, content-addressed storage is sound (vision goals #5 portable knowledge, #7 credible exit)

---

## Acceptance Criteria

- [x] **AC-US6-01**: Verifies every segment referenced in the manifest can be downloaded and parsed as valid JSON with expected `Segment` shape (has `id`, `chunks` array, `edges` array)
- [x] **AC-US6-02**: Reports segment count, total chunk count across segments, and total edge count across segments
- [x] **AC-US6-03**: If a derived edge layer overlay file exists (from `extract-edges`), checks that every `sourceId` in overlay edges references a chunk that exists in the collection's segments
- [x] **AC-US6-04**: If a document catalog exists, checks that every `documentId` entry references chunk IDs that exist in segments; reports orphaned catalog entries
- [x] **AC-US6-05**: Produces a `StorageEvalReport` typed and JSON-serializable

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
