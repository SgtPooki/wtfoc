# wtfoc — Specification

> What the FOC happened? Trace it.

Decentralized knowledge tracing and recall on FOC (Filecoin Onchain Cloud).

This document defines **project-wide invariants** — rules that apply to all features and all packages. Feature-specific specs and decisions are tracked in GitHub issues.

## Foundational Rules

### 1. Every package is standalone

Each package under `@wtfoc/*` must be independently useful. A user should be able to `npm install @wtfoc/store` without pulling in search, ingest, or the CLI.

- `@wtfoc/common` is a hard dependency of all other packages (shared types, interfaces, schemas)
- **Library packages** (`common`, `store`, `ingest`, `search`) use peer dependencies for cross-package references
- **Application packages** (`cli`, `mcp`) hard-depend on the library packages they compose — `npm install -g @wtfoc/cli` must pull a working CLI
- No circular dependencies between packages
- Each package has its own README, entry point, and tests

### 2. Credible exit at every seam

Every component is an interface. Users can swap, replace, or eject any part of the stack at any time. Lock-in is a bug, not a feature.

**Seams (all pluggable via interfaces in `@wtfoc/common`):**

| Seam | Interface | Built-in default | User can swap to |
|------|-----------|-----------------|-----------------|
| **Embedder** | `Embedder` | transformers.js (local, no API key) | OpenAI, Ollama, Cohere, vLLM, any embedding service |
| **VectorIndex** | `VectorIndex` | In-memory brute-force | Qdrant, Pinecone, Weaviate, Milvus, any vector DB |
| **StorageBackend** | `StorageBackend` | FOC (synapse-sdk + filecoin-pin) | Local filesystem, S3, GCS, IPFS-only, any blob store |
| **SourceAdapter** | `SourceAdapter` | Slack JSON, GitHub (gh CLI) | Jira, Discord, Linear, Confluence, any data source |
| **ManifestStore** | `ManifestStore` | FOC-backed head+segments | Local-only, S3-backed, any mutable index |
| **EdgeExtractor** | `EdgeExtractor` | Regex-based (refs, closes, changes) | LLM-based, AST-based, custom extractors |
| **ChunkScorer** | `ChunkScorer` | Keyword-based signal scorer | LLM-based, sentiment analysis, custom scorers |
| **Clusterer** | `Clusterer` | Greedy threshold-based (cosine >= 0.85) | HDBSCAN, k-means, spectral clustering |
| **Reranker** | `Reranker` | No reranker (vector order only) | Cohere, Jina, LLM-based, local cross-encoders |

**Interfaces at seams, concrete code elsewhere.** Only extract an interface at defined seams or when there are two real implementations.

### 3. FOC is the best default, not the only option

- Local storage mode (`--local`) works without a wallet or network — zero friction onboarding
- FOC is the default because content-addressable + verifiable + decentralized is genuinely better
- The architecture never assumes FOC — every storage call goes through the `StorageBackend` interface
- Users who don't know what FOC is should still find the tool useful

### 4. Backend-neutral artifact identity

Storage results use a backend-neutral `id` field. CIDs are optional verification metadata:

```typescript
interface StorageResult {
  id: string              // always present — opaque identifier from the backend
  ipfsCid?: string        // present when backend supports IPFS
  pieceCid?: string       // present when backend supports FOC
  proof?: string          // present when backend supports verification
}
```

### 5. Immutable data, mutable index

All persisted data includes `schemaVersion`. The mutable index uses the **manifest chain pattern**:
- **Head manifest** (tiny, mutable pointer): collection metadata, segment summaries, prevHeadId
- **Segment blobs** (immutable, write-once): batched chunks with embeddings + edges
- Upload segments first, verify, then publish head — never reference unverified data
- **Single writer per project** for MVP

### 6. Edges are first-class

Typed, evidence-backed connections extracted at ingest time. Three built-in types (`references`, `closes`, `changes`) with string `type` field for extensibility. Every edge includes `evidence` explaining why it exists.

### 7. Format compatibility

Manifests and segments include `schemaVersion`. Readers reject unknown versions. Writers use latest. Old segments remain readable. Segments record `embeddingModel` and `embeddingDimensions`.

### 8. SDK policy

- Use `filecoin-pin` + `@filoz/synapse-sdk` directly for FOC storage
- Use `foc-cli` only for features the SDKs don't provide (e.g. testnet faucet)
- Use `filecoin-nova` for website crawling
- Don't reinvent what the FOC ecosystem ships

### 9. Versioning

- All packages `0.x` (experimental) — release-please with `bump-minor-pre-major`
- Packages version independently
- **Breaking changes**: interface signatures in `@wtfoc/common`, manifest/segment schemas, CLI flag removals, StorageResult shape changes

### 10. Error handling

- Typed error classes with stable `code` field (e.g. `MANIFEST_CONFLICT`, `STORAGE_UNREACHABLE`)
- CLI exit codes: 0 success, 1 general, 2 usage, 3 storage, 4 conflict
- Never parse human-readable messages — use `error.code`

### 11. Logging and output

- **stderr** for logs, **stdout** for data
- CLI modes: default (human), `--json` (machine), `--quiet` (errors only)
- Never log secrets, tokens, wallet keys, or PII

### 12. Config precedence

`CLI flag > environment variable > config file > default`

### 13. Security and privacy

- Never commit secrets — use env vars
- Redact PII before upload — FOC/IPFS data is permanent and public
- Fixtures must be synthetic

### 14. API style

- ESM only, no default exports, `AbortSignal` for cancellation, no `any`

## Development Discipline

### Issue-first development (NON-NEGOTIABLE)

Every non-trivial change has a GitHub issue. The issue is the spec; its acceptance criteria are the contract.

1. Open a GitHub issue capturing the problem, scope, and acceptance criteria
2. Cross-review non-obvious designs with a second agent (Codex, Cursor, or another reviewer) before implementing
3. Implement against the acceptance criteria; commit with `fixes #N` in the message body
4. Audit with `/grill` or `/code-reviewer` before pushing for anything non-trivial

### Atomic commits

Each commit is a discrete, isolated change. One logical thing per commit. Each commit produces a working state.

### Behavioral tests

All changes must have tests. Tests test **behavior**, not implementation. Unit tests use local/in-memory backends — no network calls.

### CI gates

All code changes gated by CI. No merging with red CI.

## Package Architecture

| Package | Purpose | Standalone use case | Hard deps |
|---------|---------|-------------------|-----------|
| `@wtfoc/common` | Pure contracts, schemas, error classes. **No I/O, no business logic.** | Type-only dependency | none |
| `@wtfoc/store` | Blob storage + manifest management | "I want simple put/get with optional CIDs" | `common` |
| `@wtfoc/ingest` | Source adapters + chunking + edge extraction | "I want to archive my Slack/GitHub" | `common`, peer: `store` |
| `@wtfoc/search` | Embedder + vector index + query + trace | "I have data, I want to search/trace it" | `common`, peer: `store` |
| `@wtfoc/cli` | CLI composing all packages | Full experience | `common`, `store`, `ingest`, `search` |

Deferred: `@wtfoc/memory` (agent memory), `@wtfoc/mcp` (MCP server) — scaffold when core is stable.

## Technical Stack

- TypeScript strict mode, ESM only
- pnpm workspaces + TypeScript project references
- Biome for formatting/linting
- release-please for versioning
- Node >=24
- MIT license

## Feature Specs

Feature specs live in GitHub issues. Historical planning artifacts are preserved in git history.

See also: [Issue #1](https://github.com/SgtPooki/wtfoc/issues/1) (architecture history), [Issue #2](https://github.com/SgtPooki/wtfoc/issues/2) (Slack webhook — future)
