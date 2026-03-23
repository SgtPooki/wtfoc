# wtfoc — Specification

> What the FOC happened? Trace it.

Decentralized knowledge tracing and recall on FOC (Filecoin Onchain Cloud).

## Foundational Rules

### 1. Every package is standalone

Each package under `@wtfoc/*` must be independently useful. A user should be able to `npm install @wtfoc/store` without pulling in search, ingest, or the CLI.

- `@wtfoc/common` is a hard dependency of all other packages (shared types, interfaces, schemas)
- **Library packages** (`common`, `store`, `ingest`, `search`) use peer dependencies for cross-package references
- **Application packages** (`cli`, `mcp`) hard-depend on the library packages they compose — `npm install -g @wtfoc/cli` must pull a working CLI
- No circular dependencies between packages
- Each package has its own README, entry point, and tests

### 2. Credible exit at every seam

Every component is an interface. Users can swap, replace, or eject any part of the stack at any time. This is not optional — it is the core design principle.

**Why:** Open source thrives on credible exit. If users can't leave, they won't join. If they can leave easily, they'll stay because the defaults are good. Lock-in is a bug, not a feature.

**Seams (all pluggable via interfaces in `@wtfoc/common`):**

| Seam | Interface | Built-in default | User can swap to |
|------|-----------|-----------------|-----------------|
| **Embedder** | `Embedder` | transformers.js (local, no API key) | OpenAI, Ollama, Cohere, vLLM, any embedding service |
| **VectorIndex** | `VectorIndex` | In-memory brute-force | Qdrant, Pinecone, Weaviate, Milvus, any vector DB |
| **StorageBackend** | `StorageBackend` | FOC (synapse-sdk + filecoin-pin) | Local filesystem, S3, GCS, IPFS-only, any blob store |
| **SourceAdapter** | `SourceAdapter` | Slack JSON, GitHub (gh CLI) | Jira, Discord, Linear, Confluence, any data source |
| **ManifestStore** | `ManifestStore` | FOC-backed head+segments | Local-only, S3-backed, any mutable index |
| **EdgeExtractor** | `EdgeExtractor` | Regex-based (refs, closes, changes) | LLM-based, AST-based, custom extractors |

**Every seam follows the same pattern:**
```typescript
// Interface in @wtfoc/common
interface StorageBackend {
  upload(data: Uint8Array, metadata?: Record<string, string>): Promise<StorageResult>
  download(id: string): Promise<Uint8Array>
  verify?(id: string): Promise<{ exists: boolean; size: number }>
}

interface StorageResult {
  id: string              // backend-neutral artifact identifier
  ipfsCid?: string        // present when backend supports IPFS
  pieceCid?: string       // present when backend supports FOC
}
```

**BYO RAG index:** Users with an existing RAG index (Qdrant collection, Pinecone namespace, etc.) should be able to plug it in as a `VectorIndex` and immediately use `wtfoc trace` and `wtfoc query` against their own data. wtfoc adds the edge extraction, cross-source correlation, and verifiable storage layer — it doesn't demand you throw away what you already have.

**Interfaces at seams, concrete code elsewhere.** Only extract an interface when it's at a defined seam (listed above) or when there are two real implementations. Don't abstract speculatively.

### 3. Hackathon-first, future-aware

The primary goal is a compelling demo for FOC WG Hackathon #2 (March 23-27, 2026). Every decision should optimize for:

1. A working demo that tells a story
2. Clean architecture that shows what more is possible
3. Code quality that doesn't embarrass us after the hackathon

"Ship the demo, but make it worth extending."

### 4. FOC is the best default, not the only option

- Local storage mode (`--local`) works without a wallet or network — zero friction onboarding
- FOC storage is the default for production because content-addressable + verifiable + decentralized is genuinely better
- But the architecture never assumes FOC — every storage call goes through the `StorageBackend` interface
- Users who don't know what FOC is should still find the tool useful
- Users who already have S3/GCS/IPFS should be able to plug in their storage and get value from wtfoc's edge extraction and trace capabilities

### 5. Backend-neutral artifact identity

Storage results use a backend-neutral `id` field. CIDs are optional verification metadata, not a universal requirement:

```typescript
interface StorageResult {
  id: string              // always present — opaque identifier from the backend
  ipfsCid?: string        // present when backend supports IPFS (FOC, IPFS-only)
  pieceCid?: string       // present when backend supports FOC
  proof?: string          // present when backend supports verification
}
```

- FOC backend: `id` = PieceCID, `ipfsCid` and `pieceCid` both populated
- Local backend: `id` = file path hash, no CIDs
- S3 backend: `id` = S3 key, no CIDs
- The `verify` command works when the backend supports it; gracefully reports "not available" otherwise

### 6. Immutable data, mutable index

FOC/IPFS content is immutable. The mutable index layer uses the **manifest chain pattern**:
- **Head manifest** (tiny, mutable pointer): collection metadata, segment summaries, prevHeadCid, `schemaVersion`
- **Segment blobs** (immutable, write-once): batched chunks with embeddings + edges
- Upload segments first, verify, then publish head — never reference unverified CIDs
- Local state file tracks latest head CID per project
- Cross-machine restore via bootstrap from any known CID
- **Single writer per project** for MVP — concurrent updates are rejected via prevHeadCid mismatch. Future: compare-and-swap with conflict errors.

### 7. Edges are first-class

Cross-source connections are not just semantic similarity — they are explicit, typed edges extracted at ingest time:

```typescript
interface Edge {
  type: string            // built-in: 'references' | 'closes' | 'changes'
  sourceId: string        // custom types welcome: 'myapp:depends-on', etc.
  targetType: string      // 'issue' | 'pr' | 'slack-message' | 'commit' | 'file'
  targetId: string        // repo-scoped: "FilOzone/synapse-sdk#142"
  evidence: string        // "Closes #142 in PR body"
  confidence: number      // 1.0 explicit, <1.0 semantic
}
```

Three built-in edge types for MVP (`references`, `closes`, `changes`). The `type` field is a string, not an enum — custom/namespaced types are welcome for future extensibility.

The `trace` command follows edges, not just vector similarity. Trace is conceptually separate from search — it's graph traversal over explicit edges with semantic fallback. It lives in `@wtfoc/search` for now but is an isolated submodule that can split later.

### 8. SDK policy

- Use `filecoin-pin` + `@filoz/synapse-sdk` directly for FOC storage operations
- Use `foc-cli` only for features filecoin-pin and synapse-sdk don't provide (e.g. testnet faucet)
- Use `filecoin-nova` for website crawling/ingestion
- Don't reinvent what the FOC ecosystem already ships

### 9. Format compatibility

All persisted data (manifests, segments) includes a `schemaVersion` field.

- **Manifests:** `schemaVersion: 1` for MVP. Readers must reject unknown schema versions with a clear error.
- **Segments:** `schemaVersion: 1` for MVP. Immutable once written — new schema versions produce new segments, old segments remain readable.
- **Migration policy:** New readers must support all prior schema versions. New writers always use the latest version. No in-place mutation of stored data.
- **Embedding metadata:** Segments record `embeddingModel` and `embeddingDimensions` so consumers know what produced the vectors.

### 10. Versioning

- All packages are `0.x` (experimental) during hackathon and early development
- Packages version **independently** — not in lockstep
- Follow SemVer: in `0.x`, minor bumps may break. Post-1.0, standard SemVer rules apply.
- **Breaking changes** include: interface signature changes in `@wtfoc/common`, manifest/segment schema changes, CLI flag removals, StorageResult shape changes

### 11. Error handling

- Use typed error classes extending `Error` with stable `code` field (e.g. `MANIFEST_CONFLICT`, `STORAGE_UNREACHABLE`, `EMBED_FAILED`)
- CLI maps error codes to exit codes: 0 = success, 1 = general error, 2 = usage error, 3 = storage error, 4 = conflict
- Consumers must never parse human-readable error messages — use `error.code` for programmatic handling
- All errors include enough context to debug without reproducing (artifact ID, operation attempted, backend type)

### 12. Logging and output

- **stderr** for logs, **stdout** for data (CLI)
- Structured logger interface: `debug`, `info`, `warn`, `error`
- CLI modes: default (human-readable), `--json` (machine-readable), `--quiet` (errors only)
- **Never log secrets, tokens, wallet keys, or PII**
- Telemetry: off by default, absent for MVP

### 13. Config precedence

`CLI flag > environment variable > config file > default`

- Config file: `~/.wtfoc/config.json` (global) or `.wtfoc/config.json` (project-local)
- Env vars: `WTFOC_STORAGE`, `WTFOC_NETWORK`, `WTFOC_PRIVATE_KEY`, etc.
- Project state: `~/.wtfoc/projects/<name>.json`

### 14. Security and privacy

- **Never commit secrets** to the repo — wallet keys, API tokens, bot tokens
- **Redact before upload** — source adapters must strip tokens, credentials, and configurable PII patterns before chunking
- **Immutable storage warning** — data stored on FOC/IPFS is permanent and public. Users must be warned before first upload.
- **Fixtures must be synthetic** — no real Slack exports, customer data, or private repo content in the test fixtures
- `.env.example` documents all env vars without real values

### 15. API style

- **ESM only** — `"type": "module"` in all packages. No dual CJS/ESM publish for MVP.
- **No default exports** — named exports only for tree-shaking and clarity
- **Async cancellation** — long-running operations accept `AbortSignal`
- **No `any`** — use `unknown` and narrow

## Package Architecture

### Hackathon scope (5 packages)

| Package | Purpose | Standalone use case | Hard deps |
|---------|---------|-------------------|-----------|
| `@wtfoc/common` | Pure contracts, schemas, serialization helpers. **No I/O, no SDK wrappers, no business logic.** | Type-only dependency | none |
| `@wtfoc/store` | Blob storage + manifest management (pragmatic grouping of two seams for hackathon) | "I want simple put/get with optional CIDs" | `common` |
| `@wtfoc/ingest` | Source adapters + chunking + edge extraction | "I want to archive my Slack/GitHub" | `common`, peer: `store` |
| `@wtfoc/search` | Embedder + vector index + query + trace (trace is isolated submodule) | "I have data, I want to search/trace it" | `common`, peer: `store` |
| `@wtfoc/cli` | CLI composing all packages | Full experience | `common`, `store`, `ingest`, `search` |

### Deferred (post-hackathon)

| Package | Purpose | When to scaffold |
|---------|---------|-----------------|
| `@wtfoc/memory` | Agent memory snapshot/restore | When core data model is stable |
| `@wtfoc/mcp` | MCP server exposing tools to agents | When CLI is solid |

### `@wtfoc/common` scoping rule

`common` contains **only**:
- TypeScript interfaces (all seam contracts)
- Schema types (manifest, segment, edge, chunk)
- Serialization/deserialization helpers
- Stable error classes and codes
- Constants and enums

**NOT in common:** I/O operations, SDK wrappers, source adapters, business logic, CLI code, network calls.

## Demo Scope (Hackathon MVP)

The demo tells this story:

> "A customer complains in Slack. Someone files an issue. Someone else fixes it in a PR.
> These connections live in people's heads. wtfoc makes them searchable and verifiable."

### What we ship:
- `wtfoc trace "upload failures"` — evidence-backed cross-source trace
- `wtfoc query "how does auth work?"` — semantic search with artifact citations
- `wtfoc verify <id>` — tamper-evidence proof (when backend supports it)
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

## Development Discipline

### Spec-first development (NON-NEGOTIABLE)

Every change requires a spec. No implementation without a ratified specification.

1. Write spec (`/speckit.specify`)
2. Clarify ambiguities (`/speckit.clarify`)
3. **Cross-review by a different agent** — if Claude wrote the spec, Cursor or Codex must review it before ratification
4. Plan implementation (`/speckit.plan`)
5. Generate tasks (`/speckit.tasks`)
6. Implement (`/speckit.implement`)

### Atomic commits

Each commit is a discrete, isolated change. One logical thing per commit.
- Setting up tooling is not the same commit as scaffolding packages
- Scaffolding one package is separate from scaffolding another
- Each commit should produce a working state — no broken intermediate states

### Tests

- All changes must have tests
- Tests test **behavior**, not implementation — if the implementation changes but behavior stays the same, tests should still pass
- Unit tests use local/in-memory backends — no network calls
- Golden fixtures in `fixtures/` for integration tests

### CI gates

- All code changes are gated by CI checks
- PRs must pass: tests, biome, build
- No merging with red CI

## Technical Decisions

- **Language:** TypeScript strict mode
- **Monorepo:** pnpm workspaces with TypeScript project references
- **Module format:** ESM only (`"type": "module"`)
- **Formatting:** Biome
- **Embeddings:** transformers.js with Xenova/all-MiniLM-L6-v2 (384d, local, no API key)
- **Vector search:** Brute-force cosine similarity (demo scale)
- **Network:** Calibration testnet for demo (data may be reset — not archival)
- **Node:** >=18
- **License:** MIT OR Apache-2.0 (dual license)
