---
id: US-008
feature: FS-001
title: "Themes/clustering quality evaluation (P2)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-008: Themes/clustering quality evaluation (P2)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** theme/clustering quality metrics that evaluate cluster coherence, LLM label accuracy, and noise categorization
**So that** I can verify the semantic understanding layer produces meaningful groupings for collection exploration

---

## Acceptance Criteria

- [x] **AC-US8-01**: The themes evaluator runs `GreedyClusterer` from `@wtfoc/search` against loaded chunks and reports cluster count, min/max/mean cluster size, and noise chunk count
- [ ] **AC-US8-02**: (DEFERRED) Reports intra-cluster cohesion: mean pairwise cosine similarity within each cluster (higher = more coherent clusters)
- [x] **AC-US8-03**: Reports source-type diversity per cluster: how many distinct source types appear in each cluster (cross-source clusters are more valuable)
- [ ] **AC-US8-04**: (DEFERRED) When extractor options are provided, runs LLM labeling via `labelClusters()` and reports: label count, duplicate label rate, mean label length
- [x] **AC-US8-05**: Skippable when embedder options are not configured (clustering requires embeddings)
- [x] **AC-US8-06**: Produces a `ThemesEvalReport` typed and JSON-serializable

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
