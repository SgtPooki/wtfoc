---
id: US-003
feature: FS-001
title: "Ingest quality evaluation (P1)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-003: Ingest quality evaluation (P1)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** ingest quality metrics that check chunk well-formedness, metadata completeness, and incremental-processing readiness
**So that** I can catch adapter regressions before they corrupt the graph and verify the collection supports minimal re-processing (vision goal #3 — only touch what changed)

---

## Acceptance Criteria

- [x] **AC-US3-01**: The ingest evaluator loads all segments from the collection and inspects every chunk
- [x] **AC-US3-02**: Reports chunk count, source type distribution, and chunks-per-segment distribution
- [x] **AC-US3-03**: Checks metadata completeness: percentage of chunks with `documentId`, `documentVersionId`, and `contentFingerprint` populated (non-null, non-empty) — these three fields are required for incremental re-processing (vision goal #3)
- [x] **AC-US3-04**: Checks chunk sizing: reports min/max/mean/median content length in characters; flags chunks under 50 chars or over 10,000 chars as warnings
- [x] **AC-US3-05**: Checks required fields: every chunk must have non-empty `id`, `content`, `sourceType`, `source`; reports violation count
- [x] **AC-US3-06**: Reports per-source-type completeness breakdown so operators can identify which adapters are lagging on metadata population
- [x] **AC-US3-07**: Produces an `IngestEvalReport` with all metrics above, typed and JSON-serializable

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
