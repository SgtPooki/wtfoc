# dogfood: HackerNews adapter returns very few results for broad queries

**Increment**: 0022G-hackernews-adapter-returns-very-few-results-for-br
**Type**: feature | **Priority**: P2 | **Labels**: enhancement, ux, P2
**Source**: GitHub #122

## Description

## Problem

The HackerNews adapter returns surprisingly few chunks for broad, popular topics.

**Observed during dogfooding:**
- `wtfoc ingest hackernews "RAG knowledge graph retrieval augmented generation"` → **15 chunks**
- `wtfoc ingest hackernews "vector database knowledge graph comparison"` → **4 chunks**

These are heavily discussed topics on HN with thousands of stories and comments.

## Likely Causes

1. **Algolia API query limitations**: The HN search API may be matching the full query string literally rather than OR-ing terms
2. **No pagination**: May only be fetching the first page of results
3. **Comment depth**: May not be fetching comment threads, only top-level stories

## Suggested Improvements

1. **Query splitting**: Split multi-word queries into OR terms for broader coverage
2. **Pagination**: Fetch multiple pages of results (configurable via `--limit N`)
3. **Comment ingestion**: Follow story links to ingest top-level comments and threads
4. **Date range**: Support `--since` to focus on recent discussions
5. **Show stats**: Report how many stories/comments were found vs ingested

## User Stories

- **US-001**: As a user, I want hackernews adapter returns very few results for br so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #122 on 2026-04-12.
