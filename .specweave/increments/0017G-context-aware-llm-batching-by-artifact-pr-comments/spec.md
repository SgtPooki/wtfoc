# [feat] Context-aware LLM batching by artifact (PR+comments, Slack thread)

**Increment**: 0017G-context-aware-llm-batching-by-artifact-pr-comments
**Type**: feature | **Priority**: P2 | **Labels**: P2
**Source**: GitHub #141

## Description

## Context
From Codex review of PR #138 (finding #2): LLM batching currently groups chunks by sequential token budget only. FR-012 requires batching by artifact context (PR + its comments together, Slack thread together).

This requires chunk metadata about artifact boundaries that the current ingest pipeline doesn't preserve at batch boundaries. Better suited for the `wtfoc extract-edges` command which has access to the full collection.

## Related
- #3 (edge extraction pipeline)
- PR #138

## User Stories

- **US-001**: As a user, I want context aware llm batching by artifact pr comments so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #141 on 2026-04-12.
