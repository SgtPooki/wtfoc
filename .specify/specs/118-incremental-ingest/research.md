# Research: Incremental Ingest Pipeline

## R1: Cursor Storage Format & Location

**Decision**: Store cursors as JSON sidecar files alongside the manifest, following the existing extraction-status.ts pattern (atomic write via temp+rename).

**Rationale**: The extraction-status store already uses this exact pattern for per-collection sidecar files. It's proven, crash-safe, and requires no new dependencies. Cursors are keyed by a source identifier (e.g., `github:owner/repo`) so multiple sources can be tracked per collection.

**Alternatives considered**:
- Embed cursors in the CollectionHead manifest: Rejected — cursors are mutable operational state, not part of the immutable content-addressed data model. Changing the manifest schema would break compatibility.
- Separate SQLite database: Rejected — over-engineered for simple key-value cursor data. Adds a dependency.

## R2: Cursor Key Format (Source Identity)

**Decision**: Use `{adapterType}:{sourceArg}` as the cursor key (e.g., `github:owner/repo`, `repo:/path/to/dir`). This matches the raw source argument from the CLI.

**Rationale**: The source argument uniquely identifies what's being ingested. The adapter type prefix prevents collisions between different adapters pointing at the same string.

**Alternatives considered**:
- Hash of config object: Rejected — config changes (like adding `types` filter) would invalidate the cursor unnecessarily.
- Just source arg without adapter prefix: Rejected — theoretically `repo:owner/repo` and `github:owner/repo` could collide.

## R3: What Timestamp to Use for Cursors

**Decision**: Use the maximum `updatedAt` timestamp from the API response items, not local clock time. For filesystem sources, use the maximum `mtime` of processed files.

**Rationale**: Using source-provided timestamps avoids clock-skew issues between the local machine and the source API. The GitHub API's `since` parameter filters by `updated_at`, so using that timestamp ensures no items are missed.

**Alternatives considered**:
- Local timestamp at ingest start: Rejected — clock skew between local machine and GitHub could cause missed items.
- Local timestamp at ingest end: Same clock-skew problem, plus items created during a long ingest could be missed.

## R4: Incremental Vector Indexing Strategy

**Decision**: During `mountCollection()`, compare the segment IDs in the manifest against a set of "already indexed" segment IDs. The vector index's `add()` already has upsert semantics (replace if ID exists), but downloading and processing segments that are already indexed is the waste to eliminate. Track indexed segments via a `Set<string>` that the caller can provide.

**Rationale**: The mount function currently downloads and processes ALL segments. For persistent backends like Qdrant, previously indexed segments don't need to be re-downloaded, parsed, or re-added. The simplest approach is to let the caller pass in a set of known-indexed segment IDs and skip those.

**Alternatives considered**:
- Query the vector index for existing IDs: Rejected — not all backends support efficient bulk-exists checks, and it would couple mount logic to specific backend capabilities.
- Track indexed segments in a sidecar file: Considered but deferred — the mount function can use the vector index's own `size` as a heuristic, or the caller can track this externally. For MVP, passing a skip-set is sufficient.

## R5: Partial Re-chunk Strategy

**Decision**: During `reindex --rechunk`, check each chunk's content length against the target max. Only re-chunk those exceeding the limit. Preserve original chunks (with their IDs and embeddings) for chunks within bounds.

**Rationale**: The existing `rechunkOversized()` function already handles the splitting logic. The gap is in the reindex command which currently re-embeds ALL chunks regardless. By separating chunks into "keep as-is" and "needs re-chunk + re-embed" sets, we avoid unnecessary embedding API calls.

**Alternatives considered**:
- Re-chunk everything but skip re-embedding unchanged chunks: Partially addresses the issue but still wastes CPU on chunking. Better to skip both.
- Content-hash-based change detection: Over-engineered — size check is sufficient for the rechunk use case.
