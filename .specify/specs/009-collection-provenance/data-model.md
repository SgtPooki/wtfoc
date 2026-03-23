# Data Model: Collection Revisions and Provenance

## 1. CollectionDescriptor

Stable identity record for one collection.

### Fields

- `schemaVersion`
- `collectionId`
- `name`
- `storageNamespace`
- `datasetId`
- `createdAt`
- `createdBy`
- `routingMetadata`

### Rules

- `collectionId` is deterministic and machine-oriented.
- `name` is human-facing and may differ from `collectionId`.
- `datasetId` is backend-specific and optional for non-FOC backends.

## 2. CollectionHead

Single mutable latest pointer for the collection.

### Fields

- `schemaVersion`
- `collectionId`
- `currentRevisionId`
- `prevHeadId`
- `segments`
- `batches`
- `totalChunks`
- `embeddingModel`
- `embeddingDimensions`
- `createdAt`
- `updatedAt`

### Rules

- `collectionId` and `currentRevisionId` are required fields. Schema v1 is redefined in place (no consumers to break).
- `prevHeadId` remains the conflict-detection field.
- Existing ingest summary data (`segments`, `batches`, `totalChunks`, `embeddingModel`, `embeddingDimensions`) remains on this object.

## 3. CollectionRevision

Immutable publication record for one collection state.

### Fields

- `schemaVersion`
- `revisionId`
- `collectionId`
- `prevRevisionId`
- `artifactSummaries`
- `segmentRefs`
- `bundleRefs`
- `provenance`
- `createdAt`
- `publishedBy`

### Rules

- `revisionId` is immutable.
- `artifactSummaries` are sufficient for diff and inspection workflows.
- `segmentRefs` are `SegmentSummary.id` values (per-segment IPFS CIDs, as defined in merged spec 010).
- `bundleRefs` are `BatchRecord.carRootCid` values when batch records exist (per merged spec 010).

## 4. ArtifactSummaryEntry

Compact artifact index entry stored inside a revision.

### Fields

- `artifactId`
- `artifactRole`
- `sourceScope`
- `contentIdentity`
- `storageId`
- `ipfsCid?`
- `pieceCid?`

### Rules

- `contentIdentity` is a backend-neutral content digest. For FOC-backed artifacts: the IPFS CID. For local-backend artifacts: a SHA-256 hex digest of the canonical serialized bytes.
- `artifactRole` distinguishes source, segment, revision, descriptor, or future roles.
- `sourceScope` is the minimal classification needed for routing and inspection.

## 5. DatasetRoutingMetadata

Minimal metadata stored on FOC datasets.

### Fields

- `collectionId`
- `artifactKind`
- `sourceNamespace`
- `indexingFlags`

### Rules

- Human collection names do not belong here.
- This metadata is routing-only and should remain within FOC metadata limits.

## 6. ProvenanceRecord

Medium PROV-inspired provenance model for collection publication.

### Fields

- `artifactId`
- `artifactKind`
- `derivedFrom`
- `primarySource`
- `activityId`
- `activityType`
- `actorId`
- `actorType`
- `revisionOf?`
- `derivationChain[]`

### Rules

- Enough to distinguish source vs derived artifacts.
- Enough to explain revision lineage and primary-source relationships.
- Not a full PROV-O implementation.

## State Transitions

1. Collection created
   - `CollectionDescriptor` created
   - `CollectionHead` initialized

2. Ingest runs
   - bundled segment artifacts produced

3. Publish revision
   - `CollectionRevision` created from current ingest outputs
   - `CollectionHead.currentRevisionId` advances

4. Diff or mount
   - consumers resolve `CollectionHead` for latest-state mounts or a pinned `CollectionRevision` for exact historical mounts
   - consumers inspect `ArtifactSummaryEntry[]`
   - consumers hydrate only the needed segment artifacts
