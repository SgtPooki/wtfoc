# [feat] Full collection verification flow (verify all CIDs in manifest)

**Increment**: 0043G-full-collection-verification-flow-verify-all-cids-
**Type**: feature | **Priority**: P2 | **Labels**: implementation, P2
**Source**: GitHub #43

## Description

## The Verification Story

Given a manifest CID, anyone should be able to:

1. Download the manifest from FOC
2. Verify each segment CID exists and content-hash matches
3. Report: "This collection has N segments, M chunks, all verified"

### CLI Flow

```bash
# Verify a single artifact
wtfoc verify <pieceCid>

# Verify an entire collection (all segments in manifest)
wtfoc verify-collection --manifest-cid <cid>

# Output:
# 📦 Collection: foc-ecosystem
# ✅ Manifest verified (CID: bafk...)
# ✅ Segment 1: 231 chunks, schema v1, model: mxbai-embed-large (CID: bafk...)
# ✅ Segment 2: 450 chunks, schema v1, model: mxbai-embed-large (CID: bafk...)
# 
# Summary: 2 segments, 681 chunks, all CIDs verified
# No tampering detected. Collection is intact.
```

### Why this matters for the demo

"Here's a CID. Anyone can independently verify this knowledge base hasn't been tampered with."

This is impossible with S3/Pinecone — they can silently modify data. With FOC, the CID IS the proof.

Depends on: FocStorageBackend (done), manifest chain

## User Stories

- **US-001**: As a user, I want full collection verification flow verify all cids  so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #43 on 2026-04-12.
