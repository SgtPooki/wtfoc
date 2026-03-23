# Embedding Model Audit Trail

How wtfoc tracks which embedding model produced which vectors, and why FOC makes this verifiable.

## The Problem

Embedding models change. Teams upgrade from MiniLM to nomic-embed-text, or from nomic to Qwen3-Embedding. When they do:

- Old vectors are incompatible with new vectors (different dimensions, different semantic spaces)
- Mixed embeddings in the same collection produce garbage search results
- There's no way to know which results came from which model
- There's no way to prove what model was used after the fact

## How wtfoc Tracks It

### Per-Segment Metadata (Immutable)

Every segment records the embedding model that produced its vectors:

```json
{
  "schemaVersion": 1,
  "embeddingModel": "nomic-embed-text-v1.5",
  "embeddingDimensions": 768,
  "chunks": [
    {
      "id": "abc123",
      "content": "...",
      "embedding": [0.1, 0.2, ...],
      "source": "FilOzone/synapse-sdk/src/storage/manager.ts",
      "sourceType": "code"
    }
  ]
}
```

Segments are **write-once, never modified**. Once created, the model metadata is permanent.

### Head Manifest (Mutable Pointer)

The manifest tracks the current collection state:

```json
{
  "schemaVersion": 1,
  "name": "foc-demo",
  "embeddingModel": "nomic-embed-text-v1.5",
  "embeddingDimensions": 768,
  "segments": [
    { "id": "seg-001", "chunkCount": 231 },
    { "id": "seg-002", "chunkCount": 450 }
  ],
  "prevHeadId": "abc..."
}
```

The manifest's `embeddingModel` reflects whatever was used in the most recent ingest. But each segment independently records its own model — the audit trail lives in the segments, not the manifest.

### Model Mismatch Protection

The CLI blocks ingestion when models don't match:

```
$ wtfoc ingest repo FIL-Builders/foc-cli -c demo --embedder lmstudio
⚠️  Model mismatch: collection uses "Xenova/all-MiniLM-L6-v2" but you're using "nomic-embed-text-v1.5".
   Mixed embeddings will produce poor search results. Use --embedder to match, or re-index the collection.
```

This prevents silent quality degradation.

## What FOC Adds

### Content-Addressed Immutability

When segments are stored on FOC, each gets a PieceCID — a cryptographic content address. This means:

1. **Provenance is verifiable.** A third party with a segment CID can fetch it from FOC and verify: "this segment was embedded with `nomic-embed-text-v1.5` at 768 dimensions on 2026-03-23."

2. **Tampering is detectable.** If anyone modifies the vectors or changes the model metadata, the CID changes. The original CID no longer resolves to the modified content.

3. **History is permanent.** When you re-index a collection with a new model, wtfoc creates NEW segments with NEW CIDs. The old segments remain on FOC forever — addressable, verifiable, retrievable.

### Re-Indexing Audit Trail

```
Day 1: Ingest with MiniLM
  → Segment A (CID: baga...001) — embeddingModel: "all-MiniLM-L6-v2"

Day 30: Re-index with nomic
  → Segment B (CID: baga...002) — embeddingModel: "nomic-embed-text-v1.5"
  → Segment A still exists on FOC (not deleted)

Day 60: Re-index with Qwen3
  → Segment C (CID: baga...003) — embeddingModel: "Qwen3-Embedding-4B"
  → Segments A and B still exist on FOC
```

At any point, anyone can:
- Fetch Segment A by CID and see it was MiniLM
- Fetch Segment B by CID and see it was nomic
- Verify the complete model evolution history
- Re-hydrate search from any historical segment

### CID Chain for Compliance

For teams that need to prove their RAG pipeline's provenance (legal, regulatory, audit):

1. **Which data was ingested?** → Chunk content in segments, addressable by CID
2. **Which model processed it?** → `embeddingModel` in each segment
3. **When was it processed?** → Manifest timestamps + CID creation time
4. **Has it been modified?** → CID verification — if the content matches the CID, it hasn't been tampered with
5. **What did search results look like at time T?** → Restore the manifest from that time, load its segments, reproduce the exact search

This level of auditability is impossible with S3/Pinecone — those systems can silently overwrite history.

## Current Implementation Status

| Feature | Status |
|---------|--------|
| Per-segment `embeddingModel` metadata | ✅ Implemented |
| Model mismatch detection on ingest | ✅ Implemented |
| Re-indexing with new model | Tracked in #40 |
| FOC storage backend | Tracked in #7 |
| CAR bundling for efficient uploads | Tracked in #41 |
| CID-based segment verification | After FOC backend |

## Related

- [FOC Storage Architecture](./foc-rag-storage.md) — what goes on FOC and why
- [SPEC.md](../SPEC.md) — format compatibility rules (rule 7)
- Issue #40 — re-index collection with new model
- Issue #41 — CAR bundling for uploads
