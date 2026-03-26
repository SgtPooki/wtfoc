# Research: .wtfocignore Support

## R1: .wtfocignore File Loading

**Decision**: Read `.wtfocignore` from the repo root (the directory being ingested), not from CWD. Parse with the same `ignore` npm package already used for `.wtfoc.json` patterns.

**Rationale**: The file belongs to the repo being ingested, so it should be read from the repo root (which may differ from CWD for remote repos that are cloned). The `ignore` npm package already handles comment stripping (`#` lines), blank line skipping, negation (`!`), and directory markers — no custom parsing needed.

**Alternatives considered**:
- Custom parser: Rejected, `ignore` package already provides full gitignore semantics
- Read from CWD: Rejected, the patterns describe the repo content, not the user's working directory

## R2: Expanded Built-in Defaults

**Decision**: Expand `BUILTIN_IGNORE_PATTERNS` in `@wtfoc/common` to include common noise files.

**Rationale**: Current builtins (`.git`, `node_modules`) are insufficient. Users repeatedly encounter noise from lock files, minified bundles, source maps, and build output.

**New default patterns**:
```
.git
node_modules
dist/
build/
out/
coverage/
.next/
.turbo/
__pycache__/
*.lock
*.min.js
*.min.css
*.map
```

**Alternatives considered**:
- Separate "recommended" vs "builtin" tiers: Rejected as over-engineering for MVP
- Only add via `.wtfocignore` template: Rejected, defaults should work without any config

## R3: Pattern Merging Order

**Decision**: All pattern sources are merged additively into a single `ignore` instance in this order: builtins → .wtfocignore file → .wtfoc.json `ignore` field → `--ignore` CLI flags.

**Rationale**: The `ignore` package processes patterns in order, so negation in later sources can override exclusions from earlier sources. This gives CLI flags the highest "override" power, which matches user expectation.

**Alternatives considered**:
- Separate ignore instances per source: Rejected, would break negation across sources

## R4: Always Apply Ignore Filter

**Decision**: The ignore filter should always be created and applied for `repo` ingestion, even when no `.wtfoc.json` exists.

**Rationale**: Current code at `ingest.ts:137-141` only creates the filter when `projectCfg` is truthy. This means builtins like `*.lock` don't apply without a config file. The fix is to always build the filter from at minimum the builtins + .wtfocignore.

## R5: loadWtfocIgnore Function

**Decision**: Add `loadWtfocIgnore(repoRoot: string): string[]` to `@wtfoc/config` that reads `.wtfocignore` from the given directory and returns an array of patterns (empty array if file not found).

**Rationale**: Keeps the file I/O isolated in the config package where other config loading already lives. The ingest command calls this with the repo path and passes the result to `createIgnoreFilter`.
