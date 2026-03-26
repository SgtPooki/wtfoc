# Feature Specification: .wtfocignore Support

**Feature Branch**: `119-wtfocignore-support`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "Feature: .wtfocignore support for excluding files/patterns from repo ingestion (GitHub issue #124)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sensible Default Exclusions (Priority: P1)

When a user runs `wtfoc ingest repo`, common noise files (lock files, minified bundles, source maps, build output) are automatically excluded without any configuration. This applies regardless of whether a `.wtfoc.json` or `.wtfocignore` file exists.

**Why this priority**: Every user benefits immediately. Without sensible defaults, first-time users get polluted indexes on every ingestion, leading to poor search results and phantom edges.

**Independent Test**: Run `wtfoc ingest repo .` on a project with lock files, minified JS, and build output. Verify none of those files appear in the ingested chunks.

**Acceptance Scenarios**:

1. **Given** a repo with `package-lock.json`, `dist/bundle.min.js`, and `app.js.map`, **When** user runs `wtfoc ingest repo .`, **Then** only source files are ingested; lock/min/map files are excluded.
2. **Given** no `.wtfoc.json` or `.wtfocignore` file exists, **When** user runs `wtfoc ingest repo .`, **Then** built-in default exclusions still apply.
3. **Given** a repo with `coverage/`, `.turbo/`, `__pycache__/` directories, **When** user runs `wtfoc ingest repo .`, **Then** those directories are excluded.

---

### User Story 2 - .wtfocignore File (Priority: P1)

A user creates a `.wtfocignore` file in their repo root with gitignore-style patterns to control which files are excluded during ingestion. This file is automatically detected and applied.

**Why this priority**: Provides the primary user-facing mechanism for customizing exclusions, matching a pattern developers already understand from `.gitignore`.

**Independent Test**: Create a `.wtfocignore` file with custom patterns, run ingestion, and verify matching files are excluded.

**Acceptance Scenarios**:

1. **Given** a `.wtfocignore` file containing `docs/internal/`, **When** user runs `wtfoc ingest repo .`, **Then** all files under `docs/internal/` are excluded from ingestion.
2. **Given** a `.wtfocignore` file containing `!important.config.json` (negation), **When** user runs ingestion, **Then** `important.config.json` is included even if it would otherwise be excluded by a broader pattern.
3. **Given** a `.wtfocignore` file containing `*.generated.*`, **When** user runs ingestion, **Then** files like `schema.generated.ts` are excluded.
4. **Given** `.wtfocignore` is located at the repo root, **When** ingesting a remote GitHub repo, **Then** the `.wtfocignore` from the cloned repo root is read and applied.

---

### User Story 3 - CLI --ignore Flag (Priority: P2)

A user passes `--ignore <pattern>` flags on the command line to exclude files ad-hoc without modifying any config file. Multiple `--ignore` flags can be combined.

**Why this priority**: Useful for one-off ingestions or experimentation, but less critical than persistent file-based configuration.

**Independent Test**: Run `wtfoc ingest repo . --ignore "*.test.*" --ignore "fixtures/"` and verify test and fixture files are excluded.

**Acceptance Scenarios**:

1. **Given** a repo with test files, **When** user runs `wtfoc ingest repo . --ignore "*.test.*"`, **Then** files matching `*.test.*` are excluded.
2. **Given** both `.wtfocignore` and `--ignore` patterns, **When** user runs ingestion, **Then** patterns from all sources are merged (builtins + .wtfocignore + .wtfoc.json + --ignore).
3. **Given** `--ignore "src/legacy/"`, **When** user runs ingestion, **Then** the entire `src/legacy/` directory is excluded.

---

### User Story 4 - Pattern Source Merging (Priority: P2)

Ignore patterns from all sources are merged together additively: built-in defaults, `.wtfocignore` file, `.wtfoc.json` `ignore` field, and `--ignore` CLI flags. All patterns combine to exclude more files; negation patterns can re-include specific files.

**Why this priority**: Users need predictable behavior when patterns come from multiple sources.

**Independent Test**: Set up patterns in `.wtfocignore`, `.wtfoc.json`, and `--ignore` simultaneously, verify all are applied.

**Acceptance Scenarios**:

1. **Given** `.wtfocignore` excludes `docs/` and `.wtfoc.json` excludes `scripts/`, **When** user runs ingestion, **Then** both `docs/` and `scripts/` are excluded.
2. **Given** `.wtfocignore` excludes `*.log` and `--ignore` adds `*.tmp`, **When** user runs ingestion, **Then** both `.log` and `.tmp` files are excluded.
3. **Given** `.wtfocignore` excludes `*.json` but also contains `!package.json`, **When** user runs ingestion, **Then** `package.json` is included while other `.json` files are excluded.

---

### Edge Cases

- What happens when `.wtfocignore` file is empty? Only built-in defaults apply.
- What happens when `.wtfocignore` contains only comments? Treated as empty; only built-in defaults apply.
- What happens when `.wtfocignore` file has comments (`#` lines)? Comments are ignored, matching gitignore behavior.
- What happens when the same pattern appears in multiple sources? Duplicate patterns are harmless; the underlying library handles deduplication.
- What happens when a user re-ingests after adding ignore patterns? New files matching the pattern are skipped, but previously ingested chunks remain (existing deduplication behavior).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST apply built-in default exclusion patterns for all repo ingestions, regardless of whether any configuration file exists.
- **FR-002**: Built-in defaults MUST exclude common noise files including but not limited to: lock files (`*.lock`), minified files (`*.min.js`, `*.min.css`), source maps (`*.map`), and build output directories (`dist/`, `build/`, `out/`).
- **FR-003**: System MUST read a `.wtfocignore` file from the ingested repo root if present, interpreting it with gitignore-style semantics (globs, directory markers, negation patterns, comments).
- **FR-004**: System MUST support a `--ignore <pattern>` CLI flag on the `ingest repo` command, accepting multiple flags for multiple patterns.
- **FR-005**: System MUST merge patterns from all sources additively: built-in defaults + `.wtfocignore` file + `.wtfoc.json` `ignore` field + `--ignore` CLI flags.
- **FR-006**: System MUST support negation patterns (e.g., `!important.log`) to re-include files excluded by a broader pattern.
- **FR-007**: System MUST treat comment lines (starting with `#`) in `.wtfocignore` as ignored, matching gitignore behavior.
- **FR-008**: System MUST work correctly with both local repo paths and cloned GitHub repos (reading `.wtfocignore` from the repo root in both cases).
- **FR-009**: System MUST log (in non-quiet mode) when a `.wtfocignore` file is detected and applied, including the count of user-defined patterns loaded.

### Key Entities

- **Ignore Pattern Source**: A provider of exclusion patterns (built-in, .wtfocignore file, .wtfoc.json config, CLI flag). Each source contributes patterns that are merged additively.
- **Ignore Filter**: A compiled function that accepts a file path and returns whether it should be included in ingestion. Built from merged patterns across all sources.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can exclude unwanted files from ingestion without any configuration, via sensible built-in defaults.
- **SC-002**: Users can create a `.wtfocignore` file and see matching files excluded on next ingestion within the normal ingestion time (no measurable overhead).
- **SC-003**: All existing tests continue to pass with no regressions.
- **SC-004**: The `--ignore` CLI flag is documented in command help (`--help`) and works for ad-hoc pattern exclusion.

## Assumptions

- The existing `ignore` npm package (already a dependency) provides full gitignore semantics including negation, comments, and directory markers.
- `.wtfocignore` is read from the repo root only (not from subdirectories), matching `.gitignore` root-level behavior.
- Pattern merging is purely additive (all sources combine). There is no precedence override mechanism beyond negation patterns.
- Previously ingested chunks are not retroactively removed when new ignore patterns are added; they simply won't be re-ingested if the collection is rebuilt.
