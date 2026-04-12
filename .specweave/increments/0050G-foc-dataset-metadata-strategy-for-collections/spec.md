# Design FOC dataset metadata strategy for collections

**Increment**: 0050G-foc-dataset-metadata-strategy-for-collections
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #4

## Description

## Summary

When storing on FOC via synapse-sdk, every upload goes to a dataset. Datasets have unique metadata. We need to design how wtfoc collections map to FOC datasets.

## Context

- synapse-sdk: `source: 'wtfoc'` gives us namespace isolation
- Each dataset has metadata (key-value, limited to 10 keys, 32 char keys, 128 char values)
- `withIPFSIndexing` metadata is required for IPFS gateway retrieval (filecoin-pin handles this by default)
- Different wtfoc collections (e.g. "team-intel", "docs") might need separate datasets or shared datasets with collection-level metadata

## Questions to Resolve

1. One FOC dataset per wtfoc collection? Or one dataset for all collections?
2. How to store collection name in dataset metadata?
3. How to handle dataset metadata limits (10 keys max)?
4. Should the FocStorageBackend create datasets lazily or require pre-creation?
5. How does this interact with the ManifestStore (manifest stored as a piece in the dataset, or separately)?

## References

- synapse-sdk metadata: `packages/synapse-core/src/utils/metadata.ts` — 5 keys/piece, 10 keys/dataset
- filecoin-pin: sets `withIPFSIndexing` by default
- SPEC.md rule 8: SDK policy

## User Stories

- **US-001**: As a user, I want foc dataset metadata strategy for collections so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #4 on 2026-04-12.
