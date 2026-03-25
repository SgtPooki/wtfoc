# Feature Specification: Theme Clustering

**Feature Branch**: `015-theme-clustering`
**Created**: 2026-03-25
**Status**: Draft
**Input**: On-demand k-means clustering over stored chunk embeddings to discover common topics across all ingested sources.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover themes in a collection (Priority: P1)

A team lead or product owner runs `wtfoc themes -c foc-ecosystem` to see what topics exist across all ingested sources (GitHub, docs, Slack, HN, code). They get a ranked list of theme clusters, each showing representative chunks, source distribution, and the most common signal types. This gives them a bird's-eye view of what the collection contains without having to know what to search for.

**Why this priority**: This is the core value — discovery without a query. Everything else builds on having clusters computed.

**Independent Test**: Can be fully tested by running the command against any collection with 100+ chunks and verifying the output contains clusters with representative content, source breakdowns, and signal summaries.

**Acceptance Scenarios**:

1. **Given** a collection with 26K+ chunks across multiple source types, **When** the user runs `wtfoc themes -c foc-ecosystem`, **Then** the output shows a ranked list of theme clusters with size, top terms, representative chunk excerpts, and source type distribution.
2. **Given** a collection with chunks that have signal scores, **When** the user runs the themes command, **Then** each cluster summary includes aggregated signal scores (e.g., "dominant signal: pain (avg 45)").
3. **Given** a small collection with fewer than 10 chunks, **When** the user runs the themes command, **Then** the system produces a single cluster or a clear message that the collection is too small for meaningful clustering.

---

### User Story 2 - Filter themes by signal type (Priority: P2)

An engineer investigating user pain runs `wtfoc themes -c foc-ecosystem --signal pain` to see only clusters dominated by pain-scored chunks. This surfaces the top complaint themes across Slack, HN, and GitHub issues — grouped by topic rather than by source.

**Why this priority**: Signal-filtered clustering is the main differentiator over basic topic discovery. It connects the signal scoring system (#61) to actionable thematic analysis.

**Independent Test**: Can be tested by running with `--signal pain` and verifying all returned clusters have above-average pain signal scores, and that low-pain clusters are excluded.

**Acceptance Scenarios**:

1. **Given** a collection with signal-scored chunks, **When** the user runs `wtfoc themes --signal pain -c foc-ecosystem`, **Then** only clusters where pain is the dominant signal type are shown.
2. **Given** a collection with no chunks scoring on the requested signal, **When** the user runs with `--signal demand_signal`, **Then** a clear message indicates no clusters match that signal filter.

---

### User Story 3 - JSON output for programmatic use (Priority: P3)

A CI pipeline or agent runs `wtfoc themes -c foc-ecosystem --json` to get structured cluster data for automated processing — feeding into dashboards, reports, or downstream analysis tools.

**Why this priority**: Programmatic access enables integration with other tools and workflows, but the human-readable CLI output (P1) must work first.

**Independent Test**: Can be tested by running with `--json` and parsing the output as valid JSON with expected schema (clusters array, each with id, size, terms, representative chunks, source distribution, signal aggregates).

**Acceptance Scenarios**:

1. **Given** any collection, **When** the user runs `wtfoc themes -c foc-ecosystem --json`, **Then** the output is valid JSON matching a documented schema.

---

### Edge Cases

- What happens when the collection has no embeddings (e.g., all chunks were ingested before the embedder was configured)? System should error with a clear message.
- How does clustering handle collections with mixed embedding models across segments? System should warn and cluster only chunks from the dominant model.
- What happens when the user specifies `--k 1` (single cluster) or `--k` larger than the number of chunks? `--k 1` shows a single summary, `--k > n` is capped at n.
- How are empty or near-empty clusters handled? Clusters with fewer than 3 chunks are merged into the nearest neighbor or excluded from output.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST compute theme clusters from stored chunk embeddings on demand, without persisting cluster assignments into segments.
- **FR-002**: System MUST use k-means clustering as the default algorithm with a sensible default k (sqrt(n/2) capped at a reasonable maximum).
- **FR-003**: Each cluster MUST expose evidence-backed summaries: representative chunks (closest to centroid), top terms from stored chunk `terms` fields, source type distribution, and chunk count.
- **FR-004**: Each cluster MUST include aggregated signal scores when chunks have signal data (average per signal type across cluster members).
- **FR-005**: System MUST support filtering clusters by dominant signal type via `--signal <type>` flag.
- **FR-006**: System MUST support overriding the number of clusters via `--k <number>` flag.
- **FR-007**: System MUST support JSON output via `--json` flag with a stable schema.
- **FR-008**: System MUST load the collection via the `mountCollection()` path to ensure revision-stable analysis and access to signal scores.
- **FR-009**: System MUST handle collections with no signal scores gracefully (omit signal aggregates, still cluster by embeddings).
- **FR-010**: System MUST sort clusters by size (largest first) in default output.

### Key Entities

- **ThemeCluster**: A group of semantically similar chunks discovered via embedding clustering. Contains: cluster ID, size, centroid vector, representative chunk IDs, top terms, source type distribution, signal score aggregates.
- **ClusterSummary**: The user-facing output for a single cluster. Contains: rank, size, auto-generated label (from top terms), representative chunk excerpts, source breakdown, dominant signal type and scores.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can discover the top themes in a 26K-chunk collection in under 30 seconds.
- **SC-002**: Each theme cluster exposes at least 3 representative chunk excerpts with source attribution and URLs.
- **SC-003**: Signal-filtered output reduces the cluster list to only relevant themes, with zero clusters shown that have below-average scores for the requested signal type.
- **SC-004**: JSON output is parseable and contains all fields needed to reconstruct the human-readable output programmatically.

## Assumptions

- k-means is sufficient for MVP; HDBSCAN or graph-based community detection can be added later as alternative algorithms.
- Cluster labels are heuristic (derived from stored terms and top content) and clearly marked as such — not authoritative summaries.
- No new `Clusterer` interface in `@wtfoc/common` for MVP. Concrete implementation lives in `@wtfoc/search`. Interface extraction deferred until a second implementation exists.
- Clustering is a one-shot computation, not a persistent/watchable process. Caching can be added later keyed by collection revision ID.
- Edge evidence enrichment (showing how chunks within a cluster are connected by edges) is desirable but can be a follow-up enhancement.

## Related Issues

- **#59** — Clustering: topic discovery, gap detection, and staleness tracking (design discussion — this spec implements the core)
- **#57** — Detect clustered feature requests and map unmet demand (downstream use case enabled by this)
- **#58** — Detect stale documentation (clusters can surface doc/code drift)
- **#61** (closed) — Multi-signal scoring (dependency met — provides signal scores for cluster filtering)
- **US-003** — Cluster repeated feature requests across repos
- **US-014** — Surface unanswered community questions
- **US-013** — Incremental ingest (clusters need to handle growing collections)
