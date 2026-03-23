# Implementation Plan: E2E Integration Pipeline

**Branch**: `012-e2e-integration-pipeline` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/012-e2e-integration-pipeline/spec.md`

## Summary

Add a single integration test file that exercises the full wtfoc pipeline end-to-end: ingest synthetic markdown → chunk → embed (mock) → extract edges → build segment → store → update CollectionHead → mount (reload from storage) → query → trace. Uses local storage, in-memory vector index, and a deterministic mock embedder. No production code changes.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >=24
**Primary Dependencies**: `@wtfoc/common`, `@wtfoc/ingest`, `@wtfoc/store`, `@wtfoc/search` (workspace packages only)
**Storage**: LocalStorageBackend + LocalManifestStore (temp directories, cleaned up after tests)
**Testing**: vitest — file must live under `packages/*/src/**/*.test.ts`
**Target Platform**: Node.js
**Project Type**: Integration test (test-only, no production code changes)
**Performance Goals**: All tests complete under 5 seconds
**Constraints**: Mock/deterministic embedder (no model downloads), no network calls, no FOC interaction
**Scale/Scope**: Small synthetic fixtures (a few markdown strings), single test file

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | N/A | Test only — no seam changes |
| II. Standalone Packages | PASS | Test imports from published package APIs only |
| III. Backend-Neutral Identity | PASS | Uses local backend, backend-neutral IDs |
| IV. Immutable Data, Mutable Index | N/A | Test only — validates existing behavior |
| V. Edges Are First-Class | PASS | Tests edge extraction and trace traversal |
| VI. Test-First | PASS | This IS the test |
| VII. Bundle Uploads | N/A | Local storage path, no bundling |
| VIII. Hackathon-First | PASS | Proves the demo pipeline works end-to-end |

**No violations. Gate passed.**

## Project Structure

### Documentation (this feature)

```text
specs/012-e2e-integration-pipeline/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── quickstart.md        # Phase 1 output
└── checklists/
    └── requirements.md  # Quality checklist
```

### Source Code (repository root)

```text
packages/store/src/
└── e2e-pipeline.test.ts    # The integration test file
```

**Structure Decision**: Test lives in `@wtfoc/store` because store is the central package that connects ingest (peer dep) and search (peer dep). The test file follows the `packages/*/src/**/*.test.ts` pattern required by the root vitest config.

## Phase 0: Research (COMPLETED)

No unknowns. All APIs are known from the existing codebase:
- `chunkMarkdown`, `RegexEdgeExtractor`, `buildSegment`, `segmentId` from `@wtfoc/ingest`
- `LocalStorageBackend`, `LocalManifestStore`, `createCollectionHead`, `validateManifestSchema`, `deserializeSegment` from `@wtfoc/store`
- `mountCollection`, `query`, `trace`, `InMemoryVectorIndex` from `@wtfoc/search`

Mock embedder approach: simple deterministic function that hashes content to produce fixed-dimension vectors. Same content → same vector → consistent ranking across runs.

## Phase 1: Design & Contracts

### Data Model

None — this feature uses existing types only (CollectionHead, Segment, etc.).

### Contracts

None — this feature adds no public interfaces.

### Quickstart

None — this is a test file, not a user-facing feature.

## Post-Design Constitution Re-check

All gates still pass. No production code changes, no seam modifications.

## Complexity Tracking

No violations. No complexity justifications needed.
