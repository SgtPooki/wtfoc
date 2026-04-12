---
id: US-007
feature: FS-001
title: "Search and trace quality evaluation (P2)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-007: Search and trace quality evaluation (P2)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** search and trace quality metrics using canned test queries, measuring both semantic retrieval and edge-following traversal
**So that** I can verify wtfoc's core differentiator — trace follows explicit edges across source types with verifiable provenance (vision goals #2, #8)

---

## Acceptance Criteria

- [x] **AC-US7-01**: The search evaluator runs test queries using both `query()` (semantic search) and `trace()` (edge-following traversal) from `@wtfoc/search`
- [x] **AC-US7-02**: Test queries are defined in a fixture file with expected result properties (source type, source substring match) — not exact chunk IDs, since those change across ingests
- [x] **AC-US7-03**: Reports per-query for `query()`: query text, result count, top-result score, whether expected source types appeared in top-K results
- [x] **AC-US7-04**: Reports per-query for `trace()`: total hops, edge hops vs semantic hops, distinct source types reached, insight count (convergence/evidence-chain/temporal-cluster from analytical mode)
- [x] **AC-US7-05**: Reports trace provenance quality: percentage of edge-hops that have non-empty `evidence` and `edgeType` in their `connection` (validates vision goal #8 — evidence you can trust)
- [x] **AC-US7-06**: Reports aggregate: mean reciprocal rank (MRR) for query, source-type coverage for trace (distinct source types reached / total source types in collection), edge-hop ratio (edge hops / total hops — higher means the graph is doing its job)
- [x] **AC-US7-07**: Requires embedder options (`--embedder-url`, `--embedder-model`) with same semantics as the CLI's `withEmbedderOptions` (parsed via `parseArgs` in the script); skippable when not configured
- [x] **AC-US7-08**: Produces a `SearchEvalReport` typed and JSON-serializable

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
