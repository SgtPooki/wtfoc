# Scale Triggers: Vector Index and Embedder

> Architecture guidance for issue #110 — when to keep built-in defaults and when to externalize.

## Philosophy

wtfoc uses built-in defaults (in-memory brute-force vector index, local MiniLM
embedder) that are easy to operate and match the project's self-hosted ethos.
This document defines **when** those defaults stop being sufficient and **what**
the first substitution at each seam should be.

## Current Defaults

| Component | Implementation | Characteristics |
|---|---|---|
| Vector index | `InMemoryVectorIndex` | O(n*d) brute-force cosine scan; all vectors in process memory |
| Embedder (local) | `TransformersEmbedder` (MiniLM 384d) | ~10-50ms/query on CPU; low quality but zero-config |
| Embedder (API) | `OpenAIEmbedder` | Any OpenAI-compatible endpoint; quality depends on model |

## Vector Index Scale Triggers

### When to keep `InMemoryVectorIndex`

- Total chunks across all loaded collections < **100,000**.
- Process RSS stays under **2 GB** with all collections loaded.
- p99 search latency < **100ms** for `topK=10`.
- Single-user or low-concurrency usage (< 10 concurrent queries).

### Signs it's time to change

| Signal | Threshold | Why it matters |
|---|---|---|
| Chunk count | > 100k total | Brute-force scan becomes noticeable (> 50ms p99) |
| Memory usage | > 2 GB for vector data alone | Node.js GC pressure; swap risk on small machines |
| Search latency | p99 > 100ms | User-visible degradation in query/trace responses |
| Collection count | > 50 loaded simultaneously | Cache memory grows linearly with collections |
| Concurrent queries | > 10 in-flight | Brute-force scan blocks event loop per query |

### How to measure

```bash
# Chunk count per collection
wtfoc status <collection>   # shows totalChunks

# Process memory
# Add to server startup or expose via /api/debug
process.memoryUsage().heapUsed

# Search latency
# Time the vectorIndex.search() call in query/trace
console.time('search'); await vectorIndex.search(vec, topK); console.timeEnd('search');
```

### First substitution: HNSW index

The `VectorIndex` interface is the seam. Replace `InMemoryVectorIndex` with an
HNSW-based implementation (e.g., `hnswlib-node` or `usearch`).

**Expected improvement:** O(log n) approximate search vs O(n) brute-force.
10-100x faster at 100k+ vectors with minimal recall loss. Note: HNSW keeps
all vectors in memory and adds graph overhead — the win is **latency**, not
necessarily RAM. Multiple server replicas each hold a full copy.

**Migration path:**
1. Implement `HnswVectorIndex` conforming to the existing `VectorIndex` interface.
2. Replace `new InMemoryVectorIndex()` with `new HnswVectorIndex()` in `mountCollection` callers.
3. No changes to `mountCollection`, `query`, or `trace` — they accept `VectorIndex`.

**What NOT to do:** Don't reach for a standalone vector database (Qdrant, Weaviate,
Milvus) until the in-process HNSW index is also insufficient. The project
philosophy favors self-contained operation.

### Second substitution: external vector database

Only when:
- Index size exceeds single-process memory (> 8 GB vector data).
- Multiple server instances need to share the same index.
- You need persistence across restarts without re-hydrating from segments.

Options: Qdrant (Rust, self-hosted), LanceDB (embedded, Rust-backed).
Both support the operations in `VectorIndex` (add, search by cosine).

## Embedder Scale Triggers

### When to keep the built-in embedder

- Query volume < **100 queries/minute**.
- Embedding is not on the critical path for batch ingest (already async).
- Local MiniLM quality is acceptable for the use case.
- API embedder latency < **200ms p99**.

### Signs it's time to change

| Signal | Threshold | Why it matters |
|---|---|---|
| Query latency dominated by embedding | > 200ms for embed() | Embedding is the bottleneck, not search |
| Event loop blocking (local embedder) | > 100ms synchronous work | TransformersEmbedder runs on main thread |
| Ingest throughput | > 10k chunks/batch | Embedding becomes the pipeline bottleneck |
| Concurrent users | > 5 simultaneous queries | Local embedder serializes; API has rate limits |

### How to measure

```bash
# Embedding latency
console.time('embed'); await embedder.embed(text); console.timeEnd('embed');

# For the local embedder, check if it blocks the event loop:
# If server responsiveness degrades during queries, the embedder is blocking.
```

### First substitution: dedicated API embedder

Move from local MiniLM to an API-based embedder on a dedicated host:

- **Self-hosted:** Run `llama.cpp` or `vLLM` with an embedding model on a
  GPU machine; point `WTFOC_EMBEDDER_URL` at it.
- **Managed:** Use OpenAI `text-embedding-3-small` or similar via the existing
  `OpenAIEmbedder`.

**Migration path:** Already supported — set `WTFOC_EMBEDDER_URL` and
`WTFOC_EMBEDDER_MODEL` environment variables. No code changes needed.

**Important:** Switching embedding models requires re-ingesting all collections.
Vectors from different models are not comparable. The manifest's
`embeddingModel` field tracks this, and the web server warns on mismatch.

### Second substitution: embedder sidecar/worker

Only when:
- The embedder must not share CPU/memory with the query server.
- You need to scale embedding independently of serving.

Run the embedder as a separate process (sidecar container, systemd unit) and
connect via the OpenAI-compatible API. This is already the API embedder path —
no new abstraction needed.

## Decision Framework

```
Is p99 query latency > 100ms?
├── Yes → Is embedding the bottleneck?
│   ├── Yes → Switch to API embedder (env var change)
│   └── No  → Switch to HNSW index (code change, VectorIndex seam)
└── No  → Is memory usage > 2 GB?
    ├── Yes → Is it vector data or segment data?
    │   ├── Vectors → Switch to HNSW index (faster search at scale)
    │   └── Segments → Consider lazy segment loading or LRU eviction
    └── No  → Keep current defaults
```

## What Metrics to Track

If you're approaching the thresholds above, add these to server logging or a
`/api/debug` endpoint:

1. **Collection stats:** chunk count, segment count, loaded collection count.
2. **Memory:** `process.memoryUsage()` — heapUsed, rss, external.
3. **Latency breakdown:** embed time, search time, total query/trace time.
4. **Cache stats:** cache hits, cache misses, cache reloads (freshness).

These are the inputs that should drive scale decisions — not intuition.
