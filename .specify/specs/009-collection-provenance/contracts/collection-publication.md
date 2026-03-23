# Contract: Collection Publication

This contract describes the public shapes and responsibilities introduced by spec 009.

## Mutable Head Contract

The mutable collection head remains the only mutable index object for a collection.

### Responsibilities

- resolve stable collection handle to latest revision
- preserve ingest-facing summary information
- enforce single-writer conflict detection
- provide enough summary data for collection status and routing

### Required Operations

- read current collection head
- write next collection head with `prevHeadId` conflict detection
- list known collections

## Immutable Revision Contract

Each collection revision is an immutable stored artifact.

### Responsibilities

- record prior revision identity
- reference ingest-produced bundles and segment artifacts
- carry artifact summaries for diff and inspection
- carry publication provenance

### Required Operations

- store revision artifact
- load revision artifact by backend-neutral ID
- inspect artifact summaries without loading full artifact bodies

## Diff Contract

Revision diff must operate from revision artifacts and their summary entries.

### Inputs

- left revision handle
- right revision handle

### Outputs

- added artifact summaries
- removed artifact summaries
- unchanged artifact summaries
- summary counts

## Mount Contract

Mounted collection flows must not require full corpus re-embedding.

### Inputs

- stable collection handle or immutable revision handle

### Outputs

- resolved revision artifact
- discovered segment references
- reusable stored corpus embeddings
- enough metadata to run query or trace

## Backend Neutrality

- Stable collection handles are backend-neutral.
- Revision artifact IDs are backend-neutral stored IDs.
- CIDs remain optional verification and bootstrap metadata where supported.
