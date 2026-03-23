# AGENTS.md — wtfoc

Instructions for AI agents working on this codebase.

## Project Overview

**wtfoc** ("What The FOC") is a decentralized knowledge tracing and recall tool built on FOC (Filecoin Onchain Cloud). It ingests knowledge from multiple sources (Slack, GitHub, docs, code), extracts relationship edges, stores everything on verifiable decentralized storage, and traces evidence-backed connections across sources.

Read `SPEC.md` for foundational rules and architecture.

## Repository Structure

```
wtfoc/
├── SPEC.md              # Foundational rules — read this first
├── AGENTS.md            # You are here
├── packages/
│   ├── common/          # @wtfoc/common — shared types + interfaces
│   ├── store/           # @wtfoc/store — FOC storage abstraction
│   ├── ingest/          # @wtfoc/ingest — source adapters + chunking + edges
│   ├── search/          # @wtfoc/search — embedder + vector index + trace
│   ├── memory/          # @wtfoc/memory — agent memory (stretch)
│   ├── cli/             # @wtfoc/cli — CLI
│   └── mcp/             # @wtfoc/mcp — MCP server (stretch)
├── fixtures/            # Golden demo dataset
└── .githooks/           # Git hooks (strip co-author lines)
```

## Rules for Agents

### Code Style
- TypeScript strict mode
- Biome for formatting and linting
- No `any` types — use `unknown` and narrow
- Prefer interfaces over type aliases for public API shapes
- Export types from `@wtfoc/common`, import everywhere else

### Package Boundaries
- Each package must work standalone — test it in isolation
- `@wtfoc/common` is the only allowed hard dependency between packages
- Other cross-package references use peer dependencies
- No circular dependencies — if you find yourself needing one, the abstraction is wrong

### Commit Style
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Scope with package name: `feat(store): add FOC upload support`
- Keep commits atomic — one logical change per commit

### Testing
- Each package has its own test suite
- Use local/in-memory backends for unit tests — no network calls
- Golden test fixtures in `fixtures/` for integration tests
- Test the interfaces, not the implementations

### FOC/Storage
- Always use `filecoin-pin` + `@filoz/synapse-sdk` for FOC operations
- Never hardcode CIDs, chain IDs, or wallet keys
- Support `--local` mode everywhere — local filesystem backend must work without any FOC setup
- Upload segments first, verify they resolve, then update head manifest

### Edge Extraction
- Edges are typed: `references`, `closes`, `changes`
- Always include `evidence` field explaining why the edge exists
- Use `confidence: 1.0` for explicit edges (regex-extracted), `< 1.0` for semantic
- Repo-scope all identifiers: `FilOzone/synapse-sdk#142`, not just `#142`

### What NOT to Do
- Don't add GraphRAG, RAPTOR, ColBERT, or advanced retrieval — that's future work
- Don't build a web dashboard — CLI and MCP only
- Don't add PDF parsing — markdown and plain text only for MVP
- Don't over-abstract — three similar lines of code beats a premature abstraction
- Don't add features not in SPEC.md without discussion

## Architecture Reference

See issue #1 on this repo for full architecture discussion with 6 review rounds (3 Cursor + 3 Codex): https://github.com/SgtPooki/wtfoc/issues/1

## Key Dependencies

```
@filoz/synapse-sdk — FOC storage (upload/download/datasets)
filecoin-pin       — IPFS↔Filecoin bridge (CAR creation, dual CIDs)
@huggingface/transformers — local embeddings (MiniLM-L6-v2)
@modelcontextprotocol/sdk — MCP server (stretch)
viem               — wallet/chain interaction
commander          — CLI
```

## Demo Priority

If time is tight, ship in this order:
1. FOC upload/download (`@wtfoc/store`)
2. Chunking + edge extraction (`@wtfoc/ingest`)
3. Trace command (`@wtfoc/search` + `@wtfoc/cli`)
4. Verify command
5. Everything else is stretch
