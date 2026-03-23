# Feature Specification: End-to-End Integration Pipeline

**Feature Branch**: `012-e2e-integration-pipeline`
**Created**: 2026-03-23
**Status**: Draft (addressing Cursor cross-review)
**Input**: User description: "End-to-end integration test: wire @wtfoc/ingest, @wtfoc/store, and @wtfoc/search together and verify the full pipeline — ingest sources, embed chunks, store segments with CollectionHead, run trace/query across sources, and verify edge-following produces correct chains. Refs issue #24."

## Clarifications

### Cross-review 2026-03-23 (Cursor)

- Embedder must be mocked/deterministic — real TransformersEmbedder may download model weights, violating FR-002.
- currentRevisionId may be null after ingest (no publish step). Tests assert nullable behavior.
- Trace scenario 3 reworded: trace uses semantic seeds first, then edge expansion. With no edges, results are semantic-only. There is no separate "dead end → extra semantic" phase.
- SC-004 tightened: assert schema validation on loaded segments/head after round-trip.
- Idempotency edge case removed (behavior not guaranteed by current API).
- Test file must live under `packages/*/src/**/*.test.ts` to be discovered by vitest.
- Added mount/hydrate scenario: reload segments from storage and build index (not from in-memory objects).

## Overview

This feature adds integration tests that exercise the full wtfoc pipeline end-to-end: ingest source data, chunk and embed it, extract edges, store segments, update a CollectionHead, then run query and trace against the stored data. The tests use local storage, in-memory vector index, and a mock/deterministic embedder (no network calls) and verify that data flows correctly across all package boundaries.

This is the integration point that proves the architecture works before the CLI wraps it all.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Full ingest-to-query pipeline (Priority: P1)

A developer ingests source data from a repository, stores it as a segment in a collection, then reloads the collection from storage (mount path), runs a semantic query, and receives relevant results ranked by similarity.

**Why this priority**: This is the core pipeline — if ingest → store → mount → query doesn't work end-to-end, nothing else matters.

**Independent Test**: Ingest a small synthetic dataset, store it, reload from storage via mount, run a query, and verify results contain the expected content.

**Acceptance Scenarios**:

1. **Given** synthetic source data (markdown content), **When** the data is ingested, chunked, embedded (mock embedder), and stored as a segment, **Then** the CollectionHead is updated with the segment summary, collectionId is set, and currentRevisionId is null (no publish step).
2. **Given** a stored collection, **When** segments are reloaded from storage and the vector index is rebuilt (mount path), **Then** the query returns results ranked by relevance with content matching the ingested data.
3. **Given** the query results, **When** each result is inspected, **Then** it includes the original content, source type, source identifier, and a non-zero similarity score.
4. **Given** the stored segment is loaded back from storage, **When** it is deserialized, **Then** it passes schema validation (round-trip integrity).

---

### User Story 2 - Full ingest-to-trace pipeline with edge following (Priority: P1)

A developer ingests source data that contains cross-references (e.g., "Refs #123", "closes #456"), then runs a trace query that finds semantic seeds and follows explicit edges to produce evidence-backed connections.

**Why this priority**: Trace is the differentiator — it follows explicit edges, not just semantic similarity. Proving edge extraction and traversal work end-to-end is critical.

**Independent Test**: Ingest data with known cross-references, run a trace, and verify the trace follows edges and includes evidence for each hop.

**Acceptance Scenarios**:

1. **Given** source data containing explicit cross-references between artifacts, **When** the data is ingested with edge extraction, **Then** edges are stored in the segment with correct type, source, target, and evidence fields.
2. **Given** a collection with edges, **When** a trace query is run, **Then** the trace result includes hops that follow explicit edges with evidence explaining each connection.
3. **Given** source data with no cross-references, **When** a trace is run, **Then** results are semantic-only (no edge hops) since trace uses semantic seeds first, then expands via edges.

---

### User Story 3 - Multi-source ingest into single collection (Priority: P2)

A developer ingests data from multiple sources (e.g., two different repos) into the same collection, then queries across all sources and gets unified results.

**Why this priority**: Real-world usage involves multiple sources in one collection. This verifies that the pipeline handles multi-source correctly.

**Independent Test**: Ingest from two synthetic sources into one collection, query, and verify results span both sources.

**Acceptance Scenarios**:

1. **Given** two different source datasets, **When** both are ingested into the same collection with correct prevHeadId chaining, **Then** the CollectionHead has two segments with distinct source types.
2. **Given** a multi-source collection, **When** a query is run, **Then** results from both sources appear in the ranked results.

---

### Edge Cases

- Ingesting empty source data (zero chunks) produces no segment and no CollectionHead update
- Querying an empty collection returns zero results without error
- Tracing with no edges produces semantic-only results (no edge hops)
- CollectionHead conflict detection rejects writes with wrong prevHeadId (typed error)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The integration test MUST exercise the full pipeline: ingest → chunk → embed → extract edges → build segment → store segment → update CollectionHead → mount (reload from storage) → query → trace.
- **FR-002**: All tests MUST use local storage, in-memory vector index, and a mock/deterministic embedder. No network calls, no model downloads.
- **FR-003**: The tests MUST verify that chunks, embeddings, and edges survive the full round-trip from ingest through storage reload to query/trace results.
- **FR-004**: The tests MUST verify that trace follows explicit edges and includes evidence for each hop.
- **FR-005**: The tests MUST verify that query returns results ranked by semantic similarity with non-zero scores.
- **FR-006**: The tests MUST verify that the CollectionHead is correctly updated with segment summaries and collectionId after ingest. currentRevisionId is expected to be null (no publish step in the integration test).
- **FR-007**: The tests MUST verify that multi-source ingests into a single collection produce a unified searchable/traceable dataset.
- **FR-008**: The test file MUST live under `packages/*/src/**/*.test.ts` to be discovered by the standard `pnpm test` suite.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A single test file exercises the complete ingest → store → mount → query → trace pipeline and passes.
- **SC-002**: The integration test verifies at least 6 distinct pipeline stages: chunk, embed, edge extract, store, mount/reload, query, trace.
- **SC-003**: All integration tests complete in under 5 seconds using local/in-memory backends.
- **SC-004**: Stored segments and CollectionHead pass schema validation after round-trip through storage, catching format regressions.

## Out of Scope

- FOC storage integration (network-dependent, tested separately)
- CLI command testing (tested via CLI-specific tests)
- Performance benchmarking beyond basic timeout
- Real-world data (uses synthetic fixtures only)
- Collection publication (revision creation) — tested separately in spec 009

## References

- Issue #24: Integration: end-to-end ingest → search → trace pipeline
- Spec 010: CAR Bundle Uploads (merged — CollectionHead + batches)
- Spec 009: Collection Provenance (merged — CollectionHead + revisions + mount)
