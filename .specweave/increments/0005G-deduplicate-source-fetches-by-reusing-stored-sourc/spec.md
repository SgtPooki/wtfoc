# feat: deduplicate source fetches by reusing stored source material across collections

**Increment**: 0005G-deduplicate-source-fetches-by-reusing-stored-sourc
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #194

## Description

## Problem

When multiple users or collections ingest the same source (e.g. `FilOzone/foc-protocol`), each one independently fetches from the GitHub API (or Slack, etc.), hitting rate limits and duplicating work. Once #187 lands and we store compressed source material, we'll have local copies of already-fetched sources sitting right there on the server — but no way to discover or reuse them.

## Proposed solution

Before fetching from an external API, search existing collections on the server for matching source material. If a match exists, reuse it (or the relevant portion based on cursors) instead of re-fetching.

Key behaviors:
- **Source discovery**: given a source identifier (e.g. `github:FilOzone/foc-protocol`), scan existing collections for stored source blobs matching that identifier
- **Cursor awareness**: stored sources have forward and reverse cursors (e.g. "fetched issues up to 2026-03-15"). If the stored material covers the requested time range, skip the fetch entirely. If there's a gap, only fetch the delta
- **Fallback**: if no matching stored source exists, or cursors don't cover the requested range, fall back to normal API fetching
- **Cross-collection**: this works across collection boundaries — collection A's stored GitHub data can seed collection B's ingest

This is especially valuable for:
- Multiple people ingesting the same GitHub org/repo
- Re-ingesting with `--since` when another collection already has the newer data
- Reducing API rate limit pressure (GitHub, Slack, Discord all have limits)

## Dependencies

- #187 (store compressed source material during ingest)

## Open questions

- How to index stored sources for fast lookup? Manifest-level source registry vs a separate index
- Trust model: should reusing another collection's source material require explicit opt-in?
- Conflict resolution: if two collections have overlapping but different cursor ranges for the same source, how to merge?
- Should this be transparent (automatic during ingest) or explicit (`--reuse-sources` flag)?

## User Stories

- **US-001**: As a user, I want deduplicate source fetches by reusing stored sourc so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #194 on 2026-04-12.
