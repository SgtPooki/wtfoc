# Feature Specification: Collection Revisions and Provenance

**Feature Branch**: `008-collection-revisions-and-provenance`
**Created**: 2026-03-23
**Status**: Draft
**Input**: User description: "Write a spec that gets wtfoc to the next level with regard to issue #4 and issue #44."

## Overview

This spec connects two open design threads:

- **Issue #4**: how `wtfoc` collections map to FOC datasets and metadata constraints
- **Issue #44**: research-backed direction for provenance, revision-aware retrieval, and evidence-backed knowledge objects

The goal is to define how a `wtfoc` collection should exist as a durable, portable, provenance-aware object on FOC without turning the project into a generic graph database or multi-agent platform.

This spec introduces three core ideas:

1. **One FOC dataset per `wtfoc` collection**
2. **Provenance-aware immutable collection revisions**
3. **CID/bootstrap flows so another user or agent can mount and query a collection without re-embedding the full corpus**

This feature spans `@wtfoc/common`, `@wtfoc/store`, and later `@wtfoc/cli`.

## User Scenarios & Testing

### User Story 1 — Publish a collection to FOC with stable collection identity (Priority: P1)

An operator stores a `wtfoc` collection on FOC and gets a stable collection identity that maps cleanly to one dataset, one revision history, and many immutable artifacts.

**Why this priority**: Issue #4 is blocking a coherent FOC storage story. Without a dataset strategy, collection portability and discoverability remain ambiguous.

**Independent Test**: Create a collection named `team-intel`, publish its first revision to FOC, and verify that all uploaded artifacts resolve under a single dataset with predictable metadata and stable collection identity.

**Acceptance Scenarios**:

1. **Given** a new collection `team-intel`, **When** it is first published to FOC, **Then** `wtfoc` creates exactly one FOC dataset for that collection.
2. **Given** an existing collection dataset, **When** a new revision is published, **Then** `wtfoc` reuses the same dataset rather than creating a new dataset.
3. **Given** FOC dataset metadata limits, **When** a collection is created, **Then** only reserved routing metadata is stored at the dataset level and overflow metadata is stored in immutable collection artifacts.
4. **Given** a collection publish operation, **When** dataset creation is required, **Then** it is created lazily on first publish rather than requiring manual pre-creation.

---

### User Story 2 — Publish provenance-aware collection revisions (Priority: P1)

An operator ingests new material and publishes a new collection revision that preserves what changed, what it was derived from, and what software or actor produced it.

**Why this priority**: The research behind issue #44 supports richer provenance and revision semantics as the next architecture win after basic storage.

**Independent Test**: Publish two revisions of the same collection with new source material, then inspect the stored revision manifests and diff output to confirm revision lineage, artifact provenance, and changed segments are all preserved.

**Acceptance Scenarios**:

1. **Given** an existing collection revision, **When** a new revision is published, **Then** the new head records the previous revision identifier and the newly added immutable artifacts.
2. **Given** a revision manifest, **When** it is read, **Then** it includes provenance fields distinguishing collection identity, derived artifacts, source artifacts, and publishing agent or software.
3. **Given** two revision identifiers, **When** `wtfoc` computes a diff, **Then** it returns added, removed, and unchanged segment/artifact references without downloading the entire collection body.
4. **Given** a stored revision, **When** an older revision is requested, **Then** it remains readable and verifiable even after newer revisions exist.

---

### User Story 3 — Mount a collection from a CID or revision handle (Priority: P2)

A low-compute user or agent receives a CID or revision handle and can mount the collection, reuse stored corpus embeddings, and query or trace without re-embedding the full corpus.

**Why this priority**: This is the strongest practical payoff from issue #44's research: portable, verifiable knowledge bases that other consumers can reuse.

**Independent Test**: Publish a collection revision, hand only the head/revision handle to a second environment, and confirm that it can hydrate enough state to run `query` or `trace` with only query-time embedding.

**Acceptance Scenarios**:

1. **Given** a revision handle or CID, **When** another consumer mounts it, **Then** they can discover the current revision manifest and referenced segments.
2. **Given** mounted segments containing stored corpus embeddings, **When** the consumer hydrates a vector index, **Then** they do not need to re-embed the corpus.
3. **Given** a consumer with only CPU or remote embedding access, **When** they run a query, **Then** only query embeddings are required.
4. **Given** a direct trace workflow over explicit edges, **When** no semantic fallback is needed, **Then** the consumer can inspect connected evidence without any embedder.

---

### User Story 4 — Discover what changed since a prior revision (Priority: P2)

A user or agent wants updates, not a full replay of the collection, and asks what changed since a prior revision.

**Why this priority**: Research on revision-aware knowledge objects suggests change feeds and diffs are a higher-value next step than heavier graph features.

**Independent Test**: Publish three revisions of a collection and verify that a consumer can ask for differences since revision 1 or 2 and receive a bounded change set suitable for notifications or agent workflows.

**Acceptance Scenarios**:

1. **Given** revision `r1` and revision `r3`, **When** a diff is requested, **Then** `wtfoc` returns the changed segments and summary counts of changed artifacts.
2. **Given** a revision diff, **When** a consumer requests detail, **Then** it can resolve the changed artifact references for inspection.
3. **Given** no changes between two revisions, **When** a diff is requested, **Then** the result is empty and machine-readable.

## Edge Cases

- What happens when two different collection names normalize to the same slug?
- How does the system handle dataset metadata length/key-count limits when collection labels or routing hints grow?
- What happens when a revision upload succeeds but head publication fails?
- How does CID/bootstrap behave when some referenced artifacts are temporarily unreachable from a gateway but still exist on FOC?
- What happens when a consumer mounts a revision with an unsupported `schemaVersion`?
- How does a diff behave when one of the referenced revisions is missing locally but available remotely?

## Requirements

### Functional Requirements

- **FR-001**: System MUST map each `wtfoc` collection to exactly one FOC dataset.
- **FR-002**: System MUST create the FOC dataset lazily on first publish of a collection.
- **FR-003**: System MUST treat dataset metadata as reserved routing metadata only; collection detail beyond metadata limits MUST be stored in immutable collection artifacts rather than dataset metadata.
- **FR-004**: System MUST reserve a stable minimal dataset metadata contract for FOC collections, including collection identifier, collection slug, source namespace, and IPFS indexing requirements.
- **FR-005**: System MUST store immutable collection revisions as artifacts that reference segment blobs, source artifacts, and prior revision identity.
- **FR-006**: System MUST preserve the current single-writer-per-project rule via revision/head conflict detection.
- **FR-007**: System MUST expose a revision manifest format that records collection identity, previous revision, referenced segments, and provenance fields for source/derived/publishing context.
- **FR-008**: System MUST include PROV-inspired provenance concepts sufficient to distinguish:
  - source artifact
  - derived artifact
  - activity that produced a derived artifact
  - actor or software agent associated with that activity
- **FR-009**: System MUST support computing revision diffs without downloading all chunk content.
- **FR-010**: System MUST allow a consumer to bootstrap a collection from a revision handle or CID and discover the segments needed for query/trace.
- **FR-011**: System MUST support low-compute reuse by allowing mounted collections to reuse stored corpus embeddings from segment blobs.
- **FR-012**: System MUST keep trace and query separate: trace MAY operate directly over explicit edges, while query MUST continue to use semantic retrieval.
- **FR-013**: System MUST preserve older revisions as readable, verifiable immutable artifacts after later revisions are published.
- **FR-014**: System MUST reject unknown revision or provenance schema versions with typed schema errors.
- **FR-015**: System MUST define artifact roles/types for at least:
  - source artifact
  - segment
  - revision manifest
  - collection descriptor

### Key Entities

- **CollectionDescriptor**: Stable collection identity and routing record. Includes collection ID, slug, storage backend identity, dataset identifier, creation metadata, and schema version.
- **CollectionRevision**: Immutable revision manifest for one published state of a collection. Includes previous revision ID, referenced segments, referenced source artifacts, summary metadata, and provenance.
- **ProvenanceRecord**: PROV-inspired data describing what artifact was derived from what source, by which activity, and by which software or actor.
- **RevisionDiff**: Machine-readable summary of changes between two collection revisions, including added/removed segment references and counts of changed artifacts.
- **ArtifactRole**: Declares whether a stored object is a source artifact, segment, revision manifest, or collection descriptor.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A published collection can be represented on FOC with one dataset and at least 100 immutable artifacts without exceeding dataset metadata limits.
- **SC-002**: A consumer can mount a collection from a revision handle and hydrate queryable state without re-embedding the corpus.
- **SC-003**: Revision diffs can be computed from manifests and summaries without downloading full chunk bodies.
- **SC-004**: Older collection revisions remain readable after at least 3 subsequent revisions are published.
- **SC-005**: Provenance records are sufficient to tell whether an artifact is raw source material, derived retrieval state, or published summary/assertion.
- **SC-006**: Query and trace continue to work with existing pluggable embedder and vector index seams.

## Dependencies

- `@wtfoc/common` — new collection/revision/provenance contracts and schemas
- `@wtfoc/store` — FOC dataset binding, artifact upload, revision manifests, diff support
- `@wtfoc/search` — mounted collection hydration and corpus-embedding reuse
- `@wtfoc/cli` — publish, inspect, diff, and bootstrap flows

## Out of Scope

- Multi-writer merge semantics beyond current conflict detection
- Full agent memory package or MCP server
- Automatic claim verification against textual evidence
- Rich graph algorithms beyond current explicit-edge trace plus semantic fallback
- Web UI or dashboard

## References

- [Issue #4](https://github.com/SgtPooki/wtfoc/issues/4) — FOC dataset metadata strategy
- [Issue #44](https://github.com/SgtPooki/wtfoc/issues/44) — research backlog for knowledge graphs, provenance, and retrieval
- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130)
- [TRACE the Evidence: Constructing Knowledge-Grounded Reasoning Chains for Retrieval-Augmented Generation](https://aclanthology.org/2024.findings-emnlp.496/)
- [Graph Retrieval-Augmented Generation: A Survey](https://arxiv.org/abs/2408.08921)
- [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/)
- [Reliable Granular References to Changing Linked Data](https://arxiv.org/abs/1708.09193)
- [What is a Nanopublication?](https://nanopub.net/introduction/)
