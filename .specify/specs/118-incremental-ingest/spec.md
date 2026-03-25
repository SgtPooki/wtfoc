# Feature Specification: Incremental Ingest Pipeline

**Feature Branch**: `118-incremental-ingest`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "Incremental ingest, chunking, and indexing pipeline (GitHub issue #102)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Incremental Source Fetching (Priority: P1)

A user who has previously ingested a large GitHub repository (hundreds of issues/PRs) re-runs `wtfoc ingest github` for the same collection. Instead of re-fetching all items from the API and relying on chunk-level dedup, the system remembers the last successful ingest timestamp for that source and only fetches items created or updated after that point. This dramatically reduces API calls, network traffic, and processing time for repeat ingests.

**Why this priority**: This is the highest-impact improvement. Large GitHub orgs can have thousands of issues/PRs. Re-fetching everything on each run wastes API quota and time, making regular re-ingestion impractical. The GitHub adapter already supports a `since` parameter — the gap is that the user must manually supply it each time.

**Independent Test**: Can be fully tested by running `wtfoc ingest github owner/repo -c test` twice and verifying the second run fetches only new/updated items and completes significantly faster.

**Acceptance Scenarios**:

1. **Given** a collection that was previously ingested from a GitHub repo, **When** the user runs `wtfoc ingest github owner/repo -c collection` without a `--since` flag, **Then** the system automatically resumes from where the last successful ingest left off, fetching only newer items.
2. **Given** a collection with a stored cursor for a source, **When** the user explicitly passes `--since 30d`, **Then** the explicit flag overrides the stored cursor and fetches items from the specified time range.
3. **Given** a first-time ingest for a new source in an existing collection, **When** the ingest completes successfully, **Then** the system persists a cursor for that source so the next run can resume incrementally.
4. **Given** an ingest that fails mid-run, **When** the user re-runs the same command, **Then** the cursor is NOT advanced (only successful runs update the cursor), and chunk-level dedup prevents duplicate work for any batches that already completed.

---

### User Story 2 - Incremental Vector Indexing (Priority: P2)

A user loads a collection into a persistent vector backend (e.g., Qdrant). After ingesting new content into the collection, they reload it. Instead of re-indexing all segments from scratch, the system identifies which segments are already indexed and only indexes the new ones. This makes collection reloading fast and practical for growing collections.

**Why this priority**: With persistent vector backends, re-indexing thousands of already-indexed segments is pure waste. This becomes critical as collections grow and users add content incrementally. It builds on P1 (incremental ingest produces new segments that need efficient indexing).

**Independent Test**: Can be tested by mounting a collection, adding new segments via ingest, then re-mounting and verifying only new segments are embedded and indexed.

**Acceptance Scenarios**:

1. **Given** a collection with 10 segments already indexed in a persistent vector backend, **When** 2 new segments are added via ingest and the collection is reloaded, **Then** only the 2 new segments are indexed (embedded and added to the vector store).
2. **Given** a collection being loaded for the first time into a vector backend, **When** the mount completes, **Then** all segments are indexed and the system records which segments have been indexed.
3. **Given** a segment that was previously indexed but has since been removed from the collection, **When** the collection is reloaded with reconciliation enabled, **Then** the orphaned vectors are cleaned up from the index.

---

### User Story 3 - Partial Re-chunking (Priority: P3)

A user runs `wtfoc reindex --rechunk` to adjust chunk sizes for a collection. Instead of re-chunking every segment from scratch, the system inspects each chunk and only re-chunks those that exceed the new size limit. Chunks that are already within bounds are preserved unchanged, saving processing time and maintaining stable chunk IDs for content that hasn't changed.

**Why this priority**: While valuable for efficiency, re-chunking is a less frequent operation than ingesting or indexing. The existing `reindex --rechunk` already works correctly — this optimization reduces unnecessary reprocessing but isn't blocking any workflow.

**Independent Test**: Can be tested by creating a collection with mixed chunk sizes, running `reindex --rechunk --max-chunk-chars 2000`, and verifying only chunks exceeding 2000 chars are re-split while smaller chunks retain their original IDs.

**Acceptance Scenarios**:

1. **Given** a collection with chunks of varying sizes (some under 2000 chars, some over 4000 chars), **When** `reindex --rechunk --max-chunk-chars 3000` is run, **Then** only chunks exceeding 3000 chars are re-split; chunks already under the limit retain their original IDs and content.
2. **Given** a collection where all chunks are already within the size limit, **When** `reindex --rechunk` is run, **Then** the system detects no work is needed and completes quickly without re-embedding unchanged chunks.
3. **Given** a partial re-chunk that produces new chunks from oversized originals, **When** the reindex completes, **Then** the new chunks have updated IDs and metadata, while unchanged chunks are byte-identical to the originals.

---

### Edge Cases

- What happens when a source's API changes its pagination format between ingest runs? The system should fall back to a full fetch if the stored cursor is incompatible.
- How does the system handle clock skew between the local machine and the source API? Cursors should use the source's timestamps (from API responses), not local time.
- What happens when a previously ingested item is deleted from the source? Incremental ingest won't detect deletions — this is expected and documented behavior.
- What happens if the vector backend is wiped but the segment tracking still shows segments as indexed? The system should detect the mismatch and re-index as needed.
- What happens when two concurrent ingest runs target the same collection? The existing manifest conflict detection (prevHeadId check) prevents corruption; the second writer retries or fails gracefully.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist the last successful ingest position (cursor) per source per collection after a successful ingest run completes.
- **FR-002**: System MUST automatically use the stored cursor to limit fetching to new/updated items when re-running ingest for a previously ingested source, without requiring user intervention.
- **FR-003**: System MUST allow users to override the stored cursor with an explicit `--since` flag.
- **FR-004**: System MUST NOT update the stored cursor if an ingest run fails or is interrupted before completion.
- **FR-005**: System MUST track which segments have been indexed in a vector backend and skip already-indexed segments when reloading a collection.
- **FR-006**: System MUST index only new or changed segments when a collection is reloaded into a persistent vector backend.
- **FR-007**: System MUST preserve existing chunks that are within the size limit during a `reindex --rechunk` operation, only re-splitting chunks that exceed the specified maximum.
- **FR-008**: System MUST skip re-embedding chunks whose content has not changed during a partial re-chunk operation.
- **FR-009**: System MUST use source-provided timestamps (not local clock) for cursor values to avoid clock-skew issues.
- **FR-010**: System MUST support cursor persistence for all existing source adapters (GitHub, Slack, filesystem/markdown).

### Key Entities

- **Ingest Cursor**: Represents the last successful ingest position for a specific source within a collection. Contains the source identifier, cursor type (timestamp, page token, etc.), cursor value, and the timestamp of the last successful run.
- **Segment Index Record**: Tracks whether a specific segment has been indexed in a vector backend. Contains the segment ID, the backend identifier, and when it was indexed.
- **Chunk Size Evaluation**: A per-chunk assessment during re-chunking that determines whether a chunk needs to be re-split based on the target size limit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Re-running ingest for a previously ingested source with no new content completes in under 5 seconds (excluding network latency for the initial check), compared to the current full re-fetch time.
- **SC-002**: Re-running ingest for a source with 10 new items out of 1000 total fetches only the new items, reducing data transfer by over 90%.
- **SC-003**: Reloading a collection of 50 segments into a persistent vector backend where 45 segments are already indexed processes only the 5 new segments, reducing indexing time proportionally.
- **SC-004**: Running `reindex --rechunk` on a collection where 80% of chunks are already within the size limit re-processes only the oversized 20%, preserving the IDs and embeddings of unchanged chunks.
- **SC-005**: All incremental operations produce results identical to a full re-run — no data loss, no missed items, no stale entries.
