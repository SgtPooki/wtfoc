# Feature Specification: Search and Trace

**Feature Branch**: `003-search-and-trace`
**Created**: 2026-03-23
**Status**: Draft
**Package**: `@wtfoc/search`

## Overview

Implement `@wtfoc/search` — local embeddings, vector search, and the hero `trace` command that follows explicit edges across source types with semantic fallback.

## User Scenarios & Testing

### User Story 1 — Embed text locally (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a text string, **When** I embed it, **Then** I get a Float32Array of the configured dimensions (384 for MiniLM).
2. **Given** a batch of texts, **When** I embedBatch, **Then** I get matching Float32Arrays.
3. **Given** first use (cold start), **When** model isn't cached, **Then** it downloads and caches automatically.
4. **Given** an AbortSignal, **When** aborted, **Then** embedding rejects.

---

### User Story 2 — Vector search (Priority: P1)

**Acceptance Scenarios**:

1. **Given** indexed vectors, **When** I search with a query vector, **Then** I get results sorted by cosine similarity.
2. **Given** `topK: 3`, **Then** at most 3 results returned.
3. **Given** an empty index, **Then** search returns empty array, no error.
4. **Given** a VectorIndex, **When** serialized and deserialized, **Then** search produces same results.

---

### User Story 3 — Trace across sources (Priority: P1)

The hero feature. Given a query, follow explicit edges across source types and fall back to semantic search when no edges exist.

**Acceptance Scenarios**:

1. **Given** a collection with Slack messages, GitHub issues, PRs, and code chunks, **When** I trace "upload failures", **Then** results are grouped by sourceType with edge annotations.
2. **Given** a Slack message with edge `references → #142`, **Then** trace follows the edge and includes issue #142 in results.
3. **Given** issue #142 with edge `closes ← PR #156`, **Then** trace follows to the PR.
4. **Given** PR #156 with edge `changes → file.ts @ commitSha`, **Then** trace includes the code chunk.
5. **Given** no explicit edges from a chunk, **Then** trace falls back to semantic similarity search.
6. **Given** trace results, **Then** each result includes: content snippet, sourceType, source, CID/storageId, edge annotation ("why" this is connected), confidence score.

---

### User Story 4 — Query (semantic search) (Priority: P2)

Simple semantic search without edge following.

**Acceptance Scenarios**:

1. **Given** a query string, **When** I query a collection, **Then** I get ranked results with scores and storage IDs.
2. **Given** results, **Then** each includes sourceType for diversification.
3. **Given** `--json` flag, **Then** output is machine-readable.

---

### User Story 5 — Pluggable embedder and vector index (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a custom `Embedder` implementation, **When** passed to search, **Then** it's used instead of the default.
2. **Given** a custom `VectorIndex` (e.g. Qdrant adapter), **Then** search/trace works with it.

### Edge Cases

- Query with no results → empty response, no error
- Trace hits a cycle in edges → stop at visited nodes, no infinite loop
- Embedding model download fails → EmbedFailedError with retry guidance
- Very large index → brute-force is slow but correct (demo scale only)

## Requirements

- **FR-001**: `TransformersEmbedder` using @huggingface/transformers with Xenova/all-MiniLM-L6-v2 (384d)
- **FR-002**: `OpenAIEmbedder` as fallback (requires API key)
- **FR-003**: `InMemoryVectorIndex` with brute-force cosine similarity
- **FR-004**: `trace()` function: query → embed → find seed chunks → follow edges → semantic fallback → grouped output
- **FR-005**: `query()` function: embed → vector search → ranked results with storage IDs
- **FR-006**: Cycle detection in edge traversal
- **FR-007**: All pluggable via Embedder and VectorIndex interfaces

## Dependencies

- `@wtfoc/common` — Embedder, VectorIndex, Edge interfaces
- `@wtfoc/store` — download chunks for trace results (peer dep)
- `@huggingface/transformers` — local embeddings
