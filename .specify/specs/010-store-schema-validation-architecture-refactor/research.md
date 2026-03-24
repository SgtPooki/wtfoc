# Research: Store Schema Validation Architecture Refactor

## Decision 1: Keep the public schema entry point stable

- **Decision**: Preserve `packages/store/src/schema.ts` as the public entry point and make it a thin compatibility/export layer.
- **Rationale**: Existing tests and downstream imports already depend on this module path. The refactor is intended to be structural only.
- **Alternatives considered**:
  - Move callers to new public modules: rejected because it creates a public API migration for an internal cleanup.
  - Keep the monolith and only reorder functions: rejected because it does not meaningfully reduce coupling.

## Decision 2: Split by domain, not by helper type alone

- **Decision**: Extract manifest-focused validation and segment-focused validation into separate internal modules, with a small shared helper module.
- **Rationale**: Manifest and segment validation are the two dominant reasons the file changes. Shared helper extraction alone would still leave a large mixed-responsibility file.
- **Alternatives considered**:
  - Split purely into `guards.ts`, `schemas.ts`, and `validators.ts`: rejected because manifest and segment logic would still stay entangled.
  - Introduce validator classes/interfaces: rejected because there is only one implementation and no new seam is needed.

## Decision 3: Preserve current error shaping as the contract

- **Decision**: Treat current `SCHEMA_INVALID` and `SchemaUnknownError` behavior as part of the contract for this refactor.
- **Rationale**: Validation errors are consumed programmatically by code using stable `code` fields, and tests already lock in important message/context details.
- **Alternatives considered**:
  - Normalize all errors through raw valibot output: rejected because it would change current user-facing and test-visible behavior.
  - Change message wording while keeping codes stable: rejected because the purpose of this refactor is structural, not behavioral.

## Decision 4: Keep semantic validation adjacent to each domain

- **Decision**: Keep manifest-specific semantic rules in the manifest module and segment-specific semantic rules in the segment module, while centralizing only generic helpers.
- **Rationale**: Rules like batch-to-segment cross-reference checks and embedding dimension checks belong with their owning validator domain.
- **Alternatives considered**:
  - Central semantic-validation module: rejected because it would reintroduce a mixed-responsibility hub.

## Decision 5: Use existing tests as the main safety net

- **Decision**: Preserve and run the current schema tests, adding only small targeted tests if extraction produces a useful new behavior boundary.
- **Rationale**: The existing suite already encodes the required acceptance/rejection behavior; duplicating it at many layers would overfit the implementation.
- **Alternatives considered**:
  - Rewrite tests around internal helpers: rejected because the repo prefers behavior tests over implementation-detail tests.
