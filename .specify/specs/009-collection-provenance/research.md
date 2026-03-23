# Research: Collection Revisions and Provenance

## Decision 1: Evolve `HeadManifest` into `CollectionHead`

**Decision**: Keep a single mutable head object and evolve the current `HeadManifest` into `CollectionHead`.

**Rationale**:
- The current project invariant is immutable data plus mutable index.
- Ingest and publication are still effectively one cadence and one owner.
- The parallel CAR-bundling work expects ingest history to remain on the head object.
- A second mutable head would be premature abstraction until ingest and publication truly diverge.

**Alternatives considered**:
- Separate publication head plus ingest head: cleaner separation, but adds more moving parts than current workflows require.
- No mutable head, revision only: breaks the existing latest-pointer pattern and makes “latest” awkward.

## Decision 2: Reuse existing seams

**Decision**: Do not introduce a new collection-publication seam. Evolve `ManifestStore` and use `StorageBackend` for revision artifacts.

**Rationale**:
- The constitution names six core seams and warns against over-abstraction.
- `ManifestStore` already owns the mutable head pointer.
- Revision artifacts are ordinary immutable stored objects and fit naturally under `StorageBackend`.

**Alternatives considered**:
- New `CollectionStore` or `PublicationStore` interface: could be cleaner later, but would add a seventh seam before the current model is exhausted.

## Decision 3: Stable collection handle is deterministic and backend-neutral

**Decision**: Use a deterministic machine collection ID as the stable collection handle; keep the human collection name separate.

**Rationale**:
- Human names can collide or change.
- Stable machine identity supports diffs, mounts, and routing without tying behavior to display labels.
- Backend-neutral identity keeps the model usable on local or non-FOC backends.

**Alternatives considered**:
- Human collection name as handle: too fragile.
- Random UUID: stable enough, but weaker for deterministic recreation and import/export flows.

## Decision 4: Dataset metadata stays tiny; collection semantics live in artifacts

**Decision**: Use FOC dataset metadata for routing only. Store collection-level semantics in ordinary artifacts inside the dataset.

**Rationale**:
- FOC dataset metadata limits are tight.
- Human collection name, provenance, revision pointers, and other rich semantics exceed metadata’s intended role.
- Ordinary artifacts remain schema-versioned, verifiable, and backend-neutral.

**Alternatives considered**:
- Store richer collection state in dataset metadata: brittle and limit-prone.
- Keep collection artifacts outside the dataset: weakens locality and makes the collection harder to reason about as a unit.

## Decision 5: Collection publication is above ingest-time CAR bundling

**Decision**: Ingest-time bundling and collection publication are separate layers.

**Rationale**:
- The bundle-upload work exists to control small-piece gas abuse at ingest time.
- Collection publication has different semantics and may span multiple ingest outputs.
- Keeping the layers separate avoids redefining “one ingest = one upload.”

**Alternatives considered**:
- Put revisions and heads into the ingest CAR: couples unrelated lifecycles.
- Redefine publish as the only bundle boundary: conflicts with current ingest design.

## Decision 6: Revision diffs require compact per-artifact summaries

**Decision**: Each `CollectionRevision` carries `ArtifactSummaryEntry[]` with enough metadata to compute diffs from revision artifacts alone.

**Rationale**:
- The spec requires diff without downloading full artifact bodies.
- Artifact-level diff support is more useful than revision-level only.
- Compact summary entries keep revision artifacts small enough for inspection and mount workflows.

**Alternatives considered**:
- Segment-level diff only: too coarse.
- Full artifact manifests duplicated on every revision: too redundant.

## Decision 7: Mounted collection reuse should not change search seams

**Decision**: Mounted collection support hydrates query/trace state from revision artifacts and existing segment blobs without changing `Embedder` or `VectorIndex`.

**Rationale**:
- `wtfoc` already has the right search seams.
- Corpus embeddings already live in segments.
- Mount flows should assemble known pieces, not invent a new retrieval model.

**Alternatives considered**:
- New mount-specific search interface: unnecessary extra seam.
- Re-embed mounted corpus on every consumer: defeats the portable low-compute story.
