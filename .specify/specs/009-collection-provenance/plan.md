# Implementation Plan: Collection Revisions and Provenance

**Branch**: `009-collection-provenance` | **Date**: 2026-03-23 | **Spec**: [/Users/sgtpooki/code/sgtpooki/homelab-system/wtfoc-worktrees/codex-009-collection-provenance/.specify/specs/009-collection-provenance/spec.md](/Users/sgtpooki/code/sgtpooki/homelab-system/wtfoc-worktrees/codex-009-collection-provenance/.specify/specs/009-collection-provenance/spec.md)
**Input**: Feature specification from `/specs/009-collection-provenance/spec.md`

## Summary

Add collection-level publication semantics on top of the existing immutable segment model. The implementation will evolve the current head manifest schema into `CollectionHead` as the renamed successor to `HeadManifest`, introduce immutable `CollectionRevision` and related provenance records as ordinary stored artifacts, and support metadata-only revision diffs plus CID/bootstrap flows that reuse stored corpus embeddings without re-embedding the full corpus.

The implementation keeps ingest-time CAR bundling separate from collection publication. Ingest continues to produce bundled segment artifacts; collection publication references those artifacts and advances a single mutable `CollectionHead`.

## Technical Context

**Language/Version**: TypeScript strict mode, Node >=24  
**Primary Dependencies**: existing workspace packages (`@wtfoc/common`, `@wtfoc/store`, `@wtfoc/search`, `@wtfoc/cli`), `@filoz/synapse-sdk`, `filecoin-pin`  
**Storage**: Local filesystem and FOC-backed blob storage with mutable local manifest store evolving toward collection-aware heads  
**Testing**: Vitest (`pnpm test`) plus schema/serialization unit tests  
**Target Platform**: Node.js libraries and CLI on macOS/Linux  
**Project Type**: pnpm monorepo with library packages plus CLI  
**Performance Goals**: Revision diffs computed from revision metadata without downloading full artifact bodies; mounted collections reuse stored corpus embeddings rather than re-embedding the corpus  
**Constraints**: Single writer per collection, backend-neutral identity, immutable data with mutable index, no new storage seam unless strictly necessary, ingest-time bundling remains separate from collection publication  
**Scale/Scope**: Hackathon-scale collections with hundreds to thousands of artifacts across multiple revisions; metadata-only operations must remain tractable without full corpus hydration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Standalone packages**: Pass. Work is concentrated in `common`, `store`, and `cli`; no package loses standalone value.
- **Credible exit at every seam**: Pass with constraint. Reuse existing `StorageBackend` and `ManifestStore` seams rather than introducing a seventh seam for collection publication. `ManifestStore` remains the owning seam for the single mutable collection head.
- **Backend-neutral identity**: Pass with design requirement. `CollectionRevision` and related artifacts must use backend-neutral stored IDs, with CIDs as optional verification metadata.
- **Immutable data, mutable index**: Pass. `CollectionRevision` remains immutable; `CollectionHead` remains the single mutable latest pointer.
- **Edges are first-class**: Pass. Mounted collections continue to feed existing `trace` behavior from stored edges.
- **Bundle uploads**: Pass. Ingest bundling remains unchanged; collection publication references ingest outputs instead of creating per-artifact small-piece uploads.
- **Not a vector database / not an agent framework**: Pass. This feature improves publication, provenance, and bootstrap semantics only.

## Project Structure

### Documentation (this feature)

```text
specs/009-collection-provenance/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── collection-publication.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/common/
├── src/
│   ├── index.ts
│   ├── interfaces/
│   │   └── manifest-store.ts
│   └── schemas/
│       └── manifest.ts

packages/store/
├── src/
│   ├── factory.ts
│   ├── index.ts
│   ├── manifest/
│   │   └── local.ts
│   └── segment.ts

packages/search/
├── src/
│   ├── query.ts
│   └── trace.ts

packages/cli/
├── src/
│   ├── cli.ts
│   └── output.ts
```

**Structure Decision**: Extend the existing manifest/common schema path rather than creating a new package. `@wtfoc/common` carries the new contracts and schemas; `@wtfoc/store` implements collection-aware head/revision persistence; `@wtfoc/search` and `@wtfoc/cli` consume mounted collections without redefining their core seams.

## Phase 0: Research Plan

Produce `research.md` with resolved decisions for:

1. **Schema evolution strategy**
   - How `HeadManifest` becomes `CollectionHead`
   - How to keep `ManifestStore` as the mutable head seam without adding a new seam

2. **Backend-neutral collection identity**
   - Deterministic machine collection ID
   - Mapping to FOC dataset metadata vs non-FOC logical namespaces

3. **Collection artifact placement and metadata enforcement**
   - Ordinary artifacts in the collection dataset
   - Minimal dataset routing metadata only

4. **Revision diff feasibility and equality semantics**
   - Required `ArtifactSummaryEntry` fields
   - How to detect add/remove/update without full artifact downloads
   - What `contentIdentity` means across backends

5. **Mounted collection reuse**
   - How `query` and `trace` discover revisions and segment artifacts
   - How stored corpus embeddings are reused without changing the `Embedder`/`VectorIndex` seams
   - How pinned revision mounts differ from latest-state mounts
   - Failure semantics when revision artifact publish succeeds but head advancement fails

## Phase 1: Design & Contracts

Produce:

- `data-model.md`
  - `CollectionDescriptor`
  - `CollectionHead`
  - `CollectionRevision`
  - `ArtifactSummaryEntry`
  - `DatasetRoutingMetadata`
  - provenance relationships and state transitions

- `contracts/collection-publication.md`
  - Manifest store evolution
  - Collection publication artifact contract
  - Diff and mount contract surface

- `quickstart.md`
  - Example end-to-end publish, inspect, diff, and mount flow

Design requirements for Phase 1:

- Keep `ManifestStore` as the mutable head interface unless a constitution-level exception is justified.
- Explicitly define how old `HeadManifest` fields map into `CollectionHead` and preserve head-level ingest summaries.
- Define backend-neutral identity and optional CID fields clearly.
- Define routing metadata validation and publish-failure semantics before implementation starts.
- Keep subscriptions/change feeds and evidence-verification workflows out of scope.

## Post-Design Constitution Check

Re-check after Phase 1:

- No new seam introduced unless justified in `Complexity Tracking`
- `CollectionHead` remains the single mutable head
- Collection publication does not create per-artifact small uploads
- Search and trace remain separate flows after mounted collection support

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None currently anticipated | N/A | Existing seams and packages are sufficient if `ManifestStore` evolves cleanly |
