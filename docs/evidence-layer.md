# wtfoc as a decentralized evidence layer for RAG

Most RAG systems are strong on retrieval and weak on evidence. They return chunks that look similar to the query and let the model figure out the rest. That works until someone asks "how do you know?" — or until the underlying data moves, gets edited, or quietly disappears.

`wtfoc` is not a replacement for those systems. It sits underneath them as an **evidence layer**: a backend-neutral store of immutable content-addressed segments, explicit cross-source edges, and portable manifests that any retrieval engine can plug into.

## The problem with opaque RAG retrieval

A typical RAG pipeline does four things: chunk source data, embed it, store it in a vector index, and retrieve the top-K for each query. What that pipeline usually loses along the way:

- **Provenance** — which document, which commit, which version of the docs produced this chunk? When the answer is wrong, you cannot walk backwards to see why.
- **Portability** — embeddings and chunks live inside a vendor's vector DB. Switching backends means re-ingesting everything and rebuilding every citation.
- **Evidence continuity** — the data behind a chunk can change or be deleted without the index knowing. Retrieval returns a chunk that no longer corresponds to anything real.
- **Cross-source context** — the model sees a code snippet but never the issue that motivated it, the PR that landed it, or the docs that describe it. Retrieval surfaces the *what* without the *why*.

Teams building serious knowledge products end up rebuilding these capabilities on top of their vector DB, usually badly, once a user in production asks the wrong question.

## What wtfoc does differently

`wtfoc` treats chunks, edges, and manifests as first-class durable artifacts.

### Immutable content-addressed segments

Every chunk lives inside a **segment** — a JSON blob of chunks + embeddings + embedded edges. Segments are stored by the sha256 of their bytes. The id *is* the content. If a segment's content changes, its id changes. If its id doesn't change, neither did its content.

This is the foundation for everything else: it gives you a cheap integrity check (`wtfoc verify-trust <collection>` walks the whole graph locally), a cheap dedup story (two ingests of the same source produce the same segment id), and a cheap trust story (anyone with a manifest can verify its contents match).

### Explicit, typed, evidence-backed edges

Chunks do not just float in a vector space. They are connected by **edges** that say *why* they are connected:

- `imports` — this code file imports that one
- `references` — this PR description links to that issue
- `documents` — this markdown file documents that function
- `closes` — this PR closes that issue
- `discusses` — this Slack thread discusses that PR

Every edge carries the evidence string it was extracted from ("see #457 for context…") and a confidence score. Edges come from multiple extractors — AST parsing, regex, heuristics, and optionally LLM extraction — layered so you can tell which signals backed a given connection.

This means a RAG query for "how does the payments deposit function work" can walk from the code file to its documentation to the PR discussion to the Slack thread that motivated the change, and each hop carries the textual evidence for why it's part of the trail.

### CID-addressable manifests

A collection's **manifest** is a small JSON document listing the segments, their ids, the embedding model, the derived edge layers, and the schema version. Manifests can be pushed to IPFS/Filecoin Onchain Cloud and referenced by a single CID. That CID is the portable identity of a knowledge base.

Ship someone a CID and they have everything: the chunks, the embeddings, the edges, the provenance trail — locally verifiable against the manifest, bit-for-bit reproducible because content addressing doesn't lie. Not a database dump you have to trust. Not a snapshot that might drift. A verifiable artifact.

### Cross-source trace, not just search

`wtfoc query` does semantic search over chunks. `wtfoc trace` follows edges from the top hits to reconstruct the cross-source evidence chain. The trace phase is where the evidence-layer story pays off: you don't just see the code, you see the discussion that produced it.

The two commands expose two different retrieval surfaces. Your RAG stack picks whichever matches the question — pure similarity for a quick lookup, edge-walking trace for a provenance-rich answer.

## How it plugs into existing RAG stacks

`wtfoc` is deliberately not a full RAG framework. It ingests, extracts edges, embeds, and stores. Retrieval and trace are exposed as libraries (`@wtfoc/search`) and an HTTP server (`wtfoc serve`). You keep your LLM orchestration, your prompt logic, your agent loop, your UI.

Three integration patterns are useful:

**As a retrieval backend.** Your application calls `wtfoc query` or `wtfoc trace` instead of (or alongside) your existing vector DB. You get immutable segments, portable manifests, and cross-source edges for free. You give up whatever your existing DB does better — hybrid keyword+vector, managed ops, very large scale. For small-to-medium corpora where provenance matters more than latency, this is a strong default.

**As a shadow index.** You keep your primary vector DB for speed and run `wtfoc` alongside it to own the durable, portable, verifiable copy. When something goes wrong in production you reach for the `wtfoc` version to trace back to ground truth. When you rotate embedding models you re-embed from `wtfoc`'s stored content rather than re-fetching from upstream sources.

**As a publication layer.** You build a knowledge base privately, freeze a manifest, push it to Filecoin Onchain Cloud, and hand out the CID. Anyone can pull that CID, verify it locally, and run their own retrieval against it. Good for public documentation hubs, shared engineering context across companies, or simply shipping a reproducible snapshot to a customer.

In none of these does `wtfoc` replace your retrieval frontend. It just makes the data behind it durable, portable, and traceable.

## The trust story

"Trust" is an overloaded word, so let's be specific. A consumer of a `wtfoc` collection can independently verify these claims without talking to the original publisher:

- **The collection is internally consistent.** `wtfoc verify-trust` checks the manifest schema, that every referenced segment is reachable, that every segment's bytes still sha256 to its recorded id, and that every overlay edge's source chunk exists. If any of these fail, the collection has been tampered with or corrupted locally.
- **The content is what the publisher committed.** Because segment ids are sha256 of content and the manifest lists those ids, pulling a CID and verifying it yields bit-for-bit what the publisher had.
- **The retrieval results are grounded in real artifacts.** Every trace hop cites a chunk in the collection, and every chunk carries its source URL and a timestamp. "Where does this come from?" is always answerable.

What `wtfoc` **does not** claim:

- It does not verify publisher identity. A CID says "this content has this hash," not "this content came from who you think it came from." Signing and identity live above this layer.
- It does not verify that the upstream source still exists. If a GitHub issue gets deleted, the `wtfoc` segment still carries a frozen copy, but the external reference is stale.
- It does not replace decentralized query. Retrieval still happens on whatever machine runs `wtfoc serve`. The decentralization is in storage and provenance, not in query execution.

This is a narrower trust claim than "blockchain-verified" marketing usually implies, and that narrowness is the point. What you get is a substrate where every retrieval answer has a citable, reproducible origin, and where the knowledge base itself can be shipped around without losing its meaning.

## Where this lands

The flagship demo positions `wtfoc` as the layer between raw sources and your RAG application. The question to ask when deciding whether to adopt it is not "is this a better vector DB than Pinecone" — it isn't, and it doesn't try to be. The question is: **when your RAG answer is wrong, can you walk back to the evidence?**

If the answer is "not really, the chunks are gone and we can't reconstruct the trail," you have an evidence-layer problem. That is what `wtfoc` is for.

## See also

- [Why wtfoc?](why.md) — the origin story and the observability motivation
- [Vision](vision.md) — longer-horizon goals and the decentralized-persistence angle
- [Pipeline architecture](pipeline-architecture.md) — how ingestion, extraction, embedding, and storage fit together
- [FOC + RAG storage](foc-rag-storage.md) — the storage seam and the FOC-specific defaults
- [FAQ](FAQ.md) — common questions about scope and fit
