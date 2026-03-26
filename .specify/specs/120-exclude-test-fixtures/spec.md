# Feature Specification: Exclude Test Fixtures from Repo Ingestion

**Feature Branch**: `120-exclude-test-fixtures`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "fix: exclude test fixtures from repo ingestion to prevent phantom edges (GitHub issue #119)"
**Depends on**: #124 (.wtfocignore support — PR #156)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Default Test File Exclusion (Priority: P1)

When a user runs `wtfoc ingest repo` on a project containing test files, spec files, and fixture data, those files are automatically excluded from ingestion by default. This prevents phantom edges like `owner/repo` and `test/repo` from appearing in `unresolved-edges` and `suggest-sources` output.

**Why this priority**: This was the original problem discovered during dogfooding — test fixtures pollute the edge index and cause misleading recommendations.

**Independent Test**: Run `wtfoc ingest repo .` on the wtfoc repo itself. Verify that `unresolved-edges` does not surface `owner/repo` or `test/repo` as missing sources.

**Acceptance Scenarios**:

1. **Given** a repo with `*.test.ts`, `*.spec.ts`, `__tests__/`, `__fixtures__/` files, **When** user runs `wtfoc ingest repo .`, **Then** test files and fixtures are excluded from ingestion by default.
2. **Given** a repo where test files reference fictional repos like `owner/repo`, **When** user runs ingestion followed by `unresolved-edges`, **Then** those fictional references do not appear.
3. **Given** a user who wants to include test files matching `*.test.ts`, **When** they use `.wtfocignore` with negation `!*.test.ts`, **Then** those test files are re-included. Note: files inside ignored directories like `__tests__/` require un-ignoring the directory as well.

---

### Edge Cases

- What happens if a non-test file is literally named `test.ts` (for example at the repo root or under `src/`)? It would **not** be excluded by these defaults, since only `test/` directories and `*.test.*` patterns are ignored. Users who want it excluded can add `test.ts` to `.wtfocignore`.
- What happens if test fixtures contain real, useful documentation? Users can override via `.wtfocignore` negation patterns.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST exclude common test file patterns from repo ingestion by default: `*.test.*`, `*.spec.*`, `__tests__/`, `__fixtures__/`, `__mocks__/`, `*.stories.*` (Storybook).
- **FR-002**: System MUST exclude common test/fixture directory patterns: `test/`, `tests/`, `fixtures/`, `spec/`.
- **FR-003**: Users MUST be able to override test exclusions using `.wtfocignore` negation patterns (e.g., `!*.test.ts`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running `wtfoc ingest repo .` on the wtfoc repo no longer produces phantom edges for `owner/repo` or `test/repo`.
- **SC-002**: All existing tests continue to pass.
- **SC-003**: Users can opt back in to test file ingestion via negation patterns.

## Assumptions

- This feature builds on #124 (.wtfocignore support) which expands `BUILTIN_IGNORE_PATTERNS` and ensures the ignore filter always applies.
- The `test/` and `tests/` exclusions may be too aggressive for some projects (e.g., a testing framework). Users can override via `.wtfocignore`.
