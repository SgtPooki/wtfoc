# Implementation Plan: Store Schema Validation Architecture Refactor

**Branch**: `010-store-schema-validation-architecture-refactor` | **Date**: 2026-03-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `.specify/specs/010-store-schema-validation-architecture-refactor/spec.md`

## Summary

Decompose `packages/store/src/schema.ts` into focused internal modules for manifest validation, segment validation, and shared schema helpers while keeping the public `schema.ts` API and current validation behavior unchanged. The existing test suite remains the primary regression contract.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >=24
**Primary Dependencies**: `@wtfoc/common`, `valibot`
**Storage**: N/A - validation-only refactor inside `@wtfoc/store`
**Testing**: Vitest via `pnpm --filter @wtfoc/store test`
**Target Platform**: Node.js library package
**Project Type**: pnpm monorepo package refactor
**Performance Goals**: No meaningful regression in validation runtime
**Constraints**: No public API change, no schema version change, no new common-package seam, preserve typed error behavior
**Scale/Scope**: `packages/store/src/schema.ts` and related store schema tests only

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | PASS | No new seams added; this is internal store structure only |
| II. Standalone Packages | PASS | `@wtfoc/store` remains standalone and owns its validators |
| III. Backend-Neutral Identity | PASS | No storage identity behavior changes |
| IV. Immutable Data, Mutable Index | PASS | Manifest and segment compatibility preserved |
| V. Edges Are First-Class | N/A | No edge behavior changes |
| VI. Test-First | PASS | Existing schema tests are the regression contract |
| VII. Bundle Uploads | N/A | No bundling changes |
| VIII. Hackathon-First, Future-Aware | PASS | Cleaner internal structure lowers future schema risk |

**No violations. Gate passed.**

## Project Structure

### Documentation (this feature)

```text
.specify/specs/010-store-schema-validation-architecture-refactor/
├── spec.md
├── research.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/store/src/
├── schema.ts
├── schema.test.ts
└── schema/
    ├── manifest.ts
    ├── segment.ts
    └── shared.ts
```

**Structure Decision**: Keep `packages/store/src/schema.ts` as the stable public facade and move internal validator ownership into domain-focused sibling modules under `packages/store/src/schema/`.

## Phase 0: Research (COMPLETED)

See [research.md](research.md).

Resolved decisions:

1. Keep the public schema entry point stable
2. Split by validator domain plus shared helpers
3. Preserve current error shaping as the behavioral contract
4. Keep semantic rules adjacent to each validator domain
5. Use existing tests as the primary safety net

## Phase 1: Design & Contracts

No new public contracts or persisted data models are introduced.

Design constraints for implementation:

- `schema.ts` must remain the import surface for callers
- manifest logic owns manifest-only semantic rules
- segment logic owns segment-only semantic rules
- shared helpers own only generic reusable concerns
- tests should continue asserting externally visible behavior rather than internal module structure

## Post-Design Constitution Re-check

All gates still pass:

- No interface widening in `@wtfoc/common`
- No manifest or segment schema version change
- No behavior-first implementation drift
- Package boundaries remain intact

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | The refactor fits inside existing package and seam boundaries |
