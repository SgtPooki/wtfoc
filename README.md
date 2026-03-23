# wtfoc

> What the FOC happened? Trace it.

**Decentralized knowledge tracing and recall on [FOC](https://docs.filecoin.cloud) (Filecoin Onchain Cloud).**

wtfoc ingests knowledge from multiple sources (Slack, GitHub, docs, code), extracts relationship edges, stores everything on verifiable decentralized storage, and traces evidence-backed connections across sources.

## The Problem

A customer complains in Slack. Someone files an issue. Someone else fixes it in a PR. These connections live in people's heads. When someone leaves, so does the context.

## The Solution

```bash
# Ingest your sources (source adapters are pluggable)
wtfoc ingest slack ./exports/foc-support.json --collection team-intel
wtfoc ingest github FilOzone/synapse-sdk --collection team-intel

# Trace incidents across all sources
wtfoc trace "upload failures" --collection team-intel
```

One query surfaces the Slack complaint, the GitHub issue, the PR that fixed it, and the code that changed — all with verifiable content-addressed citations.

## FOC for RAG

The right way to position FOC in `wtfoc` is as the immutable system of record for a knowledge base, not as the online query engine. In practice that means storing canonical source snapshots and segment snapshots on FOC so the same collection can be verified, rehydrated, and re-queried later, while embedders and vector indices stay swappable.

Storing only embeddings on FOC is not enough: it weakens provenance, makes re-embedding harder when models change, and gives a poor CID story because a consumer cannot recover the evidence behind a result. The recommended storage layout and CID reuse story are documented in [docs/foc-rag-storage.md](docs/foc-rag-storage.md).

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@wtfoc/common`](packages/common/) | Shared types, interfaces, schemas | `npm i @wtfoc/common` |
| [`@wtfoc/store`](packages/store/) | Storage backends (local, FOC) + manifest management | `npm i @wtfoc/store` |
| [`@wtfoc/ingest`](packages/ingest/) | Source adapters + chunking + edge extraction | `npm i @wtfoc/ingest` |
| [`@wtfoc/search`](packages/search/) | Embedder + vector index + query + trace | `npm i @wtfoc/search` |
| [`@wtfoc/cli`](packages/cli/) | CLI wrapping all packages | `npm i -g @wtfoc/cli` |

Every package is standalone. Use only what you need.

## Pluggable at Every Seam

wtfoc is built on interfaces, not implementations. Swap any component:

- **Embedder** — transformers.js (default, local) → OpenAI, Ollama, Cohere, vLLM
- **Vector Index** — in-memory (default) → Qdrant, Pinecone, Weaviate
- **Storage** — FOC (default) → local filesystem, S3, GCS, IPFS-only
- **Sources** — Slack JSON, GitHub (default) → Jira, Discord, Linear, any data source
- **Edge Extraction** — regex (default) → LLM-based, AST-based, custom

BYO RAG index: plug in your existing Qdrant collection and use `wtfoc trace` on top of it.

See [SPEC.md](SPEC.md) for the full architecture.

## Development

```bash
# Prerequisites
node >= 24, pnpm

# Setup
pnpm install
pnpm -r build

# Test
pnpm -r test

# Lint
pnpm biome check .
```

### Spec-Driven Development

This project uses [spec-kit](https://github.com/github/spec-kit) for spec-driven development. Every change requires a spec, cross-reviewed by a different AI agent before implementation.

```
/speckit.constitution  → establish project principles
/speckit.specify       → create specifications
/speckit.clarify       → clarify and de-risk (before /plan)
/speckit.plan          → create implementation plans
/speckit.checklist     → generate quality checklists (optional)
/speckit.tasks         → generate actionable tasks
/speckit.analyze       → validate alignment & surface inconsistencies (optional)
/speckit.implement     → execute implementation
/speckit.taskstoissues → convert tasks to GitHub issues (optional)
```

Feature specs: [`.specify/specs/`](.specify/specs/)
Constitution: [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
Project rules: [SPEC.md](SPEC.md)
Agent instructions: [AGENTS.md](AGENTS.md)

## Architecture

See [SPEC.md](SPEC.md) for foundational rules and [Issue #1](https://github.com/SgtPooki/wtfoc/issues/1) for the full architecture discussion (6 review rounds with Cursor + Codex).

## License

[MIT](LICENSE)
