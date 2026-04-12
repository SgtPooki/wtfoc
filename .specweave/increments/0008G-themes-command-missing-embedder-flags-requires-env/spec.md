# bug: themes command missing --embedder flags, requires env vars for API embedders

**Increment**: 0008G-themes-command-missing-embedder-flags-requires-env
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #191

## Description

## Problem

The `themes` command doesn't accept `--embedder`, `--embedder-url`, or `--embedder-model` flags, unlike `query`, `ingest`, `reindex`, and `serve` which all do.

This means if a collection was built with an API embedder (e.g., nomic-embed-text via ollama), you can't run `themes` without setting environment variables:

```bash
# Fails - unknown option
wtfoc themes -c my-collection --embedder api --embedder-url ollama --embedder-model nomic-embed-text
# error: unknown option '--embedder'

# Works - but requires knowing the env var names
WTFOC_EMBEDDER=api WTFOC_EMBEDDER_URL=ollama WTFOC_EMBEDDER_MODEL=nomic-embed-text \
  wtfoc themes -c my-collection
```

## Impact

This creates an inconsistent CLI experience. A user who built their collection with `--embedder-url ollama` will expect the same flags to work with `themes`.

## Suggested fix

Add the standard embedder flags to `registerThemesCommand()` in `packages/cli/src/commands/themes.ts`, matching the pattern used in `query.ts`, `ingest.ts`, etc.

---
Found during dogfooding: building wtfoc-source-v3 collection from the wtfoc repo itself.

## User Stories

- **US-001**: As a user, I want themes command missing embedder flags requires env so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #191 on 2026-04-12.
