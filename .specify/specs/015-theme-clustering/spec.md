# Feature Specification: Theme Clustering

**Feature Branch**: `015-theme-clustering`
**Created**: 2026-03-25
**Status**: Draft (revised per Codex review + owner feedback)
**Input**: Pluggable, incremental theme clustering over stored chunk embeddings to discover and track common topics across all ingested sources.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover themes in a collection (Priority: P1)

A team lead or product owner runs `wtfoc themes -c foc-ecosystem` to see what topics exist across all ingested sources (GitHub, docs, Slack, HN, code). They get a ranked list of theme clusters, each showing representative exemplar chunks, source distribution, and the most common signal types. This gives them a bird's-eye view of what the collection contains without having to know what to search for.

**Why this priority**: This is the core value — discovery without a query. Everything else builds on having clusters computed.

**Independent Test**: Can be fully tested by running the command against any collection with 100+ chunks and verifying the output contains clusters with representative content, source breakdowns, and signal summaries.

**Acceptance Scenarios**:

1. **Given** a collection with 26K+ chunks across multiple source types, **When** the user runs `wtfoc themes -c foc-ecosystem`, **Then** the output shows a ranked list of theme clusters with size, top terms, exemplar chunk excerpts, and source type distribution.
2. **Given** a collection with chunks that have signal scores, **When** the user runs the themes command, **Then** each cluster summary includes aggregated signal scores (e.g., "dominant signal: pain (avg 45)").
3. **Given** a small collection with fewer than 10 chunks, **When** the user runs the themes command, **Then** the system produces a single cluster or a clear message that the collection is too small for meaningful clustering.

---

### User Story 2 - Filter themes by signal type (Priority: P2)

An engineer investigating user pain runs `wtfoc themes -c foc-ecosystem --signal pain` to see only clusters where pain is the highest-scoring signal type. This surfaces the top complaint themes across Slack, HN, and GitHub issues — grouped by topic rather than by source.

**Why this priority**: Signal-filtered clustering connects the signal scoring system (#61) to actionable thematic analysis — the main differentiator over basic topic discovery.

**Independent Test**: Can be tested by running with `--signal pain` and verifying all returned clusters have pain as their highest-scoring signal type.

**Acceptance Scenarios**:

1. **Given** a collection with signal-scored chunks, **When** the user runs `wtfoc themes --signal pain -c foc-ecosystem`, **Then** only clusters where the average pain score is the highest among all signal types for that cluster are shown.
2. **Given** a collection with no chunks scoring on the requested signal, **When** the user runs with `--signal demand_signal`, **Then** a clear message indicates no clusters match that signal filter.

---

### User Story 3 - Incremental cluster updates after new ingestion (Priority: P2)

After ingesting new Slack messages or HN discussions, a user runs `wtfoc themes -c foc-ecosystem` and new chunks are assigned to existing clusters or form new ones — without recomputing the entire cluster set from scratch.

**Why this priority**: Collections grow over time. Recomputing clusters from 26K+ chunks on every run is wasteful when only 200 new chunks arrived. Incremental clustering aligns with the incremental ingest story (US-013).

**Independent Test**: Ingest new content, run themes, verify new chunks appear in existing or new clusters without the full cluster set changing.

**Acceptance Scenarios**:

1. **Given** a collection with existing cluster state and 200 newly ingested chunks, **When** the user runs `wtfoc themes -c foc-ecosystem`, **Then** new chunks are assigned to existing clusters or form new clusters, and previously clustered chunks retain their assignments.
2. **Given** a user who wants a full rebuild, **When** they run `wtfoc themes --rebuild -c foc-ecosystem`, **Then** all clusters are recomputed from scratch.

---

### User Story 4 - JSON output for programmatic use (Priority: P3)

A CI pipeline or agent runs `wtfoc themes -c foc-ecosystem --json` to get structured cluster data for automated processing — feeding into dashboards, reports, or downstream analysis tools.

**Why this priority**: Programmatic access enables integration with other tools and workflows, but the human-readable CLI output (P1) must work first.

**Independent Test**: Can be tested by running with `--json` and parsing the output as valid JSON with expected schema.

**Acceptance Scenarios**:

1. **Given** any collection, **When** the user runs `wtfoc themes -c foc-ecosystem --json`, **Then** the output is valid JSON matching a documented schema.

---

### Edge Cases

- What happens when the collection has no embeddings? System errors with a clear message.
- How does clustering handle collections with mixed embedding models across segments? System warns and clusters only chunks from the dominant model, or errors if no dominant model.
- How are very small clusters handled? Clusters with fewer than 3 chunks are excluded from default output (available in JSON with a `small: true` flag).
- What happens on the first run with no existing cluster state? System performs a full batch clustering and persists the initial state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A `Clusterer` interface MUST be defined in `@wtfoc/common` as a pluggable seam, following the same pattern as `Embedder`, `VectorIndex`, `StorageBackend`, etc.
- **FR-002**: The `Clusterer` interface MUST support two modes: batch clustering (full rebuild) and incremental assignment (assign new chunks to existing clusters, form new clusters for outliers).
- **FR-003**: The `Clusterer` interface MUST be algorithm-neutral — no centroid, k, or density parameters in the shared contract. Algorithm-specific options are passed via a typed options object.
- **FR-004**: A default `Clusterer` implementation MUST be provided in `@wtfoc/search`, suitable for collections up to 50K+ chunks without OOM.
- **FR-005**: Each cluster MUST expose evidence-backed summaries: exemplar chunks (most representative members), top terms, source type distribution, chunk count, and confidence score.
- **FR-006**: Each cluster MUST include aggregated signal scores when chunks have signal data (average per signal type across cluster members).
- **FR-007**: System MUST support filtering clusters by signal type via `--signal <type>` flag. Filter rule: show only clusters where the requested signal type has the highest average score among all signal types for that cluster.
- **FR-008**: System MUST support optional `--target-clusters <number>` hint for algorithms that accept it. This is a hint, not a requirement — the algorithm may produce more or fewer clusters. No fixed default cap — the default algorithm is threshold-driven and determines cluster count organically. CLI output limits displayed clusters (default: top 20) without capping the underlying count.
- **FR-009**: System MUST support JSON output via `--json` flag with a stable schema.
- **FR-010**: System MUST load the collection via the `mountCollection()` path to ensure revision-stable analysis and access to signal scores.
- **FR-011**: System MUST handle collections with no signal scores gracefully (omit signal aggregates, still cluster by embeddings).
- **FR-012**: System MUST sort clusters by size (largest first) in default output.
- **FR-013**: Cluster state MUST be persisted in a separate cluster-state store (`~/.wtfoc/clusters/{collection}/{revision}/state.json`), not in segments or manifests. This keeps derived mutable state outside core collection metadata and enables incremental updates without violating immutable segment constraints.
- **FR-014**: System MUST support `--rebuild` flag to force a full batch recluster, ignoring existing cluster state.
- **FR-015**: Cluster labels MUST be auto-generated from exemplar content and stored terms, clearly marked as heuristic. LLM-based naming is a future enrichment, not an MVP requirement.
- **FR-016**: `SPEC.md` and the constitution MUST be updated to list `Clusterer` as an official pluggable seam.

### Key Entities

- **Clusterer** (interface): Pluggable clustering algorithm. Methods: `cluster(request)` for batch mode, `assign(request)` for incremental mode. Lives in `@wtfoc/common`.
- **ClusterRequest**: Input to the clusterer — chunk IDs, embedding references, optional existing cluster state, algorithm-specific options (e.g., `targetClusterCount`, `minClusterSize`, `similarityThreshold`). Default similarity threshold for incremental assignment: cosine similarity >= 0.85 (0.75 was tested in production and produced mega-clusters).
- **ClusterResult**: Output from the clusterer — array of clusters, each with: cluster ID, member chunk IDs, exemplar chunk IDs, confidence score, optional algorithm-specific metadata.
- **ThemeCluster**: A group of semantically similar chunks. Contains: cluster ID, member chunk IDs, exemplar chunk IDs, size, top terms, source type distribution, signal score aggregates, confidence, auto-generated label.
- **ClusterState**: Persisted mutable artifact containing current cluster assignments for a collection. Keyed by collection ID. Updated incrementally or rebuilt on demand. Not stored in segments.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can discover the top themes in a 26K-chunk collection in under 60 seconds (initial batch), and under 10 seconds for incremental updates with fewer than 500 new chunks.
- **SC-002**: Each theme cluster exposes at least 3 exemplar chunk excerpts with source attribution and URLs.
- **SC-003**: Signal-filtered output shows only clusters where the requested signal type is the highest-scoring signal, with zero false inclusions.
- **SC-004**: JSON output is parseable and contains all fields needed to reconstruct the human-readable output programmatically.
- **SC-005**: Swapping the `Clusterer` implementation (e.g., from ANN-based to k-means) requires no changes to the CLI, web API, or output schema — only the implementation module.

## Assumptions

- The default `Clusterer` implementation uses ANN-based incremental clustering, not k-means. K-means may be offered as an alternative implementation.
- Cluster labels are heuristic (derived from stored terms and exemplar content) and clearly marked as such — not authoritative summaries.
- LLM-based cluster naming and deep analysis are future enrichments (P2+), separate from the core clustering interface.
- Cluster state is stored in `~/.wtfoc/clusters/{collection}/{revision}/state.json` — a dedicated store separate from manifests and segments.
- Edge evidence enrichment (showing how chunks within a cluster are connected by edges) is desirable but can be a follow-up enhancement.

## Clarifications

### Session 2026-03-25

- Q: Where should cluster state be persisted? → A: Separate cluster-state store at `~/.wtfoc/clusters/{collection}/{revision}/state.json`, not in manifests or segments.
- Q: What is the default similarity threshold for incremental assignment? → A: Cosine similarity >= 0.85. Initial suggestion was 0.75 but production testing showed this creates mega-clusters (3,736 items in one cluster). 0.85 is the proven threshold.
- Q: What is the default maximum cluster count? → A: No fixed cap. The default algorithm is threshold-driven; cluster count is determined organically. CLI limits displayed clusters to top 20.

## Related Issues

- **#59** — Clustering: topic discovery, gap detection, and staleness tracking (design discussion — this spec implements the core)
- **#57** — Detect clustered feature requests and map unmet demand (downstream use case enabled by this)
- **#58** — Detect stale documentation (clusters can surface doc/code drift)
- **#61** (closed) — Multi-signal scoring (dependency met — provides signal scores for cluster filtering)
- **#3** — Improve edge extraction beyond regex (richer edges = richer cluster evidence)
- **#70** — Notification hooks (alert when new clusters form or grow significantly)
- **US-003** — Cluster repeated feature requests across repos
- **US-014** — Surface unanswered community questions
- **US-013** — Incremental ingest (clusters need to handle growing collections)

## Review History

- **2026-03-25 v1**: Initial draft with k-means, one-shot, no Clusterer interface
- **2026-03-25 v2**: Revised per Codex review + owner feedback:
  - Added `Clusterer` interface as official seam (FR-001, FR-003, FR-016)
  - Switched from one-shot to incremental + batch rebuild (FR-002, FR-013, FR-014)
  - Made contract algorithm-neutral — removed centroid/k-means assumptions (FR-003, FR-008)
  - Fixed signal-filter semantics to "highest-scoring signal type" (FR-007, SC-003)
  - Added ANN-based incremental clustering as default architecture
  - Updated SC-001 timing for incremental vs batch modes
  - Added SC-005 for implementation swappability validation
