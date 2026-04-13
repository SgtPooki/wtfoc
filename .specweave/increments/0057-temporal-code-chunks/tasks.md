---
total_tasks: 4
checked_tasks: 4
---

# Tasks: Add temporal metadata to code chunks

## Phase 1: Git Helpers

### T-001: Add getFileLastCommit to git-diff.ts
**User Story**: US-002 | **Satisfies ACs**: AC-US2-02 | **Status**: [x] completed
**Test Plan**:
- Given a known fixture file, When getFileLastCommit is called, Then it returns sha (40-char hex), date (ISO 8601), author, and message
- Given a non-existent file path, When getFileLastCommit is called, Then it returns null

### T-002: Add getFilesLastCommits batch function to git-diff.ts
**User Story**: US-002 | **Satisfies ACs**: AC-US2-01, AC-US2-02 | **Status**: [x] completed
**Test Plan**:
- Given 3 known fixture files, When getFilesLastCommits is called, Then it returns a Map of size 3 with valid commit info
- Given an empty file list, When getFilesLastCommits is called, Then it returns an empty Map
- Given a mix of existing and non-existent files, When getFilesLastCommits is called, Then it returns info only for existing files

## Phase 2: Adapter Integration

### T-003: Wire git commit info into repo adapter chunk creation
**User Story**: US-001 | **Satisfies ACs**: AC-US1-01, AC-US1-02, AC-US1-03, AC-US1-04, AC-US1-05, AC-US2-03 | **Status**: [x] completed
**Test Plan**:
- Given the test-repo fixture, When ingest runs, Then code chunks have ISO 8601 timestamp from git history
- Given the test-repo fixture, When ingest runs, Then markdown chunks have ISO 8601 timestamp from git history
- Given the test-repo fixture, When ingest runs, Then all chunks have lastCommitSha (40-char hex) in metadata
- Given the test-repo fixture, When ingest runs, Then all chunks have non-empty lastCommitAuthor in metadata
- Given the test-repo fixture, When ingest runs, Then all chunks have lastCommitMessage in metadata

## Phase 3: Verification

### T-004: Build, test, and lint verification
**User Story**: US-001, US-002 | **Satisfies ACs**: all | **Status**: [x] completed
**Test Plan**:
- Given all changes, When pnpm test runs, Then 907 tests pass
- Given all changes, When pnpm build runs, Then no TypeScript errors
- Given all changes, When pnpm lint:fix runs, Then no lint errors
