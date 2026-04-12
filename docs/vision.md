# wtfoc Vision

> What the FOC happened? Trace it.

This document defines where wtfoc is going — the north-star goals that guide every feature, priority, and architectural decision. For design principles, see [principles.md](./principles.md). For why wtfoc exists, see [why.md](./why.md). For the current pipeline, see [pipeline-architecture.md](./pipeline-architecture.md).

## What "Done" Looks Like

A team deploys wtfoc on their infrastructure. It ingests their GitHub repos, Slack channels, documentation sites, issue trackers, and customer feedback. As sources change — new commits, updated issues, Slack conversations — the collection stays current automatically, re-processing only what changed.

An engineer asks: "What was the full context behind the billing migration?" wtfoc traces from the original customer complaint in Slack, through the GitHub issue discussion, to the PRs that implemented it, the code that changed, the docs that were updated, and the tests that verify it — with evidence links at every hop.

An AI agent asks the same question and gets the same answer — grounded, citable, and verifiable. The agent can follow the evidence chain to justify its response.

Another team pulls the collection via IPFS, adds their own sources, improves the edges, and publishes a new version. The CID chain shows exactly what changed and who contributed. Private data stays encrypted — only keyholders can read the content, but the collection structure and CIDs remain verifiable.

## North-Star Goals

### 1. Living Collections

Collections are never "done." They grow, improve, and stay current as sources change.

- Ingest new sources incrementally — cursors skip already-seen content
- Update embeddings when better models become available — re-embed only what's needed
- Add and refine edges as extractors improve — pattern edges at ingest, LLM edges post-hoc, new edge types over time
- Re-chunk when chunking strategies improve — without re-fetching from original sources
- Multiple embedding models can coexist — swap models without losing the old index during transition

### 2. Cross-Cutting Answers

Agents and humans can answer "why did this happen?" and "what else is affected?" across every source type.

- Trace follows explicit evidence-backed edges across repos, conversations, issues, docs, and customer feedback
- Search finds semantically similar content when edges don't exist yet
- The system surfaces connections that no single tool can see — because no single tool has all the sources and all the relationships
- Planning a new feature shows cross-cutting work: which repos, docs, tests, and conversations are involved
- Incident investigation reconstructs the full timeline: customer report → internal discussion → code change → resolution

### 3. Minimal Re-Processing

Every pipeline stage only touches what actually changed. Time and compute are not wasted on unchanged content.

- Source fetching: cursors and change detection (git diff, API timestamps) skip unchanged items
- Chunking: only re-chunk documents whose content or chunker version changed
- Embedding: content fingerprints skip re-embedding unchanged chunks
- Edge extraction: context hashes skip re-extracting unchanged documents
- Serving: persistent vector index avoids reloading all segments on every query

### 4. Rich, Trustworthy Edges

Explicit, typed, evidence-backed edges are the foundational differentiator. This is what makes trace possible and what separates wtfoc from every embeddings-only RAG tool.

- Every edge carries structured evidence: source artifact, document version, chunk span, extractor identity, timestamp, and confidence
- Multiple extractors run in parallel — pattern, code, heuristic, temporal, LLM — and their findings merge with confidence weighting
- Edge types cover the full spectrum of engineering relationships: references, imports, closes, implements, authored-by, tested-by, documented-by, supersedes, caused-by, and more
- Provenance is traceable: raw source → document → chunks → embeddings/edges → answer path
- Trust is the whole game — if the graph is noisy or stale, people default back to Slack search. Edge quality matters more than edge quantity.

### 5. Portable, Community-Improvable Knowledge

Collections are shareable artifacts that get better with each contributor. Knowledge outlives any single tool, team, or infrastructure.

- Collections are content-addressed (CID) and stored on IPFS/Filecoin — permanent, verifiable, decentralized
- Any agent or human can fetch a collection, improve it (add sources, extract better edges, re-chunk with better strategies), and publish a new version
- The CID chain provides an audit trail: each version points to its predecessor, showing exactly what changed and who contributed
- Low-compute consumers can mount a collection and query/trace without re-embedding — pre-computed embeddings travel with the collection
- Collections are self-contained knowledge artifacts — they include chunks, embeddings, edges, evidence, and metadata. Everything needed to answer questions.

### 6. Private Data Support

Teams must be able to use wtfoc with sensitive, proprietary, or regulated data without compromising security.

- Collections can be encrypted before storage — content is unreadable without the decryption key
- Encrypted collections still work with FOC and IPFS — the CID addresses the encrypted artifact, structure remains verifiable
- Keyholders can decrypt, iterate (add sources, re-embed, extract edges), re-encrypt, and publish updated versions
- Sharing encrypted collections via IPFS requires sharing the decryption key out-of-band — the distribution mechanism is content-addressed, but access is key-gated
- Local-only mode works without any network, wallet, or encryption — zero-friction for development and private use
- The encryption boundary is at the collection/segment level, not the infrastructure level — portable security that travels with the data

### 7. Credible Exit

No lock-in at any layer. Every component is an interface. Users can swap, replace, or eject any part of the stack at any time.

- Six defined seams: Embedder, VectorIndex, StorageBackend, SourceAdapter, ManifestStore, EdgeExtractor
- Built-in implementations are defaults — never requirements
- FOC is the best default storage, not the only option
- Migrating away from wtfoc means taking your data with you �� content-addressed artifacts are portable by design

### 8. Evidence You Can Trust

Every answer traces back to original sources with proof. No black-box summaries, no hallucinated connections, no "trust me" responses.

- Trace results include the full evidence chain: which sources, which edges, which extractors, what confidence
- Agents using wtfoc can cite their sources — grounded responses, not generated assertions
- The provenance model distinguishes raw source material from derived artifacts (chunks, embeddings, edges, summaries)
- When edges are wrong or stale, the evidence makes it obvious — confidence scores, extractor identity, and timestamps are always visible
- Historical context is preserved: archived document versions remain resolvable via trace even after supersession — "what did the system know at time T?" is always answerable

## Anti-Goals

These are things wtfoc deliberately does NOT try to be:

- **Not a vector database.** We provide pluggable seams for vector stores, not a competing implementation.
- **Not an agent framework.** Agents use wtfoc as a knowledge layer — we don't orchestrate them.
- **Not an enterprise search replacement.** If all you need is "find me a doc about X," use Onyx or Glean. wtfoc is for when you need to understand *why* and *how things connect*.
- **Not a multi-writer database (yet).** Single writer per project for now. Distributed coordination comes later if needed.
- **Not a heavyweight GraphRAG platform.** We optimize for practical, evidence-backed traces on engineering artifacts — not academic graph algorithms on arbitrary knowledge domains.

## Measuring Success

wtfoc is succeeding when:

- A trace query saves someone 30 minutes of manual cross-tool searching — and they trust the result
- An AI agent cites a wtfoc trace in its response and the human can verify every hop
- A team re-runs ingest after a week and only the changed content is re-processed
- Someone pulls a collection via IPFS and immediately gets useful answers without setup
- The edge graph surfaces a connection that nobody on the team knew existed
- A new engineer onboards faster because they can trace how features evolved across code, discussions, and docs
