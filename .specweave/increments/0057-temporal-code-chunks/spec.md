---
increment: 0057-temporal-code-chunks
title: Add temporal metadata to code chunks
type: feature
priority: P1
status: completed
created: 2026-04-13T00:00:00.000Z
structure: user-stories
test_mode: TDD
coverage_target: 0
total_tasks: 4
checked_tasks: 4
---

# Feature: Add temporal metadata to code chunks

## Overview

The repo adapter sets `timestamp: null` on all code/markdown chunks, while GitHub issue/PR chunks have proper timestamps. This blocks temporal queries ("what changed recently?") and temporal edge extraction for code files. Dogfood collection shows 2901 code chunks with null timestamps vs 737 GitHub chunks with timestamps.

This increment adds git-based temporal metadata to every code and markdown chunk during repo ingest.

## User Stories

### US-001: Temporal metadata on code chunks (P1)
**Project**: wtfoc

**As a** knowledge graph user
**I want** code chunks to include the last commit timestamp, SHA, author, and message
**So that** temporal queries and temporal edge extraction work for code files, not just GitHub issues/PRs

**Acceptance Criteria**:
- [x] **AC-US1-01**: Code chunks have `timestamp` set to the ISO 8601 date of their file's last git commit
- [x] **AC-US1-02**: Markdown chunks have `timestamp` set to the ISO 8601 date of their file's last git commit
- [x] **AC-US1-03**: All chunks include `lastCommitSha` (40-char hex) in metadata
- [x] **AC-US1-04**: All chunks include `lastCommitAuthor` (non-empty string) in metadata
- [x] **AC-US1-05**: All chunks include `lastCommitMessage` in metadata

---

### US-002: Batched git log for performance (P1)
**Project**: wtfoc

**As a** developer ingesting large repos
**I want** git log calls to be batched with concurrency limiting
**So that** ingest performance is acceptable for repos with thousands of files

**Acceptance Criteria**:
- [x] **AC-US2-01**: `getFilesLastCommits()` processes files in concurrent batches (default 20)
- [x] **AC-US2-02**: Files with no git history are gracefully skipped (no errors)
- [x] **AC-US2-03**: Non-git repos produce chunks without temporal metadata (no crash)

## Out of Scope

- Per-hunk/per-chunk git blame attribution (follow-up: #239)
- Commit node creation for full history traversal (#239)
- Commit → PR → Issue provenance chains (#239)

## Dependencies

- Existing `Chunk.timestamp` field (already optional string in schema)
- Existing `ChunkerDocument.timestamp` field (already propagated by all chunkers)
- Existing `execFileAsync` pattern in git-diff.ts
