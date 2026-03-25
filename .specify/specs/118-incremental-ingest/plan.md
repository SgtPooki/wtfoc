# Implementation Plan: Incremental Ingest Pipeline

**Branch**: `118-incremental-ingest` | **Date**: 2026-03-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from [spec.md](spec.md)

## Summary

Add per-source cursor persistence so re-running `wtfoc ingest` automatically resumes from the last successful position, skip already-indexed segments when mounting collections into persistent vector backends, and optimize `reindex --rechunk` to only re-process oversized chunks. Follows the existing extraction-status sidecar file pattern for cursor storage.

## Technical Context

**Language/Version**: TypeScript (strict, ESM-only), Node >= 24
**Primary Dependencies**: @wtfoc/common (interfaces), @wtfoc/ingest (adapters, chunker), @wtfoc/store (manifest, storage), @wtfoc/search (mount, vector index), commander (CLI)
**Storage**: Local filesystem (JSON sidecar files alongside manifests), optional FOC/Qdrant
**Testing**: vitest (unit + integration), in-memory backends for unit tests
**Target Platform**: CLI (Node.js)
**Project Type**: CLI + library monorepo (pnpm workspaces)
**Performance Goals**: Incremental ingest of unchanged source completes in < 5s; segment skip on mount is O(1) lookup per segment
**Constraints**: Single writer per collection (existing), AbortSignal on all async ops, no `any`
**Scale/Scope**: Collections with 100s of segments, 10K+ chunks, multiple sources per collection

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| I. Credible Exit | PASS | Cursor store follows ManifestStore pattern — swappable interface. No new lock-in. |
| II. Standalone Packages | PASS | Cursor logic in @wtfoc/ingest (where adapters live), mount changes in @wtfoc/search. No circular deps. |
| III. Backend-Neutral Identity | PASS | Cursors use source-provided timestamps, not backend-specific IDs. |
| IV. Immutable Data, Mutable Index | PASS | Cursors are mutable index state (like manifests). Segments remain immutable. |
| V. Edges Are First-Class | N/A | No edge changes. |
| VI. Test-First | PASS | Tests planned for cursor store, incremental mount, partial rechunk. |
| VII. Bundle Uploads | N/A | No upload changes. |
| VIII. Ship-First | PASS | Minimal changes to existing interfaces. Incremental value per story. |

## Project Structure

### Documentation (this feature)

```text
specs/118-incremental-ingest/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
packages/
├── common/src/
│   └── interfaces/
│       └── source-adapter.ts       # Add optional CursorInfo to adapter interface
├── ingest/src/
│   ├── cursor-store.ts             # NEW: read/write cursor sidecar files
│   └── adapters/
│       ├── github/adapter.ts       # Use cursor for since param
│       └── repo/adapter.ts         # Use cursor for filesystem mtime
├── search/src/
│   └── mount.ts                    # Skip already-indexed segments
├── store/src/
│   └── manifest/local.ts           # (no changes — cursor is separate sidecar)
├── cli/src/commands/
│   ├── ingest.ts                   # Wire cursor read/write around adapter.ingest()
│   └── reindex.ts                  # Partial rechunk: skip chunks within size limit
└── tests matching each change
```

**Structure Decision**: All changes fit within existing package boundaries. Cursor store follows the same sidecar-file pattern as extraction-status.ts in @wtfoc/ingest. No new packages needed.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
