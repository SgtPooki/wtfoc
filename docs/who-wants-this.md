# Who Wants This and Why

For each major wtfoc capability: who benefits, why they'd use it, what they use today, and why that doesn't work.

## 1. Cross-source trace ("wtfoc trace")

**Who:** Engineering teams, support/CX teams, incident responders, new hires onboarding.

**What:** Query across Slack, GitHub issues, PRs, code, and docs in one command. Get evidence-backed connections, not just "similar documents."

**Why they'd use it:** A customer reports "upload failures" in Slack. Today, someone manually searches Slack, then GitHub issues, then finds the PR, then reads the code. This takes 30 minutes and lives in one person's head. `wtfoc trace "upload failures"` returns the full chain in seconds.

**What they use today:** Manual searching across Slack + GitHub + docs. Or: Notion search (single source only), GitHub code search (code only), Slack search (messages only). No tool connects all three.

**Why that doesn't work:** Information silos. No tool traces the *connection* between a Slack complaint and the PR that fixed it. Context gets lost when people leave or channels are archived.

## 2. Verifiable knowledge base (FOC storage + CIDs)

**Who:** Compliance teams, auditors, regulated industries, open-source ecosystems sharing knowledge, teams that need to prove "we knew X at time T."

**What:** Every chunk of knowledge has a content-addressed identifier (CID). The knowledge base state at any point in time is cryptographically verifiable.

**Why they'd use it:**
- **Compliance:** "Show that your AI system's training data hasn't changed since the audit." CIDs prove it.
- **Legal discovery:** "Prove what your team knew about this bug on March 15." The manifest from that date has CIDs pointing to exact sources.
- **Shared intelligence:** Team A publishes a collection CID. Team B downloads and queries it. Both can verify they're looking at the same data. No trust required.
- **Incident postmortems:** "Reconstruct exactly what information was available when this decision was made."

**What they use today:** S3 + Pinecone/Weaviate. Confluence. Notion.

**Why that doesn't work:** S3 can silently overwrite objects. Pinecone can silently reindex. Confluence has no content-addressing. None of them can prove "this data hasn't been tampered with." You trust the vendor — there's no independent verification.

## 3. Pluggable seams (BYO embedder/vector store/storage)

**Who:** Teams with existing infrastructure. Teams with specific model requirements. Privacy-conscious teams that need local-only operation.

**What:** Swap any component without changing your data or workflow. Use Qdrant instead of in-memory. Use Ollama instead of OpenAI. Use S3 instead of FOC.

**Why they'd use it:** "We already have Qdrant running. We don't want another vector DB. We just want the trace and edge-extraction layer on top."

**What they use today:** Tightly coupled RAG stacks (LangChain + Pinecone, LlamaIndex + Weaviate). Switching requires rewriting.

**Why that doesn't work:** Vendor lock-in. If you start with Pinecone and want to switch to Qdrant, you rewrite your retrieval layer. wtfoc's seams mean you swap one config line.

## 4. Repo/code ingestion

**Who:** Developers learning a new codebase. Teams managing multiple repos. OSS contributors trying to understand a project.

**What:** `wtfoc ingest repo FilOzone/synapse-sdk` indexes the entire codebase — code, docs, imports, issue references — and makes it searchable.

**Why they'd use it:** "How does upload work in this SDK?" Instead of grepping through 500 files, query the semantic index. Get the upload handler, the docs that describe it, and the tests that validate it.

**What they use today:** GitHub code search (keyword only, no semantic). grep/ripgrep (exact match only). Reading code manually.

**Why that doesn't work:** Keyword search misses semantic matches. "upload handler" doesn't match "store data" even though they're the same concept. Semantic search across code + docs surfaces connections that text search can't.

## 5. Edge extraction

**Who:** Anyone who needs to understand relationships between artifacts, not just find similar text.

**What:** When ingesting, wtfoc extracts explicit connections: `import` statements linking files, `#123` references linking code to issues, `Closes #N` linking PRs to issues.

**Why they'd use it:** Semantic similarity finds "similar text." Edges find "connected artifacts." `wtfoc trace` can follow: Slack complaint → referenced issue → closing PR → changed code file. That chain is built from explicit edges, not fuzzy similarity.

**What they use today:** Nothing. No RAG tool extracts typed, evidence-backed edges at ingest time.

**Why that doesn't work:** Standard RAG returns "these 5 chunks are similar to your query." It can't tell you *why* they're connected or trace the chain of events.

## 6. Embedding model audit trail

**Who:** ML ops teams, compliance, anyone who needs reproducibility.

**What:** Every segment records which embedding model produced its vectors. Switching models creates new segments — old ones persist. The full model history is verifiable via CIDs.

**Why they'd use it:** "Which model was used for our Q3 knowledge base?" Check the segment metadata. "Can we reproduce last month's search results?" Load the segments from that date, use the same model.

**What they use today:** No tracking. Teams upgrade embedding models and lose the ability to reproduce old results.

## Competitors and Gaps

| Tool | What it does | What it doesn't do |
|------|-------------|-------------------|
| **Pinecone** | Hosted vector DB | No source ingestion, no edge extraction, no provenance, vendor lock-in |
| **Weaviate** | Vector DB + some ingestion | No cross-source tracing, no content-addressing, no FOC |
| **LangChain** | RAG framework | No storage layer, no edge extraction, no verification |
| **LlamaIndex** | RAG framework + storage | No cross-source edges, no content-addressing |
| **Notion AI** | Search within Notion | Single source only, no code, no verification |
| **Glean** | Enterprise search | Closed source, expensive, no content-addressing |
| **Captain (YC)** | Managed RAG service | No edge extraction, no verification, S3-backed |

**wtfoc's unique position:** Evidence-backed knowledge tracing with verifiable, portable, decentralized storage. No other tool combines typed edges + content-addressed storage + pluggable seams.
