---
id: US-005
feature: FS-001
title: "Edge resolution quality evaluation (P1)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-005: Edge resolution quality evaluation (P1)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** resolution metrics showing what percentage of edges resolve to real chunks and how many cross source-type boundaries
**So that** I can track whether the graph enables cross-cutting answers (vision goal #2) — baseline resolution rate is ~23% per #193, and cross-source density directly measures the graph's ability to connect siloed knowledge

---

## Acceptance Criteria

- [x] **AC-US5-01**: The resolution evaluator reuses `analyzeEdgeResolution()` and `buildSourceIndex()` from `@wtfoc/search` (same logic as the `unresolved-edges` CLI command)
- [x] **AC-US5-02**: Reports: `totalEdges`, `resolvedEdges`, `bareRefs`, `unresolvedEdges`, `resolutionRate` (resolved / total), `bareRefRate`
- [x] **AC-US5-03**: Reports cross-source edge density: number of edges whose sourceId source type differs from their resolved target's source type, divided by total resolved edges — this is the key metric for vision goal #2
- [x] **AC-US5-04**: Reports top-10 unresolved target repos (same as `unresolved-edges --limit 10` output)
- [x] **AC-US5-05**: Reports source-type pair distribution for resolved cross-source edges (e.g., `github-issue -> code: 42`, `slack-message -> github-pr: 17`) to show which source boundaries the graph bridges
- [x] **AC-US5-06**: Produces a `ResolutionEvalReport` typed and JSON-serializable

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
