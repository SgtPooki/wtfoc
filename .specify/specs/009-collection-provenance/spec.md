# Feature Specification: Collection Revisions and Provenance

**Feature Branch**: `009-collection-provenance`  
**Created**: 2026-03-23  
**Status**: Ready for Implementation (cross-reviewed by Claude)  
**Input**: User description: "Define collection revisions, provenance, FOC dataset mapping, and CID bootstrap flows for wtfoc based on issue #4 and issue #44."

## Overview

This feature defines how a `wtfoc` collection should exist as a durable, portable, provenance-aware object on FOC.

Today, `wtfoc` has strong direction on immutable storage, explicit edges, and search versus trace, but two important questions are still open:

1. how a collection should map onto FOC datasets and dataset metadata
2. how collection revisions, provenance, and CID-based reuse should work as first-class concepts

This feature specifies a collection model that keeps the current architecture intact while making it more useful for portable knowledge bases, low-compute consumers, and future agent-driven workflows.

The existing mutable-latest-pointer pattern remains in place. The current `HeadManifest` concept is renamed and expanded into **Collection Head**, which remains the mutable latest pointer for a collection while also carrying the ingest-facing summary information currently held on the head object.

This feature does not redefine ingest-time bundling. Ingest continues to produce bundled segment artifacts according to the ingest upload model. Collection publication is a higher-level step that creates Collection Revision and Collection Head artifacts which reference those ingest-produced bundles and segment artifacts rather than being required to live inside the same ingest CAR.

Collection-level artifacts live in the same collection dataset as ordinary stored artifacts. Dataset metadata remains minimal and routing-only; richer collection semantics live in dataset contents, not dataset metadata.

For this feature, Collection Head remains the single mutable head for a collection. A separate publication-layer mutable head is deferred unless ingest and publication later diverge in cadence or ownership.

## Clarifications

### Session 2026-03-23

- Q: Should collection identity use one handle or separate stable and immutable handles? → A: Use both a stable collection handle for latest discovery and immutable revision handles for exact historical state.
- Q: How far should provenance alignment go in this spec? → A: Use a medium PROV-inspired model with source artifact, derived artifact, publishing activity, actor or software identity, revision-of, primary-source, and derivation-chain fields.
- Q: Should subscriptions and change feeds be included in this spec? → A: No. Keep them as an explicit follow-on feature, but ensure revisions and diffs preserve the information needed to build them later.
- Q: Should the stable collection handle itself be fully CID-published in this spec? → A: No. Define it as a first-class collection identifier now, and leave CID-backed publication semantics for the stable handle to a later refinement.
- Q: How should Collection Revision relate to the existing HeadManifest model? → A: Keep the mutable-latest-pointer pattern and migrate the existing HeadManifest into Collection Head rather than introducing a second mutable head type.
- Q: How should collection publication relate to ingest-time CAR bundles? → A: Keep ingest-time bundling separate. Collection Revision and Collection Head are collection-publication artifacts that reference ingest-produced bundles and segment artifacts instead of being required to live in the same ingest CAR.
- Q: What should the stable collection handle actually be? → A: Use a deterministic machine collection ID as the stable handle, separate from the human collection name.
- Q: What should be stored in FOC dataset metadata? → A: Keep dataset metadata minimal and routing-only. Store collection ID, artifact kind marker, source namespace, and required indexing flags there; store human collection name and richer metadata in collection artifacts.
- Q: Where should collection-level artifacts physically live relative to the FOC dataset? → A: Store Collection Descriptor, Collection Head, and Collection Revision as ordinary artifacts in the collection dataset, not as dataset metadata.
- Q: What summary data should Collection Revision carry so diffs are computable without downloading full artifact bodies? → A: Each Collection Revision should include a compact per-artifact summary index with artifact ID, artifact role, source scope, and content identity.
- Q: How should mount distinguish pinned revisions from latest collection state? → A: Mounting by revision handle pins that exact revision. Mounting by stable collection handle resolves the latest Collection Head and its current revision.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish a collection with stable FOC identity (Priority: P1)

An operator publishes a collection to FOC and expects a stable collection identity that maps cleanly to one durable storage namespace and multiple immutable revisions.

**Why this priority**: The project needs a clear answer to the collection-to-dataset question before its FOC story is coherent or repeatable.

**Independent Test**: Create a collection, publish it twice with new data the second time, and confirm that both revisions belong to one stable collection identity instead of being split across unrelated storage namespaces.

**Acceptance Scenarios**:

1. **Given** a new collection name, **When** the collection is first published to FOC, **Then** the system creates a deterministic machine collection ID as the stable collection handle and binds that handle to FOC-backed collection state.
2. **Given** an existing published collection, **When** a later revision is published, **Then** the system reuses the same stable collection handle and creates a new immutable revision handle rather than creating a new collection identity.
3. **Given** FOC dataset metadata limits, **When** a collection is published, **Then** only essential routing metadata is stored at the dataset level and all other collection detail is stored in collection artifacts.
4. **Given** a collection has not yet been published, **When** the first publish occurs, **Then** the required FOC dataset is created lazily.
5. **Given** ingest has already produced bundled segment artifacts, **When** collection publication occurs, **Then** the collection-level publication step references those artifacts instead of redefining the ingest bundle boundary.
6. **Given** collection-level artifacts are published, **When** they are stored on FOC, **Then** they are stored as ordinary artifacts in the collection dataset rather than encoded into dataset metadata.

---

### User Story 2 - Publish provenance-aware collection revisions (Priority: P1)

An operator ingests new source material and publishes a new revision while preserving where the revision came from, what changed, and how derived artifacts relate to source artifacts.

**Why this priority**: Research in issue #44 strongly supports provenance and revision-aware knowledge objects as the next level of architecture maturity.

**Independent Test**: Publish two revisions of the same collection and verify that the later revision records previous revision identity, changed artifacts, and provenance for derived artifacts.

**Acceptance Scenarios**:

1. **Given** an existing collection revision, **When** a new revision is published, **Then** the new revision records the previous revision identifier.
2. **Given** a stable collection handle, **When** a later revision is published, **Then** the stable collection handle resolves to the latest revision while older immutable revision handles continue to resolve to their original state.
3. **Given** a stored revision, **When** it is inspected, **Then** it distinguishes source artifacts from derived artifacts and records publishing provenance, revision relationships, and primary-source relationships.
4. **Given** a new revision is published, **When** publication completes, **Then** Collection Head advances to the new revision while older immutable revision handles remain unchanged.
5. **Given** an older revision and a newer revision, **When** a diff is requested, **Then** the system can report what changed without downloading the full content of every artifact.
6. **Given** newer revisions have been published, **When** an older revision is requested, **Then** it remains readable and verifiable.
7. **Given** a Collection Revision references artifacts produced by one or more ingest bundles, **When** it is inspected, **Then** the revision makes those referenced bundles and segment artifacts discoverable without requiring them to be republished inside a new ingest CAR.
8. **Given** two revisions are compared, **When** a diff is requested, **Then** the diff is computed from compact per-artifact summary entries in the revisions rather than from full artifact body downloads.
9. **Given** ingest-facing summary data already exists on the current head object, **When** the model evolves to Collection Head, **Then** that summary data remains available on Collection Head rather than being moved to a separate mutable object.

---

### User Story 3 - Mount a collection from a CID or revision handle (Priority: P2)

A second user or agent receives a CID or revision handle and wants to mount the collection, reuse what has already been stored, and run queries or traces without rebuilding the collection from scratch.

**Why this priority**: Portable, low-compute reuse is one of the strongest practical benefits of storing `wtfoc` collections as immutable knowledge objects.

**Independent Test**: Publish a collection, move to a fresh environment, mount the collection from its revision handle, and confirm that query and trace can operate using the stored collection state.

**Acceptance Scenarios**:

1. **Given** a revision handle or CID, **When** another consumer mounts it, **Then** they can discover the current collection revision and the referenced artifacts needed for retrieval.
1. **Given** an immutable revision handle, **When** another consumer mounts it, **Then** the mounted state is pinned to that exact revision rather than advancing to later revisions.
2. **Given** a stable collection handle, **When** another consumer mounts it, **Then** the handle resolves through Collection Head to the latest current revision.
3. **Given** stored corpus embeddings are present in mounted artifacts, **When** the consumer prepares to query, **Then** they can reuse those corpus embeddings instead of re-embedding the full collection.
4. **Given** the consumer only has lightweight embedding capability, **When** they run a semantic query, **Then** only query-time embedding is required.
5. **Given** a trace depends only on explicit stored edges, **When** semantic fallback is unnecessary, **Then** the consumer can inspect the trace path without using an embedder.

---

### User Story 4 - Discover what changed since a prior revision (Priority: P2)

A user or agent wants updates about a collection and asks what changed between revisions instead of reprocessing the entire collection.

**Why this priority**: Revision diffs and change feeds are a more immediate value multiplier than heavier graph features.

**Independent Test**: Publish multiple revisions of a collection and confirm that a consumer can request the difference between any two revisions and get a machine-readable change summary.

**Acceptance Scenarios**:

1. **Given** two revision identifiers, **When** a diff is requested, **Then** the system returns added and removed artifact references plus summary counts.
2. **Given** a revision diff, **When** a consumer asks for more detail, **Then** they can resolve the changed artifact references for inspection.
3. **Given** no changes between two revisions, **When** a diff is requested, **Then** the result is empty and machine-readable.

## Edge Cases

- Two collection names normalize to the same slug; the deterministic collection ID must still remain unique and stable
- Dataset metadata limits are reached by collection routing data
- A revision upload succeeds but publication of the new head or latest pointer fails — orphaned revision artifact on storage with no head reference. On retry, the system should detect the already-uploaded revision (by its content-addressed ID) and relink it rather than re-uploading.
- A mounted revision references artifacts that are temporarily unreachable from one retrieval path but still exist on storage
- A consumer mounts a revision with an unknown schema version
- A revision diff is requested when one revision is local and the other must be resolved remotely

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define both a stable collection handle for latest discovery and immutable revision handles for exact historical state.
- **FR-001a**: The stable collection handle MUST be a first-class collection identifier, while its CID-backed publication form MAY be refined by a later feature.
- **FR-001b**: The stable collection handle MUST be a deterministic machine collection ID distinct from the human collection name. The ID MUST be derived by hashing the fully qualified `{storageNamespace}/{collectionName}` tuple (not just the human slug), making collisions impossible for distinct namespaced names.
- **FR-002**: The system MUST map a published collection to one FOC dataset rather than creating a new dataset for each revision.
- **FR-003**: The system MUST create the FOC dataset lazily when a collection is first published.
- **FR-004**: The system MUST reserve dataset metadata for only the minimum routing data needed to recognize and locate the collection.
- **FR-004a**: The minimum routing data in dataset metadata MUST be limited to collection ID, artifact kind marker, source namespace, and required indexing flags.
- **FR-005**: The system MUST store additional collection detail outside dataset metadata when metadata limits would otherwise be exceeded.
- **FR-005a**: Human collection name and richer collection metadata MUST live in collection artifacts rather than dataset metadata.
- **FR-005b**: Collection Descriptor, Collection Head, and Collection Revision MUST be stored as ordinary artifacts in the collection dataset rather than as dataset metadata fields.
- **FR-006**: The system MUST define an immutable collection revision object that records previous revision identity and referenced artifacts.
- **FR-006a**: The system MUST ensure the stable collection handle can resolve the latest revision without changing the identity of prior immutable revision handles.
- **FR-006b**: The system MUST define Collection Head as the evolved successor to HeadManifest, preserving the mutable latest-pointer role while carrying the ingest-facing summary information already associated with the head object. New collection-publication fields (`collectionId`, `currentRevisionId`) are required on CollectionHead. The existing schema v1 is redefined in place — no version bump needed since there are no external consumers.
- **FR-006c**: Collection Head MUST reference the current Collection Revision and MAY continue to carry mutable summary data needed for routing, ingest history, and retrieval without creating a second mutable head type.
- **FR-006d**: Collection Revision and Collection Head MUST be defined as collection-publication artifacts, separate from ingest-time CAR bundles.
- **FR-006e**: Collection publication MUST be able to reference ingest-produced bundles and segment artifacts without requiring those artifacts to be republished inside the same ingest CAR. `segmentRefs` MUST contain `SegmentSummary.id` values (per-segment IPFS CIDs, as defined in spec 010). `bundleRefs` MUST contain `BatchRecord.carRootCid` values when batch records exist.
- **FR-006f**: A separate publication-layer mutable head is out of scope for this feature and MUST remain deferred unless ingest and publication later diverge in cadence or ownership.
- **FR-007**: The system MUST define provenance fields sufficient to distinguish raw source artifacts, derived retrieval artifacts, the activity that produced them, and the actor or software associated with that activity.
- **FR-007a**: The provenance model MUST include revision-of, primary-source, and derivation-chain relationships sufficient to trace how a derived artifact relates to earlier revisions and original source material.
- **FR-008**: The system MUST preserve the current single-writer conflict model when publishing new revisions.
- **FR-009**: The system MUST preserve older revisions as readable and verifiable after newer revisions are published.
- **FR-010**: The system MUST support computing a revision diff from revision metadata and summaries without requiring all full artifact bodies to be downloaded.
- **FR-010a**: Each Collection Revision MUST include a compact per-artifact summary index containing artifact ID, artifact role, source scope, and content identity sufficient for diff computation.
- **FR-010b**: `contentIdentity` in an artifact summary entry MUST be a backend-neutral content digest. For FOC-backed artifacts, `contentIdentity` MUST be the IPFS CID of the artifact content. For local-backend artifacts, it MUST be a SHA-256 hex digest of the canonical serialized artifact bytes.
- **FR-011**: The system MUST allow a consumer to bootstrap a collection from a CID or revision handle and discover the artifacts required to query or trace it.
- **FR-012**: The system MUST support reuse of stored corpus embeddings when a mounted collection already contains them.
- **FR-013**: The system MUST preserve the distinction between semantic query and explicit-edge trace in mounted collections.
- **FR-013a**: Mounting by stable collection handle MUST resolve the latest revision, while mounting by immutable revision handle MUST preserve pinned historical state.
- **FR-014**: The system MUST reject unknown revision or provenance schema versions with typed schema errors. Required error codes: `REVISION_SCHEMA_UNKNOWN` (unknown CollectionRevision schema version), `COLLECTION_HEAD_CONFLICT` (single-writer conflict during head advancement), `PUBLISH_FAILED` (revision uploaded but head advancement failed — orphaned revision).
- **FR-015**: The system MUST define artifact roles for at least source artifacts, segment artifacts, revision artifacts, and collection descriptor artifacts.
- **FR-016**: New CLI commands (`publish`, `collection show`, `collection diff`, `mount`) MUST follow SPEC.md §11 output conventions: stderr for logs, stdout for data, `--json` for machine-readable output, `--quiet` for errors only. Exit codes per SPEC.md §10: 0 success, 1 general, 3 storage, 4 conflict.

### Key Entities *(include if feature involves data)*

- **Collection Descriptor**: Stable identity record for a collection, including its human name, stable collection handle, storage-facing identity, and routing metadata.
- **Dataset Routing Metadata**: Minimal metadata stored on the FOC dataset for routing and recognition only. It excludes human-facing collection detail.
- **Collection Name**: Human-facing collection label used for display and operator intent. It is not the authoritative stable collection handle.
- **Collection Head**: Mutable latest pointer for a collection. It resolves the stable collection handle to the current immutable Collection Revision and retains the mutable summary information needed to route, inspect, and advance the collection state over time.
- **Collection Revision**: Immutable record of one published state of a collection, including previous revision identity and referenced artifacts.
- **Collection Artifact**: An ordinary stored artifact in the collection dataset that represents collection-level state, such as Collection Descriptor, Collection Head, or Collection Revision.
- **Artifact Summary Entry**: Compact metadata stored in a Collection Revision for diff and inspection workflows, including artifact ID, artifact role, source scope, and content identity.
- **Ingest Bundle Reference**: A reference from a collection-level artifact to an ingest-produced CAR bundle or the segment artifacts contained within it.
- **Provenance Record**: Metadata describing how an artifact was produced, what it was derived from, which actor or software was responsible, whether it is a revision of prior state, what its primary source material was, and how it fits into a derivation chain.
- **Revision Diff**: Machine-readable summary of what changed between two revisions.
- **Artifact Role**: Classification that identifies whether a stored object is source material, derived retrieval state, collection metadata, or revision metadata.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A collection can be published to FOC with one stable collection handle and at least three successive immutable revision handles without changing its collection mapping.
- **SC-001a**: Collection Head can advance across at least three successive revisions while older immutable revision handles continue to resolve to their original state.
- **SC-001b**: A Collection Revision can reference ingest-produced bundles and segment artifacts without forcing those artifacts to be republished inside a new ingest CAR.
- **SC-002**: A consumer can mount a collection from a revision handle and prepare it for query or trace without re-embedding the full corpus.
- **SC-003**: A revision diff can be produced from stored revision metadata without downloading all full artifact bodies.
- **SC-003a**: Artifact-level additions and removals can be detected from Collection Revision summary indexes alone.
- **SC-003b**: Mounted collection behavior distinguishes pinned revision mounts from latest-state mounts without ambiguity.
- **SC-004**: Older revisions remain readable and verifiable after at least three newer revisions are published.
- **SC-005**: Published artifacts can be classified as source, derived, revision, or collection descriptor, and their primary-source and revision relationships can be determined from stored metadata alone.
- **SC-006**: Query and trace remain separately testable user flows after mounted-collection support is added.

## Out of Scope

- Multi-writer merge semantics beyond current conflict detection
- Full agent-memory or MCP features
- User-facing subscriptions or change-feed delivery behavior
- Automatic fact verification against source text
- New graph algorithms beyond explicit-edge trace plus semantic fallback
- Web-based collection management

## Follow-on Opportunities

- Subscriptions and change feeds built on top of collection revisions and revision diffs
- User or agent workflows for polling latest revisions and processing only newly added or changed artifacts
- Spec 010 (CAR Bundle Uploads) is merged. `segmentRefs` use `SegmentSummary.id` (per-segment IPFS CIDs) and `bundleRefs` use `BatchRecord.carRootCid` as defined in the merged 010 schema. The `HeadManifest` → `CollectionHead` rename should be applied across the codebase when this feature lands.

## References

- Issue #4: Design FOC dataset metadata strategy for collections
- Issue #44: Research backlog for knowledge graphs, provenance, and retrieval in `wtfoc`
