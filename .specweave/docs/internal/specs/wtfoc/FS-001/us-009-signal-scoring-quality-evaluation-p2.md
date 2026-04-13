---
id: US-009
feature: FS-001
title: "Signal scoring quality evaluation (P2)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-009: Signal scoring quality evaluation (P2)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** signal scoring metrics that evaluate the HeuristicChunkScorer's classification distribution across the collection
**So that** I can verify signal-based query boosting has meaningful data to work with and detect scoring regressions

---

## Acceptance Criteria

- [x] **AC-US9-01**: The signal evaluator runs `HeuristicChunkScorer` from `@wtfoc/ingest` against all chunks and reports per-signal-type distribution (pain, praise, feature_request, workaround, question)
- [x] **AC-US9-02**: Reports: total chunks scored, chunks with at least one non-zero signal, per-signal-type count and percentage
- [x] **AC-US9-03**: Reports per-source-type signal distribution so developers can see which source types contribute most to each signal
- [x] **AC-US9-04**: Does not require LLM or embedder options (purely heuristic/regex-based)
- [x] **AC-US9-05**: Produces a `SignalEvalReport` typed and JSON-serializable

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
