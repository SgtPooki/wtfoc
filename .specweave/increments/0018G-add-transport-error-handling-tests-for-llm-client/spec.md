# [chore] Add transport/error-handling tests for LLM client

**Increment**: 0018G-add-transport-error-handling-tests-for-llm-client
**Type**: feature | **Priority**: P2 | **Labels**: P2
**Source**: GitHub #140

## Description

## Context
From Codex review of PR #138 (finding #5): llm-client.test.ts only tests parseJsonResponse. Missing coverage for:
- Request URL construction (baseUrl + /chat/completions)
- Auth header handling (Bearer token)
- Timeout abort behavior
- jsonMode on/off behavior
- AbortSignal propagation through fetch
- Multi-batch partial success in LlmEdgeExtractor
- Mid-flight cancellation behavior

## Related
- #3 (edge extraction pipeline)
- PR #138

## User Stories

- **US-001**: As a user, I want add transport error handling tests for llm client so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #140 on 2026-04-12.
