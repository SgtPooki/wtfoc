---
id: US-004
feature: FS-001
title: "Edge extraction quality evaluation (P1)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-004: Edge extraction quality evaluation (P1)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** the existing edge eval harness from PR #204 integrated as the edge extraction stage
**So that** edge quality measurement validates vision goal #4 (rich, trustworthy edges) — LLM extraction precision/recall, acceptance gate behavior, and structured evidence quality — as part of the unified dogfood framework without rewriting existing code

---

## Acceptance Criteria

- [x] **AC-US4-01**: The edge stage delegates to the existing `runEdgeEval()` function from `@wtfoc/ingest` (`packages/ingest/src/edges/eval.ts`)
- [x] **AC-US4-02**: The existing `EvalReport` type is wrapped/mapped into the stage report structure without modifying the original harness code
- [x] **AC-US4-03**: LLM options (`baseUrl`, `model`, `apiKey`, `jsonMode`, `timeoutMs`, `maxConcurrency`, `maxInputTokens`) are forwarded from CLI extractor options to `EvalOptions`
- [x] **AC-US4-04**: The edge stage is skippable when extractor options are not provided (logged as "skipped: no extractor configured" in the unified report)
- [x] **AC-US4-05**: The wrapped report surfaces key vision-aligned metrics at the top level: gated F1 (edge accuracy), gold survival rate (how many real edges survive gates), and coverage (what percentage of fixture chunks were evaluated)

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
