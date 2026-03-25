# Research: .wtfoc.json Project Config

**Feature**: 118-project-config
**Date**: 2026-03-25

## R1: Where Should Config Logic Live?

**Decision**: New `@wtfoc/config` package

**Rationale**: Config types are contracts (belong in `@wtfoc/common`), but config *loading* requires file I/O. Constitution says `@wtfoc/common` is "contracts only — no I/O, no business logic." Both `@wtfoc/cli` and `@wtfoc/mcp-server` need the config loader, so it can't live in just one consumer. A dedicated package is independently useful (any tool that reads `.wtfoc.json` depends on it) and keeps the boundary clean.

**Alternatives considered**:
- `@wtfoc/common` — violates "no I/O" constraint
- `@wtfoc/store` — semantically wrong (config ≠ storage), and store shouldn't know about embedder/extractor settings
- Duplicate logic in CLI + MCP — violates DRY, creates drift risk
- Inline in each consumer — same as above

## R2: Gitignore Pattern Matching Library

**Decision**: Use the `ignore` npm package

**Rationale**: Purpose-built for `.gitignore` semantics including negation (`!`), anchoring, directory markers, and comment lines. ~2.5M weekly downloads, minimal footprint, well-maintained. `picomatch` and `micromatch` are already in the dependency tree transitively but they implement glob matching, not `.gitignore` semantics — they lack negation ordering, anchoring rules, and directory-only patterns.

**Alternatives considered**:
- `picomatch`/`micromatch` — already transitive deps but don't implement gitignore semantics
- `minimatch` — same limitation, plus heavier
- Hand-rolled — constitution says use established libraries, spec clarification explicitly requires a library

## R3: Schema Validation Approach

**Decision**: Manual TypeScript validation with typed error messages

**Rationale**: The config schema is small (3 sections, ~15 fields total). Adding Zod or Ajv would introduce a dependency for minimal benefit. Manual validation produces more specific error messages (e.g., "embedder.url must be a string, got number") and keeps the package dependency-free except for `ignore`. The validation functions are straightforward `typeof` checks with early returns.

**Alternatives considered**:
- Zod — powerful but adds ~50KB dependency for a 15-field schema
- Ajv + JSON Schema — overkill, adds two dependencies
- `@sinclair/typebox` — good but still a dependency for a simple case

## R4: URL Shortcut Consolidation

**Decision**: Move URL shortcut resolution into `@wtfoc/config`, deprecate duplicates in CLI and MCP helpers

**Rationale**: URL shortcuts (`lmstudio` → `http://localhost:1234/v1`, `ollama` → `http://localhost:11434/v1`) are currently duplicated between `packages/cli/src/helpers.ts:90-93` and `packages/mcp-server/src/helpers.ts:38-41`. The config package is the natural home since it already resolves config values. Consumers call `resolveUrlShortcut()` from `@wtfoc/config` instead of maintaining their own maps.

**Alternatives considered**:
- Keep duplicated — works but drifts when new shortcuts are added
- Move to `@wtfoc/common` — shortcuts involve no I/O, so technically valid, but config package is a better semantic fit

## R5: Existing File Filtering Integration Point

**Decision**: Integrate ignore patterns at the `walkFiles()` level in `packages/ingest/src/adapters/repo/chunking.ts`

**Rationale**: The repo adapter's `walkFiles()` function already has `excludeDirs` and `includeExts` parameters. Ignore patterns from config should be applied here, before files are read and chunked. The `ignore` library produces a filter function that can be composed with existing filters. Other adapters (Slack, GitHub, Discord) don't read local files and don't need ignore patterns — they pull from APIs.

**Alternatives considered**:
- Apply at adapter level (above chunking) — would require each adapter to implement filtering
- Apply at ingest command level — too late, files already read
- Apply only in CLI — MCP would miss it

## R6: Config File Discovery

**Decision**: `process.cwd()` only, synchronous read at startup

**Rationale**: Config is read once per command invocation. Synchronous read via `readFileSync` is simpler and avoids async initialization complexity. The file is tiny (< 1KB typically). Searching only `cwd` (not parent directories) matches the spec assumption and avoids surprising behavior where a parent directory's config silently affects a subdirectory project.

**Alternatives considered**:
- Async read — unnecessary complexity for a single small file
- Recursive upward search (like `.git` discovery) — explicitly deferred in spec's Future Considerations
- Lazy loading on first access — adds complexity, config should fail fast at startup
