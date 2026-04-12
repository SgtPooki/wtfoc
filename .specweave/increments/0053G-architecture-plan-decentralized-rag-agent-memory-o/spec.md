# Architecture Plan: Decentralized RAG + Agent Memory on FOC

**Increment**: 0053G-architecture-plan-decentralized-rag-agent-memory-o
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #1

## Description

# foc-rag: Decentralized RAG + Agent Memory on FOC

## Context

FOC WG Hackathon #2 (March 23-27). New public repo providing:
1. **RAG pipeline backed by FOC** — content-addressable chunks with verifiable provenance
2. **Persistent agent memory** with snapshot/restore across runtimes
3. **Cross-source correlation** — tie Slack conversations to GitHub issues to code changes

### Why this matters to the team
Current workflow: someone reports a problem in Slack, someone else files an issue, a third person fixes it in a PR. These connections live in people's heads. foc-rag ingests all three sources, indexes them on decentralized storage, and surfaces the connections automatically. "Show me everything related to this customer complaint" returns the Slack thread, the GitHub issue, and the PR that fixed it.

## Critical Design Problem: Immutable DAGs

FOC/IPFS content is immutable and content-addressed. You upload bytes, get a PieceCID. You cannot update DAGs in place. Therefore we need a **mutable index layer** that tracks evolving state while actual data remains immutable on FOC.

**Solution: Manifest chain pattern**
- Each state change produces a new manifest (JSON) uploaded to FOC
- Manifests link to previous version via `previousManifestCid` (like git commits)
- Local state file (`~/.foc-rag/state.json`) maps `{type, name}` → latest manifest CID
- Cross-runtime restore: bootstrap from any known CID
- The manifest IS the knowledge index — contains chunk metadata, embeddings, BM25 terms, source info

## Architecture

### Package Structure (pnpm monorepo)

```
foc-rag/
├── packages/
│   ├── core/                     # @foc-rag/core — zero-framework library
│   │   ├── src/
│   │   │   ├── index.ts          # Public API
│   │   │   ├── types.ts          # All interfaces
│   │   │   ├── foc-store.ts      # Synapse-sdk upload/download wrapper
│   │   │   ├── chunker.ts        # Markdown-aware text splitting
│   │   │   ├── embedder.ts       # Embedding abstraction (transformers.js + OpenAI fallback)
│   │   │   ├── search/
│   │   │   │   ├── vector-index.ts   # Dense cosine similarity search
│   │   │   │   ├── bm25-index.ts     # Sparse lexical search
│   │   │   │   └── hybrid.ts         # RRF fusion of dense + sparse
│   │   │   ├── rag-pipeline.ts   # Ingest + Query orchestrator
│   │   │   ├── memory-store.ts   # Agent memory snapshot/restore
│   │   │   └── manifest.ts       # Mutable index / manifest chain
│   ├── mcp-server/               # @foc-rag/mcp-server — MCP tool server
│   │   ├── src/
│   │   │   ├── index.ts          # MCP server entry (stdio)
│   │   │   └── tools.ts          # Tools: ingest, query, snapshot, restore, correlate
│   └── demo/                     # @foc-rag/demo — CLI demo for hackathon
│       ├── src/
│       │   ├── cli.ts            # Commander-based CLI
│       │   ├── ingest-slack.ts   # Slack channel JSON → chunks
│       │   ├── ingest-repo.ts    # Git repo → code + issues + PRs → chunks
│       │   └── demo-correlate.ts # Cross-source correlation demo
```

### Core Modules

#### `foc-store.ts` — FOC Storage Abstraction
Wraps `@filoz/synapse-sdk` for simple put/get:
- `upload(data: Uint8Array, metadata?)` → `{ pieceCid, size }`
- `download(pieceCid: string)` → `Uint8Array`
- Uses `source: 'foc-rag'` for namespace isolation
- Network: Calibration testnet for demo

#### `chunker.ts` — Source-Aware Text Splitting
- Markdown-aware: split on headers, paragraphs, sentences, characters
- Configurable `chunkSize` (default 512) and `chunkOverlap` (default 50)
- Each chunk gets deterministic `id` (SHA-256 of content) for dedup
- **Source typing**: chunks carry `sourceType` ('slack-message' | 'github-issue' | 'github-pr' | 'code' | 'markdown' | 'doc')
- Preserves provenance: `{ source, sourceType, sourceUrl, chunkIndex, timestamp }`

#### `embedder.ts` — Local Embeddings
- Primary: `@huggingface/transformers` with `Xenova/all-MiniLM-L6-v2` (384d, ~23MB)
- Fallback: OpenAI `text-embedding-3-small` via fetch
- No API keys for primary — "fully decentralized" narrative

#### `search/` — Hybrid Retrieval

**`vector-index.ts`** — Dense semantic search
- Brute-force cosine similarity (sufficient for demo scale)
- Serializable to/from manifest

**`bm25-index.ts`** — Sparse lexical search
- BM25 over chunk terms
- Critical for exact matches: issue IDs, PR numbers, channel names, error strings, file paths

**`hybrid.ts`** — Reciprocal Rank Fusion
- `score = 1/(k + rank_dense) + 1/(k + rank_sparse)`, k=60
- Source-aware diversification: results span multiple source types

#### `manifest.ts` — Knowledge Index

```typescript
interface Manifest {
  version: number
  type: 'rag-collection' | 'agent-memory'
  name: string
  previousManifestCid: string | null
  createdAt: string

  // RAG collection state — the full index
  chunks?: Array<{
    id: string              // content hash (dedup key)
    pieceCid: string        // FOC storage CID
    embedding: number[]     // dense vector
    terms: string[]         // BM25 terms
    source: string          // e.g. "#foc-support", "FilOzone/synapse-sdk#42"
    sourceType: string      // 'slack-message' | 'github-issue' | 'github-pr' | 'code'
    sourceUrl?: string      // link back to original
    timestamp?: string      // when the source was created
    metadata: Record<string, string>
  }>

  // Agent memory state
  memorySnapshotCid?: string
  memoryVersion?: number
}
```

Embeddings live IN the manifest — entire RAG index is portable via a single CID. No external vector DB dependency.

#### `rag-pipeline.ts` — Orchestrator

**Ingest flow:**
1. Source adapter produces typed chunks (Slack JSON → chunks, GitHub API → chunks, etc.)
2. Dedup: skip chunks with same content hash
3. Embed new chunks locally
4. Upload each chunk to FOC → PieceCID
5. Extract BM25 terms
6. Build new manifest, upload to FOC
7. Update local pointer

**Query flow:**
1. Embed query locally
2. Hybrid search (dense + BM25 + RRF fusion)
3. Source-aware diversification
4. Download chunk content from FOC
5. Return results with scores + CID citations + source provenance

**Correlate flow (cross-source):**
1. Query with a Slack message, issue title, or free text
2. Return results grouped by sourceType
3. Show connections: "This Slack complaint → this GitHub issue → this PR/code change"

#### `memory-store.ts` — Agent Memory
- **Snapshot:** serialize → upload to FOC → new manifest
- **Restore:** get manifest → download snapshot → deserialize
- **Bootstrap:** given any CID → download → restore (no local state needed)

### MCP Server Tools

| Tool | Description |
|------|-------------|
| `foc_rag_ingest` | Ingest document/source into named collection |
| `foc_rag_query` | Hybrid search with CID citations |
| `foc_rag_correlate` | Cross-source correlation query |
| `foc_memory_snapshot` | Save agent memory to FOC |
| `foc_memory_restore` | Restore agent memory (by name or CID) |

### Key Dependencies

```
@filoz/synapse-sdk ^0.40.0    — FOC storage
@huggingface/transformers ^3   — local embeddings
@modelcontextprotocol/sdk ^1   — MCP server
viem ^2.46                     — wallet/chain interaction
commander ^14                  — demo CLI
```

## Demo Plan (2 minutes — showing team value)

### Setup
Pre-ingest: a Slack channel export (e.g. #foc-support or similar), a GitHub repo's issues+PRs, and relevant code files.

### Part 1 — Ingest multiple sources (30s)
```bash
foc-rag ingest-slack ./exports/foc-support.json --collection team-intel
foc-rag ingest-repo FilOzone/some-repo --collection team-intel
```
Show: "142 Slack messages + 87 GitHub issues + 34 PRs → 450 chunks, stored on FOC, all content-addressable"

### Part 2 — Cross-source correlation (60s)
```bash
foc-rag correlate "users reporting upload failures" --collection team-intel
```
Show results grouped by source:
- **Slack**: 3 messages from #foc-support mentioning upload failures
- **GitHub Issues**: Issue #142 "Upload timeout on large files"
- **GitHub PRs**: PR #156 "Fix upload retry logic"
- **Code**: `packages/synapse-sdk/src/storage/manager.ts` upload handler

"One query surfaces the customer complaint, the issue that tracks it, the PR that fixed it, and the code that changed. All stored on decentralized storage with verifiable CID citations."

### Part 3 — Verifiable provenance (15s)
"Every result has a PieceCID. Anyone can independently verify the content hasn't been tampered with by fetching from FOC."

### Part 4 — Agent memory (15s)
Quick show: agent snapshots its learned context to FOC → restore from CID on different machine.

## Build Sequence (5 Days)

### Day 1 (Mon): Foundation
- [ ] Init monorepo (pnpm workspace, tsconfig, biome)
- [ ] `foc-store.ts`: upload/download via synapse-sdk on calibration testnet
- [ ] `chunker.ts`: markdown-aware splitting with source typing
- [ ] `manifest.ts`: local state + manifest serialization
- [ ] Verify: upload → download round-trip

### Day 2 (Tue): Embeddings + Search + Ingest
- [ ] `embedder.ts`: TransformersEmbedder with MiniLM
- [ ] `vector-index.ts` + `bm25-index.ts` + `hybrid.ts`
- [ ] `rag-pipeline.ts`: ingest flow
- [ ] Source adapters: Slack JSON ingester, GitHub ingester (via `gh` CLI)
- [ ] Verify: ingest Slack export, chunks on FOC

### Day 3 (Wed): Query + Correlation + Memory
- [ ] RAG query flow with hybrid search
- [ ] Cross-source correlation (query → grouped results by sourceType)
- [ ] `memory-store.ts`: snapshot + restore
- [ ] Manifest chain on FOC (previousManifestCid linking)
- [ ] Verify: full ingest→query→correlate round-trip

### Day 4 (Thu): MCP Server + Demo CLI
- [ ] MCP server with 5 tools
- [ ] Demo CLI with `ingest-slack`, `ingest-repo`, `query`, `correlate` commands
- [ ] End-to-end demo script
- [ ] Edge cases and error handling

### Day 5 (Fri): Polish + Submit
- [ ] README with architecture diagram
- [ ] Record 2-min demo video
- [ ] File future work as GitHub issues
- [ ] Final testing on calibration testnet

## MVP vs Future (GitHub Issues)

**In scope (this week):**
- FOC upload/download of text chunks
- Markdown-aware chunking with source typing and dedup
- Local embeddings (transformers.js)
- Hybrid search: dense + BM25 + RRF fusion
- Source-aware metadata and cross-source correlation
- Manifest chain on FOC
- Slack JSON + GitHub repo ingesters
- Agent memory snapshot/restore
- MCP server + Demo CLI

**Out of scope — file as issues:**
- GraphRAG / entity-relationship extraction
- RAPTOR hierarchical summaries
- ColBERT / late-interaction reranking
- Code-aware retrieval (AST, symbols, call graphs)
- Manifest sharding for large collections
- LangChain / LlamaIndex adapter packages
- IPNS mutable pointers
- On-chain manifest registry (smart contract)
- Multi-user / team collections
- Differential memory snapshots
- TTL/pruning policies
- PDF / rich document parsing
- Time-aware retrieval weighting
- Streaming ingest (watch directory/channel)
- Real-time Slack integration (webhook listener)

## User Stories

- **US-001**: As a user, I want architecture plan decentralized rag agent memory o so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #1 on 2026-04-12.
