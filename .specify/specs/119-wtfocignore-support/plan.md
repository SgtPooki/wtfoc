# Implementation Plan: .wtfocignore Support

**Branch**: `119-wtfocignore-support` | **Date**: 2026-03-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/119-wtfocignore-support/spec.md`

## Summary

Add `.wtfocignore` file support and `--ignore` CLI flag for repo ingestion, expand built-in default exclusion patterns, and ensure the ignore filter always applies even without a `.wtfoc.json` config file. Builds on existing `createIgnoreFilter()` and `ignore` npm package infrastructure.

## Technical Context

**Language/Version**: TypeScript strict, ESM only, Node >=24
**Primary Dependencies**: `ignore` npm package (already installed in @wtfoc/config)
**Storage**: N/A (file pattern matching only)
**Testing**: vitest
**Target Platform**: CLI (Node.js)
**Project Type**: CLI tool / monorepo library
**Performance Goals**: No measurable overhead on ingestion
**Constraints**: Must preserve backward compatibility with existing `.wtfoc.json` `ignore` field
**Scale/Scope**: ~4 files modified, ~2 new functions, ~50 lines net new code

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| Credible Exit at Every Seam | PASS | No new seam; extends existing ignore filter |
| Standalone Packages | PASS | Changes in @wtfoc/config and @wtfoc/cli only; @wtfoc/common gets expanded constants |
| Test-First | PASS | Tests for new ignore file loading and expanded defaults |
| TypeScript strict, no any | PASS | All new code will be strictly typed |
| Biome formatting | PASS | Will run lint:fix |
| Conventional commits | PASS | Will use `feat(config):` and `feat(cli):` scopes |
| Named errors only | PASS | No new error paths needed; missing .wtfocignore is a silent no-op |
| Self-documenting code | PASS | Function names describe intent |

No violations. Gate passes.

## Project Structure

### Documentation (this feature)

```text
specs/119-wtfocignore-support/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── spec.md              # Feature specification
└── checklists/
    └── requirements.md  # Quality checklist
```

### Source Code (repository root)

```text
packages/
├── common/src/
│   └── config-types.ts          # MODIFY: Expand BUILTIN_IGNORE_PATTERNS
├── config/src/
│   ├── ignore.ts                # MODIFY: Add loadWtfocIgnore(), update createIgnoreFilter signature
│   ├── ignore.test.ts           # MODIFY: Add tests for .wtfocignore loading and expanded defaults
│   └── index.ts                 # MODIFY: Export loadWtfocIgnore
└── cli/src/
    └── commands/ingest.ts       # MODIFY: Add --ignore flag, load .wtfocignore, always apply filter
```

**Structure Decision**: No new files needed. All changes are modifications to existing files within the established package structure.

## Complexity Tracking

No constitution violations to justify.
