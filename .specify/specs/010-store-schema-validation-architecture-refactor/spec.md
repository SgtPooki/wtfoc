# Feature Specification: Store Schema Validation Architecture Refactor

**Feature Branch**: `010-store-schema-validation-architecture-refactor`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "Look at the largest files in the wtfoc repo and identify which ones could use a re-architecture or split. We already have issue 81 for the large cli.ts, but there are some others that could probably be cleaned up and utilize more SOLID patterns."

## Clarifications

### Session 2026-03-24

- Q: Should this refactor change manifest or segment schema shape, validation semantics, or error messages? → A: No. This is a structure-only refactor. Public validation behavior remains the contract.
- Q: Should manifest and segment validation stay reachable from the current `packages/store/src/schema.ts` entry point? → A: Yes. Keep the current public module surface stable and let it delegate to smaller internal modules.
- Q: Should new seams/interfaces be introduced for validators? → A: No. This is an internal decomposition inside `@wtfoc/store`, not a new public seam in `@wtfoc/common`.

## Overview

`packages/store/src/schema.ts` is currently the largest non-CLI source file in the repository and combines multiple responsibilities:

- primitive guard helpers
- schema-version gating
- manifest sub-schema definitions
- manifest semantic validation
- segment sub-schema definitions
- segment semantic validation
- hand-authored error shaping

This refactor decomposes the file into smaller internal modules while preserving the current public behavior, exported API, schema-version rules, and validation errors. The goal is to make schema evolution safer and testing more targeted without changing persisted data contracts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manifest validation remains behaviorally stable after decomposition (Priority: P1)

As a maintainer, I can refactor manifest validation internals into focused modules without changing what valid and invalid manifests do today.

**Why this priority**: Manifest validation is part of the persistence boundary. Regressions here would risk collection readability and schema compatibility.

**Independent Test**: Run the existing manifest validation test suite and add targeted tests that validate the extracted manifest module boundaries where useful.

**Acceptance Scenarios**:

1. **Given** a valid manifest input, **When** `validateManifestSchema()` is called after the refactor, **Then** it returns the same typed manifest shape as before.
2. **Given** an invalid manifest input, **When** `validateManifestSchema()` rejects it after the refactor, **Then** it still throws the same typed error code and materially equivalent message/field context as before.
3. **Given** a mixed-history manifest with optional batch records, **When** it is validated after the refactor, **Then** compatibility behavior remains unchanged.

---

### User Story 2 - Segment validation remains behaviorally stable after decomposition (Priority: P1)

As a maintainer, I can refactor segment validation internals independently from manifest validation without changing segment acceptance or rejection behavior.

**Why this priority**: Segment validation is the immutable artifact boundary. Any change here risks breaking stored segment readability.

**Independent Test**: Run the existing segment validation test suite and add focused tests around extracted segment validation helpers if needed.

**Acceptance Scenarios**:

1. **Given** a valid segment input, **When** `validateSegmentSchema()` is called after the refactor, **Then** it returns the same typed segment shape as before.
2. **Given** a segment with invalid chunk or edge fields, **When** validation runs after the refactor, **Then** the same error code and equivalent field targeting are preserved.
3. **Given** an unsupported `schemaVersion`, **When** either manifest or segment validation runs, **Then** `SchemaUnknownError` behavior remains unchanged.

---

### User Story 3 - Maintainers can evolve one validator area without touching the whole file (Priority: P2)

As a maintainer, I can change manifest-only or segment-only validation logic in a focused module with less risk of unrelated regressions.

**Why this priority**: This is the actual maintainability payoff from the refactor, but it is lower priority than preserving current behavior.

**Independent Test**: Review the resulting source structure and verify the old monolithic file is reduced to a thin compatibility/export layer plus focused internal modules.

**Acceptance Scenarios**:

1. **Given** a future manifest-only change, **When** a maintainer edits the validator internals, **Then** the change can be made in manifest-focused modules without editing segment validation code.
2. **Given** a future segment-only change, **When** a maintainer edits the validator internals, **Then** the change can be made in segment-focused modules without editing manifest validation code.

---

### Edge Cases

- Inputs that are not objects at the root level
- `schemaVersion` missing, non-integer, below 1, or above max supported
- Optional manifest fields (`batches`, `timeRange`, `repoIds`, `sourceUrl`, `timestamp`) present with invalid types
- Batch records referencing missing segments or duplicating segment IDs
- Segment embeddings with mismatched dimensions
- Existing callers importing from `packages/store/src/schema.ts`

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The refactor MUST preserve the exported API of `packages/store/src/schema.ts`, including `MAX_SUPPORTED_SCHEMA_VERSION`, `validateManifestSchema`, and `validateSegmentSchema`.
- **FR-002**: The refactor MUST preserve current manifest and segment validation behavior for valid inputs.
- **FR-003**: The refactor MUST preserve current typed error behavior for invalid inputs, including `SchemaUnknownError` usage and `SCHEMA_INVALID` error codes.
- **FR-004**: The refactor MUST separate manifest-focused validation logic from segment-focused validation logic into distinct internal modules.
- **FR-005**: The refactor MUST centralize shared schema helpers used by both validators rather than duplicating primitive guards or schema error construction logic.
- **FR-006**: The refactor MUST NOT change manifest schema versions, segment schema versions, or persisted field names.
- **FR-007**: The refactor MUST NOT introduce new public interfaces or seams in `@wtfoc/common`.
- **FR-008**: The refactor MUST keep mixed-history manifest compatibility intact, including optional batch records and legacy summary fields already accepted today.
- **FR-009**: The refactor MUST keep behavioral tests as the primary regression guard and add targeted tests only where module extraction creates a new meaningful behavior boundary.

### Key Entities

- **Schema Compatibility Layer**: The stable public `packages/store/src/schema.ts` module that preserves the current API and delegates to internal validator modules.
- **Manifest Validator Module**: Internal logic responsible for manifest-specific structural and semantic validation.
- **Segment Validator Module**: Internal logic responsible for segment-specific structural and semantic validation.
- **Shared Schema Helpers**: Internal utilities for object narrowing, primitive guards, schema-version gating, and consistent schema error creation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `packages/store/src/schema.ts` is reduced from a monolithic validator implementation to a thin compatibility/export layer with manifest, segment, and shared helper logic extracted into focused modules.
- **SC-002**: Existing store schema tests continue to pass without changing the asserted external behavior.
- **SC-003**: The refactor adds no schema version bumps, no public API changes, and no new seams in `@wtfoc/common`.
- **SC-004**: A maintainer can identify the owning module for manifest validation, segment validation, and shared schema helpers in under one minute by browsing the source tree.

## Out of Scope

- Changes to manifest or segment field shapes
- Changes to schema version numbers
- New validation semantics or relaxed/stricter acceptance rules
- New public validator interfaces
- Refactors outside `@wtfoc/store`

## References

- Issue #85: Refactor store schema validation architecture
- Issue #87: [spec] 010: Store schema validation architecture refactor
- SPEC.md rule 5: immutable data, mutable index
- SPEC.md rule 7: format compatibility
- `packages/store/src/schema.ts`
- `packages/store/src/schema.test.ts`
