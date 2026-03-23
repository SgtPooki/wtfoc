# FOC Storage for RAG and Knowledge Bases

This note clarifies how `wtfoc` should present FOC in the architecture for a RAG service or a knowledge base.

## Recommended Positioning

FOC should be the immutable system of record for the knowledge base:

- Store canonical source snapshots on FOC.
- Store segment snapshots on FOC.
- Treat the online embedder and vector index as replaceable compute layers.

That framing fits the core project invariants:

- FOC is the best default, not the only backend.
- Storage is backend-neutral.
- Search and trace are separate concerns.
- Manifests are the mutable index over immutable data.

In other words: FOC is where the evidence lives. Query-time compute is where retrieval happens.

## What Should Live on FOC

### 1. Canonical chunk or source artifacts

Do store the latest normalized source material on FOC as immutable artifacts.

Why:

- Provenance: results can cite the exact source snapshot that was ingested.
- Reproducibility: a different embedder or vector DB can rebuild from the same inputs.
- Portability: a third party with only a CID can fetch the same evidence.
- Auditability: trace results remain grounded in stored content, not only derived vectors.

In the current schemas this is implied by per-chunk `storageId` values inside a `Segment`. A segment is not the only copy of the data; it is the indexable snapshot that points at stored artifacts.

### 2. Segment blobs

Do store segment blobs on FOC.

A segment is the portable retrieval snapshot for a collection revision. In the current shared schema it includes:

- embedding model and dimensions
- per-chunk storage references
- per-chunk embeddings and retrieval metadata
- extracted edges

This is the right place for precomputed vectors because it lets another consumer hydrate a vector index without re-embedding the corpus.

### 3. Head manifests

Do store a mutable head manifest somewhere, because "latest" must come from a pointer, not by overwriting immutable data.

The intended model is:

1. ingest new source snapshots
2. create a new segment
3. upload and verify immutable artifacts
4. publish a new head manifest revision

That gives a clean "latest sources" story: latest means "the head manifest currently points here," while older revisions remain addressable and verifiable.

Important current gap in this repo:

- `LocalManifestStore` is implemented today.
- FOC-backed `ManifestStore` is explicitly deferred in the specs.

So the architecture already supports a "latest" pointer, but today that pointer is local, not FOC-backed.

## Why "Embeddings Only on FOC" Is Too Weak

Storing only embeddings on FOC is not the best story for `wtfoc`.

Problems with embeddings-only storage:

- You lose the raw evidence needed for citations and trace output.
- You cannot easily re-embed when the model changes.
- You cannot inspect or verify the original normalized knowledge artifacts from the CID alone.
- A consumer with only vectors still needs some separate content store to render answers.
- The knowledge graph becomes less useful because edge traversal needs the artifact context behind each node.

A better split is:

- FOC stores the evidence and the portable segment snapshot.
- A local or external vector index serves online retrieval.
- Query embeddings can be local, remote, or skipped for direct trace workflows.

## Best Demo Story for FOC

If the goal is to show why FOC matters for a RAG service, the strongest message is:

1. FOC stores the canonical evidence and the portable retrieval snapshot.
2. `wtfoc` can rehydrate search and trace from that stored state.
3. CIDs let another user independently verify and reuse the same knowledge base revision.

That is stronger than saying "FOC stores vectors" because it shows verifiability, portability, and reproducible recall.

## Story for Existing IPFS CIDs

If a team already has IPFS CIDs, `wtfoc` should treat those CIDs as bootstrap handles into the knowledge base.

There are three useful cases.

### CID points to a chunk/source artifact

`wtfoc` can fetch the artifact content directly for evidence display, re-ingest, re-embedding, or graph expansion.

This does not require a GPU.

### CID points to a segment blob

This is the best reuse path for low-compute consumers.

A segment already contains the corpus-side vectors plus routing metadata and edges, so a consumer can:

- download the segment by CID
- validate `schemaVersion`
- load the stored vectors into a local or hosted vector index
- use stored `storageId` values to fetch evidence only for matched chunks

That means they do not need to re-embed the corpus.

### CID points to a head manifest

This is the best full-collection handoff.

A consumer can:

- fetch the head manifest
- discover the current segment set
- hydrate a query index from those segments
- traverse edges for trace
- fetch underlying artifacts on demand

This is the cleanest way to share "the latest collection state" by content address.

## What a Low-Compute User Still Needs

Even if the corpus embeddings are already stored, semantic query still requires a query embedding.

That requirement is much smaller than embedding the full corpus, and `wtfoc` already has the right seam for it:

- local CPU embedding via `TransformersEmbedder`
- remote embedding via `OpenAIEmbedder`
- future adapters for Ollama, vLLM, or other services

So the low-compute story is:

- no GPU is required to reuse stored corpus embeddings
- a small local CPU model is enough for many queries
- if local embedding is still undesirable, use a remote embedder
- for direct edge traversal or artifact lookup by ID/CID, no embedder is needed

## Practical Recommendation

For `wtfoc`, the recommended architecture is:

- Store raw normalized source snapshots on FOC.
- Store segment snapshots with vectors and edges on FOC.
- Keep a mutable head manifest to define the latest collection revision.
- Let users choose any embedder and any vector index for query-time compute.
- Treat CIDs as reusable entrypoints for verification, hydration, and downstream querying.

## Current Repo Status

The intended story above is only partially implemented in this checkout.

Implemented:

- local blob storage backend
- local manifest store
- local transformers-based embedder
- OpenAI-based embedder
- in-memory vector index implementation

Specified but not fully implemented yet:

- FOC storage backend
- FOC-backed manifest store
- end-to-end query/trace flow that mounts a collection from a CID or manifest handle

That means the architecture already supports the right story, but the docs need to be explicit that FOC is the canonical storage layer and CID distribution mechanism, not the online compute engine.
