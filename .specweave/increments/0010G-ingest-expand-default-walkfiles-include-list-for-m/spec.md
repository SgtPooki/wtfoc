# feat(ingest): expand default walkFiles include list for manifest files

**Increment**: 0010G-ingest-expand-default-walkfiles-include-list-for-m
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #180

## Description

## Summary

`walkFiles()` in `packages/ingest/src/adapters/repo/chunking.ts` only yields files whose extension is in `DEFAULT_INCLUDE`. Several manifest files in `MANIFEST_FILENAMES` have extensions not covered by this set:

- `.mod` (go.mod)
- `.sum` (go.sum)
- `.txt` (requirements.txt)
- `.lock` (Cargo.lock, package-lock.json is `.json` so it's fine)
- `.xml` (pom.xml)
- `.gradle` (build.gradle)
- Extensionless: `Gemfile`, `Pipfile`

These manifests won't be ingested under default settings, so the single-chunk behavior from #142 won't apply to them.

## Proposed fix

Either:
1. Add missing extensions to `DEFAULT_INCLUDE`
2. Or add a basename-based check in `walkFiles()` that always includes files matching `MANIFEST_FILENAMES` regardless of extension

Option 2 is cleaner since it avoids pulling in all `.txt`/`.xml`/`.lock` files.

Follow-up from #142 / PR #178.

## User Stories

- **US-001**: As a user, I want ingest expand default walkfiles include list for m so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #180 on 2026-04-12.
