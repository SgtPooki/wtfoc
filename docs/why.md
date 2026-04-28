# Why wtfoc?

*For the full north-star goals and what "done" looks like, see [vision.md](./vision.md).*

## The Problem

Your team's knowledge is scattered. Code lives in GitHub. Decisions happen in Slack. Requirements are in Jira. Documentation drifts out of sync. Customer feedback sits in a support tool. When someone asks "why was auth.ts rewritten?" the answer spans a Slack thread, two PRs, a design doc, and a customer escalation ticket — and piecing that together today is manual, slow, and fragile.

Existing tools each solve a piece of this, but none solve the whole thing:

**Enterprise search tools** (Glean, Onyx, GoSearch) are excellent at "find me a document about X." They index your sources and return relevant pages. But they don't model the *relationships* between those pages — they can't trace *why* something happened or *what led to* a decision across sources.

**Code intelligence tools** (Sourcegraph, Greptile, GitNexus) understand codebases deeply — dependency graphs, call chains, cross-repo analysis. But they're code-focused — they don't connect a function to the Slack discussion that motivated it, or to the customer complaint that triggered the refactor.

**RAG frameworks** (LlamaIndex, LangChain, Haystack) give LLMs context from your docs. But they typically treat documents as bags of text — chunks go in, nearest neighbors come out. Some support knowledge graphs, but building a cross-source, evidence-backed graph pipeline is still a build-it-yourself exercise.

These tools are good at what they do. The gap is in **cross-source traceability** — following evidence chains across different tools and source types to answer "why" and "how did this happen?"

## What wtfoc Does Differently

wtfoc is an **evidence-backed trace engine for engineering context**. It builds knowledge graphs with explicit, typed edges across every source type — not just embeddings, but actual relationships between artifacts with confidence scores, evidence trails, and provenance you can verify.

### Search vs. Trace

Most tools only do search: "find chunks similar to my query."

wtfoc does both:

- **`query`** — semantic search, same as everyone else. Find relevant chunks by embedding similarity.
- **`trace`** — follow explicit edges across sources. Start from a query, find related chunks, then walk the graph: this PR closes that issue, which was discussed in this Slack thread, which references that design doc, which was motivated by this customer feedback.

Trace answers questions that search cannot:
- "What was the full context when we migrated billing?" (Slack + PRs + issues + code changes + docs)
- "Which Slack discussions led to this architecture decision?" (temporal + reference edges)
- "What customer feedback drove feature X, and which PRs implemented it?" (user-story edges across sources)
- "If I change this API, what downstream code, docs, and tests are affected?" (code-path + documentation edges)

### Multi-Extractor Edge Pipeline

wtfoc doesn't rely on a single method to find relationships. It runs multiple extractors in parallel and merges their findings:

| Extractor | What it finds | How |
|-----------|---------------|-----|
| Pattern-based | GitHub refs, Jira keys, Slack links, import statements | Regex, deterministic |
| Code analysis | Import chains, package deps, function calls | oxc-parser AST, tree-sitter sidecar |
| Heuristic | Markdown hyperlinks, cross-repo references | Pattern matching with inference |
| Temporal | Chat messages near GitHub activity | Timestamp proximity |
| LLM | Design discussions, person mentions, concept references | Semantic extraction via any LLM |

When multiple extractors agree on the same edge, confidence increases. Every edge carries evidence text and provenance — you can always see *why* the system thinks two things are connected.

### Immutable, Content-Addressed Knowledge

Every segment is content-addressed (SHA-256) and immutable. Old segments are never deleted — they form an audit trail. The collection head is the only mutable pointer.

This means:
- **Verifiable**: Anyone can check that a collection hasn't been tampered with
- **Reproducible**: Given the same inputs, you get the same segments
- **Portable**: Collections can be shared, archived, or published as CID-addressable artifacts

### Every Component is Replaceable

wtfoc defines six seams — interfaces that any implementation can satisfy:

| Seam | What it does | Built-in defaults |
|------|-------------|-------------------|
| **Embedder** | Generate vector embeddings | transformers.js (local), OpenAI-compatible API |
| **VectorIndex** | Store and search vectors | In-memory brute-force, Qdrant |
| **StorageBackend** | Persist segments | Local filesystem, FOC |
| **SourceAdapter** | Fetch from external sources | GitHub, Slack, Discord, web, HN, repo |
| **ManifestStore** | Manage collection heads | Local JSON files |
| **EdgeExtractor** | Find relationships | Regex, heuristic, code, tree-sitter, LLM |

Lock-in is a bug, not a feature. You can swap any component without touching the rest.

## Why FOC?

FOC (Filecoin Onchain Cloud) is the default storage backend, but wtfoc works without it. So why FOC at all?

### Knowledge That Outlives Your Infrastructure

Most knowledge tools store data in a database that lives on your infrastructure. If the tool goes down, your knowledge goes with it. If the company migrates platforms, the knowledge needs to be re-exported and re-imported (if that's even possible).

FOC-backed collections are **content-addressed and decentralized**. A collection stored on FOC:
- Has a permanent, verifiable CID
- Can be retrieved from any IPFS/Filecoin gateway
- Survives infrastructure changes, vendor switches, and company transitions
- Can be shared with anyone who has the CID — no access control setup needed

### Portable Knowledge Snapshots

A wtfoc collection on FOC is a **self-contained knowledge artifact**. You can:
- Publish a collection revision as a single CID
- Share it with a partner, auditor, or open-source community
- Mount it on a different machine with `wtfoc pull <cid>` and immediately query/trace
- Use it as a time-stamped snapshot for compliance or audit

### Low-Compute Consumers

Not everyone has GPU resources for embedding. A FOC-backed collection includes pre-computed embeddings — a consumer can mount the collection and run queries without re-embedding the corpus. Only query-time embedding is needed (one text at a time), which works on any hardware.

### The Credible Exit

FOC is the best default, not the only option. The `StorageBackend` seam means you can use local filesystem storage for development, switch to FOC for production/publishing, or implement your own backend for S3, GCS, or any other storage system. Your knowledge is never locked in.

## Who Is This For?

### Engineering Teams

- **Cross-repo knowledge**: "What's the full picture across our 20 repos, Slack, and Jira?"
- **Onboarding**: New engineers trace how features evolved — code, discussions, decisions, and docs
- **Incident response**: "What changed recently that could have caused this? What Slack threads discussed it?"
- **Architecture decisions**: Trace from a design doc to the PRs that implemented it to the tests that verify it

### Technical Leads & PMs

- **Impact analysis**: "If we change this API, what downstream code, docs, and integrations are affected?"
- **Feature history**: Connect customer feedback → feature request → implementation → deployment
- **Knowledge gaps**: "What parts of our system have no documentation edges? Where are docs drifting from code?"
- **API drift / pain-point detection**: "Where do code, changelog, docs, and customer reports describe the same concept differently — and where are they diverging?" Cross-source canonicalization is what makes this answerable, not embedding similarity alone. See [vision.md — What collections are for](./vision.md#what-collections-are-for) for the full four-use-case taxonomy (extend / RAG / share / drift).

### AI Agents

- **Grounded context**: Agents get evidence-backed knowledge, not just nearest-neighbor chunks
- **Explainable answers**: Every answer traces back through evidence chains to original sources
- **Always current**: Scheduled ingest keeps collections up-to-date as sources change
- **Multi-hop reasoning**: Agents follow edge paths to answer questions that span multiple sources

## How Is This Different From...

### Onyx / Glean (Enterprise Search)

Enterprise search excels at finding documents. wtfoc excels at tracing relationships *between* documents. Onyx can answer "find me the doc about billing migration." wtfoc can answer "what Slack discussions, PRs, customer tickets, and code changes were involved in the billing migration, and how do they connect?" These tools are complementary — enterprise search for lookup, wtfoc for cross-source traceability.

### Sourcegraph / Greptile / GitNexus (Code Intelligence)

Code intelligence tools understand codebases deeply. wtfoc adds the surrounding context — the Slack discussions, issue threads, design docs, and customer feedback that explain *why* the code is the way it is. GitNexus builds a knowledge graph within a repo; wtfoc builds one across repos, conversations, docs, and feedback.

### LlamaIndex / LangChain / Haystack (RAG Frameworks)

These are excellent libraries for building RAG pipelines. wtfoc is an opinionated complete tool built on a specific thesis: **explicit, typed, evidence-backed edges are better than embeddings alone for cross-source sensemaking.** You could build something similar with LlamaIndex — but you'd be building wtfoc from scratch, including the multi-extractor edge pipeline, the version-chain model, and the FOC storage integration.

### Neo4j / Knowledge Graph Databases

General-purpose graph databases require you to define a schema and populate it. wtfoc is an opinionated pipeline that ingests your sources and discovers relationships automatically through its multi-extractor pipeline. The graph builds itself from your engineering artifacts.

## Embedding Model Audit Trail

Every segment records which embedding model produced its vectors. Switching models creates new segments — old ones persist as an immutable audit trail. The full model history is verifiable via content-addressed identifiers.

This means you can always answer: "Which model was used for our Q3 knowledge base?" and "Can we reproduce last month's search results?"

## The Bottom Line

If you need to search across your tools — use Onyx or Glean. They're great at that.

If you need to **understand how things connect across your entire engineering context** — code, conversations, decisions, documentation, customer feedback — with evidence trails you can follow and verify, stored in portable, content-addressed artifacts that outlive any single tool or infrastructure — that's what wtfoc is for.

For the full vision of where wtfoc is headed, see [vision.md](./vision.md).
