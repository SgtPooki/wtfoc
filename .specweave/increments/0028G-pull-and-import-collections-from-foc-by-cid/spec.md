# [feat] Pull and import collections from FOC by CID

**Increment**: 0028G-pull-and-import-collections-from-foc-by-cid
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #92

## Description

## Summary

Add the ability to pull a published collection from FOC (Filecoin Onchain Cloud) by its manifest CID and import it into a local or hosted wtfoc store.

## Motivation

Collections published to FOC via `wtfoc promote` are immutable and verifiable. Users should be able to:

- Fetch a collection someone else published, given its CID
- Import it into their own local store for querying/tracing
- Use it as a starting point for re-embedding with a different model (#40)

This is the "read" side of FOC — the collection data is already decentralized, we just need a way to pull it back.

## Proposed CLI Surface

```
wtfoc pull <manifest-cid> [-c <local-name>]
```

- Resolves the manifest CID via the FOC storage backend
- Downloads all referenced segments
- Stores locally under the given name (or the collection's original name)
- Validates CIDs match on download (integrity check)

## Implementation Notes

- The `@wtfoc/store` FOC backend already supports `download(cid)` — this is mostly orchestration
- The manifest format (`CollectionHead`) includes segment CIDs, so the full collection is recoverable from the manifest CID alone
- Should work with both local and FOC storage backends as the destination
- Consider a `--verify-only` flag that checks CIDs without importing

## Related

- #40 — Re-index with new embedding model (pull → re-embed workflow)
- #43 — Full collection verification flow
- #67 — UI platform (hosted deployment needs this to load collections from FOC)

## User Stories

- **US-001**: As a user, I want pull and import collections from foc by cid so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #92 on 2026-04-12.
