# Feature Specification: Ingest Pipeline

**Feature Branch**: `002-ingest-pipeline`
**Created**: 2026-03-23
**Status**: Implemented (retroactive spec — updated to reflect what was built)
**Package**: `@wtfoc/ingest`

## Overview

`@wtfoc/ingest` provides source-aware chunking, edge extraction, segment building, and pluggable source adapters.

## What Was Built

### Markdown Chunker (`chunker.ts`)

- Markdown-aware splitting: headers > paragraphs > sentences > characters
- Configurable `chunkSize` (default 512) and `chunkOverlap` (default 0)
- Deterministic chunk ID = SHA-256 of content (dedup key)
- Preserves source metadata: `{ source, sourceUrl, timestamp, metadata }`
- 9 tests

### Edge Extractor (`edges/extractor.ts`)

**RegexEdgeExtractor:**
- `#123` → `references` edge (local repo-scoped)
- `owner/repo#456` → `references` edge (cross-repo)
- GitHub issue/PR URLs → `references` edge
- `Closes/Fixes/Resolves #N` → `closes` edge (case-insensitive)
- Dedup: closes targets excluded from references
- All edges have `confidence: 1.0`
- 25 tests

**extractChangedFileEdges():**
- PR changed files → `changes` edge with `repo:path@commitSha`
- Immutable code anchors for verifiable trace

### Repo Adapter (`adapters/repo.ts`)

- Implements `SourceAdapter<RepoAdapterConfig>` with `parseConfig()`
- Clones GitHub repos via `execFile("git", [...])` (no shell injection)
- Walks file tree with configurable include/exclude extensions
- Code files → `sourceType: "code"` with line-based chunking (512 char chunks)
- Markdown files → `sourceType: "markdown"` with markdown-aware chunking
- Edge extraction from code: `import` statements, `// See #42` comments, markdown links
- Default max file size: 100KB
- Default excludes: node_modules, dist, .git, __pycache__, etc.
- 10 tests using local fixture directory

### Segment Builder (`segment-builder.ts`)

- `buildSegment(chunks, edges, options)` → immutable `Segment`
- Includes `schemaVersion`, `embeddingModel`, `embeddingDimensions`
- Chunks include `content` field for display in results
- Auto-extracts BM25 terms from content when not provided
- `segmentId()` for deterministic dedup (SHA-256 of serialized JSON)
- 10 tests

### Source Adapter Interface

Generic `SourceAdapter<TConfig>` with:
- `parseConfig(raw: Record<string, unknown>): TConfig` — validates at boundary
- `ingest(config: TConfig): AsyncIterable<Chunk>` — streaming chunks
- `extractEdges(chunks: Chunk[]): Edge[]` — typed edges

## Key Design Decisions

1. **`SourceAdapter` is generic over config.** Each adapter defines its own config type and validates it via `parseConfig()`. The CLI handles the untyped → typed boundary.

2. **Content stored in segments.** Segment chunks include the actual text content, not just embeddings. This enables: display in trace results, re-embedding with new models, CID-mounted reuse.

3. **Edge type is a string, not an enum.** Three built-in types (`references`, `closes`, `changes`) but custom types welcome for extensibility.

4. **Repo adapter uses `execFile`, not `exec`.** Prevents shell injection when cloning repos.

5. **BM25 terms extracted automatically.** Lowercased, split on whitespace/punctuation, deduplicated. Stored in segments for future sparse search.

## Test Coverage

| Component | Tests |
|-----------|-------|
| Markdown chunker | 9 |
| RegexEdgeExtractor | 25 |
| Repo adapter | 10 |
| Segment builder | 10 |
| **Total** | **54** |

## Dependencies

- `@wtfoc/common` — Chunk, Edge, Segment, SourceAdapter interfaces

## Out of Scope (v1)

- Slack JSON adapter (#10)
- GitHub API adapter (#11)
- Discord adapter (#31)
- Website/Nova adapter (#32)
- Code-aware chunking (AST, function boundaries)
