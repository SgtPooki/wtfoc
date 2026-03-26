# Data Model: .wtfocignore Support

## Entities

### BUILTIN_IGNORE_PATTERNS (Modified)

Expanded constant in `@wtfoc/common/config-types.ts`. Array of gitignore-style pattern strings applied to all repo ingestions by default.

**Current**: `[".git", "node_modules"]`

**New**: `[".git", "node_modules", "dist/", "build/", "out/", "coverage/", ".next/", ".turbo/", "__pycache__/", "*.lock", "*.min.js", "*.min.css", "*.map"]`

### .wtfocignore File

Plain text file at the root of an ingested repository. One pattern per line. Supports gitignore syntax: globs, directory markers (`dir/`), negation (`!pattern`), comments (`# comment`), blank lines ignored.

**Location**: `{repoRoot}/.wtfocignore`
**Format**: UTF-8 text, newline-delimited patterns

### Ignore Pattern Sources (Merge Order)

1. **Built-in** — `BUILTIN_IGNORE_PATTERNS` constant (always applied)
2. **File** — `.wtfocignore` from repo root (if present)
3. **Config** — `.wtfoc.json` `ignore` field (if present)
4. **CLI** — `--ignore` flag values (if provided)

All sources are additive. Later sources can use negation to override earlier exclusions.

## No Schema Changes

No changes to `ProjectConfig`, `CollectionHead`, `Chunk`, `Segment`, or any persisted data model. This feature only affects the file filtering step during ingestion.
