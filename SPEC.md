# wtfoc — Specification

> What the FOC happened? Trace it.

Decentralized knowledge tracing and recall on FOC (Filecoin Onchain Cloud).

## Foundational Rules

### 1. Every package is standalone

Each package under `@wtfoc/*` must be independently useful. A user should be able to `npm install @wtfoc/store` without pulling in search, ingest, or the CLI.

- Packages declare peer dependencies on each other, never hard dependencies (unless truly inseparable like `@wtfoc/common`)
- `@wtfoc/common` holds shared types, interfaces, and utilities — it is the only allowed hard dependency across packages
- No circular dependencies between packages
- Each package has its own README, entry point, and tests

### 2. Interfaces over implementations

Every major component is defined as a TypeScript interface in `@wtfoc/common`. Built-in implementations are defaults; users can bring their own.

Four seams:
- **Embedder** — embed text to vectors (built-in: transformers.js, OpenAI)
- **VectorIndex** — store and search vectors (built-in: in-memory brute-force)
- **StorageBackend** — upload/download blobs (built-in: local filesystem, FOC via synapse-sdk)
- **SourceAdapter** — ingest from a data source (built-in: Slack JSON, GitHub via gh CLI)

### 3. Hackathon-first, future-aware

The primary goal is a compelling demo for FOC WG Hackathon #2 (March 23-27, 2026). Every decision should optimize for:

1. A working demo that tells a story
2. Clean architecture that shows what more is possible
3. Code quality that doesn't embarrass us after the hackathon

"Ship the demo, but make it worth extending."

### 4. FOC is the default, not the requirement

- Local storage mode (`--local`) works without a wallet or network
- FOC storage mode is the default for production use
- Storage backend is pluggable — FOC, local, S3, IPFS-only, etc.
- Users who don't know what FOC is should still find the tool useful

### 5. Content-addressable everything

Every artifact stored gets dual CIDs:
- **PieceCID** — FOC-native, used for Filecoin proof verification
- **IPFS CID** — universally understood, gateway-accessible

CIDs are the citation and verification mechanism. Every query result includes CIDs so users can independently verify content.

### 6. Immutable data, mutable index

FOC/IPFS content is immutable. The mutable index layer uses the **manifest chain pattern**:
- **Head manifest** (tiny, mutable pointer): collection metadata, segment summaries, prevHeadCid
- **Segment blobs** (immutable, write-once): batched chunks with embeddings + edges
- Upload segments first, verify, then publish head — never reference unverified CIDs
- Local state file tracks latest head CID per project
- Cross-machine restore via bootstrap from any known CID

### 7. Edges are first-class

Cross-source connections are not just semantic similarity — they are explicit, typed edges extracted at ingest time:

```typescript
interface Edge {
  type: 'references' | 'closes' | 'changes'
  sourceId: string
  targetType: 'issue' | 'pr' | 'slack-message' | 'commit' | 'file'
  targetId: string        // repo-scoped: "FilOzone/synapse-sdk#142"
  evidence: string        // "Closes #142 in PR body"
  confidence: number      // 1.0 explicit, <1.0 semantic
}
```

The `trace` command follows edges, not just vector similarity.

### 8. SDK policy

- Use `filecoin-pin` + `@filoz/synapse-sdk` directly for FOC storage operations
- Use `foc-cli` only for features filecoin-pin and synapse-sdk don't provide
- Use `filecoin-nova` for website crawling/ingestion
- Don't reinvent what the FOC ecosystem already ships

## Package Architecture

| Package | Purpose | Standalone use case |
|---------|---------|-------------------|
| `@wtfoc/common` | Shared types, interfaces, utilities | Dependency of all other packages |
| `@wtfoc/store` | FOC storage abstraction (upload/download/manifest/CIDs) | "I want simple put/get for FOC with dual CIDs" |
| `@wtfoc/ingest` | Source adapters + chunking + edge extraction | "I want to archive my Slack/GitHub to FOC" |
| `@wtfoc/search` | Embedder + vector index + hybrid search + trace | "I have data on FOC, I want to search it" |
| `@wtfoc/memory` | Agent memory snapshot/restore | "I want persistent agent memory on decentralized storage" |
| `@wtfoc/cli` | CLI wrapping all packages | Full experience |
| `@wtfoc/mcp` | MCP server exposing tools to agents | Agent integration |

## Demo Scope (Hackathon MVP)

The demo tells this story:

> "A customer complains in Slack. Someone files an issue. Someone else fixes it in a PR.
> These connections live in people's heads. wtfoc makes them searchable and verifiable."

### What we ship:
- `wtfoc trace "upload failures"` — evidence-backed cross-source trace
- `wtfoc query "how does auth work?"` — semantic search with CID citations
- `wtfoc verify <cid>` — tamper-evidence proof
- Slack JSON + GitHub ingesters
- Local + FOC storage backends
- Golden demo dataset with curated incident chain

### What we demo but don't ship as polish:
- Agent memory snapshot/restore (10-second epilogue)
- MCP server (stretch)

### What we show as "what's next":
- Website ingestion via Nova
- Qdrant/Pinecone vector store adapters
- Real-time Slack webhook ingestion
- Web dashboard with visual trace explorer
- LangChain/LlamaIndex adapters

## Technical Decisions

- **Language:** TypeScript (no Python SDK for FOC exists)
- **Monorepo:** pnpm workspaces with TypeScript project references
- **Formatting:** Biome
- **Embeddings:** transformers.js with Xenova/all-MiniLM-L6-v2 (384d, local, no API key)
- **Vector search:** Brute-force cosine similarity (demo scale)
- **Network:** Calibration testnet for demo
- **Node:** >=18
