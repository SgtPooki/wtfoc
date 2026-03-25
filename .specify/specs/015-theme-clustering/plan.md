# Implementation Plan: Theme Clustering

**Branch**: `015-theme-clustering` | **Date**: 2026-03-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/015-theme-clustering/spec.md`

## Summary

Add a pluggable `Clusterer` interface to `@wtfoc/common` and an ANN-based incremental implementation in `@wtfoc/search` that discovers theme clusters from stored chunk embeddings. Cluster state is persisted in `~/.wtfoc/clusters/` as a mutable derived artifact. New `wtfoc themes` CLI command surfaces clusters with evidence-rich output including exemplar chunks, source distribution, and signal score aggregates.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >=24
**Primary Dependencies**: `@wtfoc/common` (interface), `@wtfoc/search` (implementation), `@wtfoc/cli` (command)
**Storage**: Cluster state as JSON files in `~/.wtfoc/clusters/{collection}/{revision}/state.json`
**Testing**: vitest, synthetic fixtures, no network calls
**Target Platform**: Node.js CLI + web server API
**Project Type**: monorepo library packages + CLI application
**Performance Goals**: <60s initial batch (26K chunks), <10s incremental (<500 new chunks)
**Constraints**: No OOM at 50K+ chunks, algorithm-neutral interface, no new heavy dependencies for MVP
**Scale/Scope**: Collections up to 50K+ chunks, 384-768 dimensional embeddings

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | PASS | `Clusterer` interface in `@wtfoc/common` (FR-001). Algorithm-neutral contract (FR-003). |
| II. Standalone Packages | PASS | Interface in `common`, implementation in `search`, CLI wiring in `cli`. No circular deps. |
| III. Backend-Neutral Identity | N/A | Cluster state uses collection IDs, not CIDs. |
| IV. Immutable Data, Mutable Index | PASS | Segments untouched. Cluster state is a separate mutable artifact (FR-013). |
| V. Edges Are First-Class | PASS | Clusters expose edge evidence when available (FR-005). |
| VI. Test-First | PASS | Tests use synthetic fixtures, no network calls. |
| VII. Bundle Uploads | N/A | Clustering doesn't upload to FOC. |
| VIII. Hackathon-First, Future-Aware | PASS | Working CLI command + clean interface for future implementations. |
| Spec-First Development | PASS | Spec written, clarified, and reviewed before implementation. |
| SPEC.md update required | YES | Add `Clusterer` to seam list (FR-016). |

No violations. Gate passes.

## Project Structure

### Documentation (this feature)

```text
specs/015-theme-clustering/
├── spec.md              # Feature specification (done)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── clusterer.ts     # Clusterer interface contract
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
packages/common/src/
└── interfaces/
    └── clusterer.ts              # NEW: Clusterer interface + types

packages/search/src/
└── clustering/
    ├── index.ts                  # Re-exports
    ├── ann-clusterer.ts          # Default ANN-based incremental implementation
    ├── kmeans.ts                 # K-means utility (used internally by ANN for initial seeding)
    └── cluster-state.ts          # ClusterState persistence (read/write JSON)

packages/cli/src/
└── commands/
    └── themes.ts                 # NEW: wtfoc themes command

apps/web/server/
└── index.ts                      # Add /api/collections/:name/themes endpoint
```

**Structure Decision**: Follows existing monorepo pattern. Interface in `common`, implementation in `search/clustering/` subdirectory (same pattern as `trace/`), CLI command in `cli/commands/`.
