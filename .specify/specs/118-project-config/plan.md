# Implementation Plan: .wtfoc.json Project Config

**Branch**: `118-project-config` | **Date**: 2026-03-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/118-project-config/spec.md`

## Summary

Add a `.wtfoc.json` project config file that configures embedding endpoints, LLM edge extraction, and file ignore patterns. A new `@wtfoc/config` package handles loading, validation (fail-fast), and precedence resolution (CLI > file > env > defaults). Ignore patterns use `.gitignore` semantics via the `ignore` npm package. URL shortcuts (`lmstudio`, `ollama`) are consolidated from duplicated CLI/MCP code into the config package.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >=24
**Primary Dependencies**: `ignore` (gitignore pattern matching — new), Commander.js (CLI, existing), `@modelcontextprotocol/sdk` (MCP, existing)
**Storage**: Filesystem (`.wtfoc.json` read via `readFileSync`)
**Testing**: vitest (unit tests, no network)
**Target Platform**: Node.js CLI + MCP server (stdio)
**Project Type**: Monorepo library + CLI + MCP server
**Performance Goals**: Config loading < 5ms (single small file read + JSON parse)
**Constraints**: No new dependencies in `@wtfoc/common` (contracts only). `@wtfoc/config` may depend on `ignore`.
**Scale/Scope**: 1 new package (`@wtfoc/config`), ~11 new files (5 modules + 5 test files + 1 index), ~5 modified files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | PASS | Config is a new seam — consumers can ignore `.wtfoc.json` and use CLI/env as before |
| II. Standalone Packages | PASS | `@wtfoc/config` is independently useful. Types in `@wtfoc/common` (no I/O). |
| III. Backend-Neutral Identity | N/A | No storage identity changes |
| IV. Immutable Data, Mutable Index | N/A | Config is runtime-only, not persisted to store |
| V. Edges Are First-Class | N/A | No edge schema changes |
| VI. Test-First | PASS | Unit tests for loader, validator, resolver, ignore filter |
| VII. Bundle Uploads | N/A | No uploads |
| VIII. Ship-First | PASS | Minimal scope, solves real dogfooding pain |
| TypeScript strict, ESM, no defaults | PASS | All new code follows this |
| No `any`, no `as unknown as`, no `!` | PASS | Manual validation uses `typeof` narrowing |
| Named errors with `code` | PASS | `ConfigParseError` ("CONFIG_PARSE"), `ConfigValidationError` ("CONFIG_VALIDATION") |
| Conventional commits | PASS | Scoped by package: `feat(config):`, `feat(cli):`, etc. |
| Monorepo scripts | PASS | Standard `"test": "vitest run"` in new package |

**Post-Phase-1 re-check**: Adding `@wtfoc/config` as a 7th package. Constitution says "Each `@wtfoc/*` package is independently useful" — config loading is independently useful. No violation.

## Project Structure

### Documentation (this feature)

```text
specs/118-project-config/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: entity definitions
├── quickstart.md        # Phase 1: build sequence + smoke test
├── contracts/           # Phase 1: interface contracts
│   ├── config-types.ts  # ProjectConfig, EmbedderConfig, etc.
│   └── config-loader.ts # loadProjectConfig(), resolveConfig() API
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
packages/config/                    # NEW PACKAGE
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # Public API exports
    ├── loader.ts                   # loadProjectConfig() — read + parse + validate
    ├── validator.ts                # Schema validation with typed errors
    ├── resolver.ts                 # resolveConfig() — precedence merge
    ├── shortcuts.ts                # resolveUrlShortcut() — URL shortcut map
    ├── ignore.ts                   # createIgnoreFilter() — gitignore wrapper
    ├── loader.test.ts              # Tests: file reading, parse errors
    ├── validator.test.ts           # Tests: schema validation, error messages
    ├── resolver.test.ts            # Tests: precedence rules
    ├── shortcuts.test.ts           # Tests: URL resolution
    └── ignore.test.ts              # Tests: pattern matching

packages/common/src/
├── config-types.ts                 # NEW: ProjectConfig, EmbedderConfig, etc.
└── errors.ts                       # MODIFIED: add ConfigParseError, ConfigValidationError

packages/cli/src/
├── cli.ts                          # MODIFIED: load config at startup
└── helpers.ts                      # MODIFIED: refactor createEmbedder() to accept ResolvedConfig

packages/mcp-server/src/
├── index.ts                        # MODIFIED: load config at startup
└── helpers.ts                      # MODIFIED: refactor createEmbedder() to use config

packages/ingest/src/adapters/repo/
└── chunking.ts                     # MODIFIED: accept ignore filter in walkFiles()

# Root config
pnpm-workspace.yaml                 # MODIFIED: add packages/config
tsconfig.json                       # MODIFIED: add project reference
```

**Structure Decision**: Monorepo with new `packages/config` package. Follows existing pattern — each package has `src/`, `dist/`, own `tsconfig.json` with project references, `"test": "vitest run"` script.

## Complexity Tracking

No constitution violations to justify. The new package is small, focused, and independently useful.
