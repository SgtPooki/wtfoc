# Implementation Plan: Add temporal metadata to code chunks

## Overview

Add two new functions to `git-diff.ts` (`getFileLastCommit`, `getFilesLastCommits`) and wire them into the repo adapter's ingest loop. No schema changes needed — `Chunk.timestamp` and `ChunkerDocument.timestamp` already exist as optional fields, and all chunkers already propagate `document.timestamp` to output chunks.

## Architecture

### Components
- **git-diff.ts**: New `getFileLastCommit()` and `getFilesLastCommits()` functions using `execFileAsync` pattern
- **adapter.ts**: Calls `getFilesLastCommits()` after file discovery, populates `timestamp` and commit metadata on `ChunkerDocument`

### Data Flow
1. File discovery produces list of absolute paths
2. `getFilesLastCommits()` runs `git log -1 --format=%H%x09%aI%x09%an%x09%s` per file with concurrency pool
3. Returns `Map<string, FileCommitInfo>` keyed by relative path
4. Adapter sets `timestamp` on `ChunkerDocument` and adds `lastCommitSha`, `lastCommitAuthor`, `lastCommitMessage` to metadata
5. Chunkers propagate `timestamp` to all output chunks automatically
6. Metadata propagates via existing `...chunk.metadata` spread

### Key Design Decisions
- **Per-file git log with concurrency pool** over single batched command: simpler, correct, fast enough for repos up to ~5000 files
- **Concurrency default of 20**: balances throughput vs shell process limits
- **Tab separator (`%x09`)** in git format: avoids conflicts with pipe characters in commit messages
- **No schema changes**: leverages existing optional fields

## Files Modified

| File | Change |
|------|--------|
| `packages/ingest/src/adapters/repo/git-diff.ts` | Add `FileCommitInfo`, `getFileLastCommit()`, `getFilesLastCommits()` |
| `packages/ingest/src/adapters/repo/adapter.ts` | Import new functions, call after file discovery, populate timestamp + metadata |
| `packages/ingest/src/adapters/repo/git-diff.test.ts` | New test file for git log functions |
| `packages/ingest/src/adapters/repo.test.ts` | New "temporal metadata" describe block |
