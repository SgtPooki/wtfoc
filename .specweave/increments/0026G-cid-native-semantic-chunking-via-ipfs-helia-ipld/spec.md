# [feat] CID-native semantic chunking via IPFS/Helia/IPLD

**Increment**: 0026G-cid-native-semantic-chunking-via-ipfs-helia-ipld
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #97

## Description

## Problem

Chunk IDs are currently bare SHA-256 hashes (`createHash('sha256').update(content).digest('hex')`). This works for dedup but misses an opportunity: if chunks were content-addressed as CIDs via IPFS/Helia/IPLD tooling, every chunk would be natively addressable on IPFS without extra work.

Meanwhile, existing IPFS chunking (UnixFS rabin, fixed-size) is byte-level and has no awareness of text semantics — it would split mid-sentence or mid-paragraph.

## Proposed investigation

Build a **semantic-aware chunker that produces CIDs** by combining:

1. **wtfoc's semantic splitting** — markdown headers, paragraph boundaries, sentence endings (already implemented in `findMarkdownSplitEnd()`)
2. **IPFS/Helia/IPLD/multiformats tooling** — wrap each semantically-split chunk as an IPLD block to get a CID, rather than a bare SHA-256 hex string

### Potential approaches

- **Custom UnixFS chunker**: Implement a custom chunking strategy for `@helia/unixfs` that respects text boundaries instead of byte boundaries
- **IPLD blocks directly**: Use `@ipld/dag-cbor` or `@ipld/dag-json` + `multiformats` to encode each chunk as an IPLD block, getting a CID without going through UnixFS
- **CID-only ID replacement**: Keep our semantic splitter as-is but replace `SHA-256 hex → CID` using `multiformats/hashes` so chunk IDs are valid CIDs

### Why this matters

- **#94 (CID-based collection resolution)**: If chunks are already CID-addressed, the hosted deployment story becomes simpler — chunks are IPFS-native from birth
- **Dedup across collections**: CID matching enables cross-collection dedup
- **Verification**: Anyone with a chunk CID can independently verify the content
- **Ecosystem alignment**: FOC/Filecoin ecosystem expects CIDs, not hex hashes

### Libraries to evaluate

- `multiformats` — CID construction, hashing
- `@ipld/dag-cbor` / `@ipld/dag-json` — IPLD block encoding
- `@helia/unixfs` — custom chunker interface
- `ipfs-unixfs-importer` — lower-level chunker plugin API

## Constraints

- Must preserve semantic split quality (no mid-sentence breaks)
- Must not add heavy dependencies to `@wtfoc/common` (keep contracts package I/O-free)
- CID computation should work without a running IPFS node
- Backwards compatibility: existing collections with SHA-256 IDs should still work

## Related

- #94 — CID-based collection resolution (this enables it)
- #92 — Pull/import from FOC by CID
- #96 — Model-aware chunk sizing (just landed semantic rechunking)
- Spec 009 — Collection provenance (CID-based artifact identity)

## User Stories

- **US-001**: As a user, I want cid native semantic chunking via ipfs helia ipld so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #97 on 2026-04-12.
