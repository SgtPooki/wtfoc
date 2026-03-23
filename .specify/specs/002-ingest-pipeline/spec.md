# Feature Specification: Ingest Pipeline

**Feature Branch**: `002-ingest-pipeline`
**Created**: 2026-03-23
**Status**: Draft
**Package**: `@wtfoc/ingest`

## Overview

Implement `@wtfoc/ingest` — source-aware chunking, edge extraction, and segment creation. Takes raw source data (Slack JSON, GitHub issues/PRs/code) and produces typed chunks with extracted edges, bundled into segments ready for storage.

## User Scenarios & Testing

### User Story 1 — Chunk a markdown document (Priority: P1)

A developer chunks a markdown document into source-typed chunks with deterministic IDs.

**Acceptance Scenarios**:

1. **Given** a markdown string, **When** I chunk it, **Then** I get an array of `Chunk` objects with `sourceType: 'markdown'`, deterministic `id` (SHA-256 of content), and provenance metadata.
2. **Given** `chunkSize: 512` and `chunkOverlap: 50`, **Then** chunks respect those boundaries, splitting on headers > paragraphs > sentences > characters.
3. **Given** the same document chunked twice, **Then** identical chunks have identical `id` values (dedup key).
4. **Given** a document with headers, **Then** chunks prefer splitting at header boundaries over mid-paragraph.

---

### User Story 2 — Ingest a Slack JSON export (Priority: P1)

A developer ingests a Slack channel export and gets typed chunks with edge extraction.

**Acceptance Scenarios**:

1. **Given** a Slack export JSON file (standard workspace export format), **When** I ingest it, **Then** I get chunks with `sourceType: 'slack-message'`, `source` = channel name, `timestamp` from message ts.
2. **Given** Slack messages containing `#123` or `owner/repo#456`, **Then** edges are extracted with `type: 'references'`, `evidence` showing the extracted text, `confidence: 1.0`.
3. **Given** Slack messages containing URLs to GitHub issues/PRs, **Then** edges are extracted linking to the target.
4. **Given** threaded messages, **Then** thread replies are grouped with their parent (chunk includes thread context).

---

### User Story 3 — Ingest GitHub issues and PRs (Priority: P1)

A developer ingests a GitHub repo's issues and PRs and gets typed chunks with edge extraction.

**Acceptance Scenarios**:

1. **Given** a GitHub repo identifier, **When** I ingest via `gh` CLI, **Then** I get chunks for issues (`sourceType: 'github-issue'`) and PRs (`sourceType: 'github-pr'`) with `sourceUrl` linking to GitHub.
2. **Given** a PR body containing "Closes #142" or "Fixes #142", **Then** an edge is extracted with `type: 'closes'`, `targetId: 'owner/repo#142'`, `confidence: 1.0`.
3. **Given** a PR with changed files, **Then** edges are extracted with `type: 'changes'`, `targetType: 'file'`, `targetId` including repo, path, and commitSha (immutable code anchor).
4. **Given** an issue body referencing another issue `#99`, **Then** an edge with `type: 'references'` is extracted.

---

### User Story 4 — Bundle chunks into a segment (Priority: P1)

A developer bundles ingested chunks + edges into a segment ready for storage.

**Acceptance Scenarios**:

1. **Given** an array of chunks and edges, **When** I create a segment, **Then** the segment includes `schemaVersion: 1`, `embeddingModel`, `embeddingDimensions`, and all chunks/edges.
2. **Given** chunks from multiple sources, **Then** the segment preserves all source types and metadata.
3. **Given** a segment, **When** serialized and deserialized, **Then** all fields round-trip correctly.

---

### User Story 5 — Pluggable source adapters (Priority: P2)

A developer registers a custom source adapter.

**Acceptance Scenarios**:

1. **Given** a class implementing `SourceAdapter`, **When** registered with the ingest pipeline, **Then** `ingest <type>` uses it.
2. **Given** two adapters for different source types, **Then** they don't interfere with each other.

### Edge Cases

- Empty Slack export → zero chunks, no error
- GitHub repo with no issues → zero chunks, no error
- Slack message with no extractable references → chunk created, no edges
- Very large document → chunked within limits, no OOM
- Malformed Slack JSON → typed error with context
- GitHub rate limit → typed error, retry guidance

## Requirements

- **FR-001**: Markdown-aware chunker splitting on headers > paragraphs > sentences > characters
- **FR-002**: Deterministic chunk ID = SHA-256 of content (dedup key)
- **FR-003**: Slack JSON export adapter producing typed chunks + edges
- **FR-004**: GitHub adapter (via `gh` CLI) producing typed chunks + edges for issues, PRs, and changed files
- **FR-005**: Edge extraction: `references` (issue/PR refs), `closes` (PR closing keywords), `changes` (PR changed files with commit anchors)
- **FR-006**: Segment builder bundling chunks + edges with schema metadata
- **FR-007**: All adapters implement `SourceAdapter` interface from `@wtfoc/common`
- **FR-008**: `EdgeExtractor` interface for pluggable extraction
- **FR-009**: CLI ingest command pattern: `wtfoc ingest <source-type> [args]`

## Key Entities

- **Chunk**: `{ id, content, sourceType, source, sourceUrl?, timestamp?, chunkIndex, totalChunks, metadata }`
- **Edge**: `{ type, sourceId, targetType, targetId, evidence, confidence }`
- **Segment**: `{ schemaVersion, embeddingModel, embeddingDimensions, chunks[], edges[] }`

## Success Criteria

- **SC-001**: Markdown chunking produces deterministic, reproducible output
- **SC-002**: Slack ingest extracts issue references from real-format export JSON
- **SC-003**: GitHub ingest extracts closing keywords and changed files with commit anchors
- **SC-004**: All tests run locally without network (mock gh CLI output)
- **SC-005**: Custom source adapter plugs in with zero internal changes

## Dependencies

- `@wtfoc/common` — Chunk, Edge, Segment, SourceAdapter, EdgeExtractor interfaces
- `@wtfoc/store` — segment serialization (peer dep)
