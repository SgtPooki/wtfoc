# AGENTS.md — wtfoc

Instructions for AI agents working on this codebase. Read `SPEC.md` first — it defines the foundational rules.

## Project Overview

**wtfoc** ("What The FOC") is a decentralized knowledge tracing and recall tool built on FOC (Filecoin Onchain Cloud). It ingests knowledge from multiple sources (Slack, GitHub, docs, code), extracts relationship edges, stores everything on verifiable decentralized storage, and traces evidence-backed connections across sources.

## Repository Structure

```
wtfoc/
├── SPEC.md              # Foundational rules — READ THIS FIRST
├── AGENTS.md            # You are here
├── LICENSE
├── packages/
│   ├── common/          # @wtfoc/common — pure contracts, schemas, types
│   ├── store/           # @wtfoc/store — blob storage + manifest management
│   ├── ingest/          # @wtfoc/ingest — source adapters + chunking + edges
│   ├── search/          # @wtfoc/search — embedder + vector index + query + trace
│   └── cli/             # @wtfoc/cli — CLI composing all packages
├── fixtures/            # Golden demo dataset (synthetic only)
└── .githooks/           # Git hooks (strip co-author lines)
```

## Core Architecture Invariants

These are restated from SPEC.md so you don't have to dig through issue threads.

1. **Every seam is an interface** in `@wtfoc/common`. Six seams: Embedder, VectorIndex, StorageBackend, SourceAdapter, ManifestStore, EdgeExtractor.
2. **Storage results are backend-neutral.** `StorageResult.id` is always present. `ipfsCid` and `pieceCid` are optional — only populated when the backend supports them.
3. **Manifests and segments have `schemaVersion`.** Readers reject unknown versions. Writers always use latest. Old segments remain readable.
4. **Single writer per project.** Concurrent updates rejected via `prevHeadCid` mismatch.
5. **Ingest order:** chunks first → embed → extract edges → bundle segment → upload segment → verify → update head manifest → update local pointer.
6. **Trace ≠ search.** Trace follows explicit edges across source types. Search finds semantically similar chunks. Trace falls back to search when no edges exist.
7. **`@wtfoc/common` is contracts only.** No I/O, no SDK wrappers, no business logic.

## Developer Workflow

### Bootstrap
```bash
pnpm install                          # install all deps
pnpm -r build                        # build all packages (common first)
pnpm --filter @wtfoc/store build     # build one package
```

### Test
```bash
pnpm -r test                         # run all tests
pnpm --filter @wtfoc/search test     # test one package
```

- Unit tests use local/in-memory backends — **no network calls**
- Golden fixtures in `fixtures/` for integration tests
- Test interfaces, not implementations

### Lint & Format
```bash
pnpm biome check .                   # lint + format check
pnpm biome check . --fix             # auto-fix
```

### Build Order
`common` → `store` → `ingest` / `search` (parallel) → `cli`

TypeScript project references handle this automatically.

## Code Style

- TypeScript strict mode
- Biome for formatting and linting
- **No `any`** — use `unknown` and narrow
- **No default exports** — named exports only
- **ESM only** — `"type": "module"` in all packages
- Prefer interfaces over type aliases for public API shapes
- Export types from `@wtfoc/common`, import everywhere else
- Long-running operations accept `AbortSignal` for cancellation

## Package Boundaries

- **Library packages** (`common`, `store`, `ingest`, `search`): peer deps for cross-package refs
- **Application packages** (`cli`): hard deps on libraries they compose
- `@wtfoc/common` is the only allowed hard dependency for library packages
- No circular dependencies — if you need one, the abstraction is wrong

## Commit Style

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Scope with package name: `feat(store): add FOC upload support`
- Keep commits atomic — one logical change per commit
- Link issues: `Fixes #n` or `Refs #n`

## Definition of Done (for PRs)

- [ ] Tests pass (`pnpm -r test`)
- [ ] Biome passes (`pnpm biome check .`)
- [ ] Package builds (`pnpm -r build`)
- [ ] Public API changes: update SPEC.md if interface shapes change
- [ ] New seam implementations: test against the interface, not the implementation
- [ ] No secrets, PII, or real customer data in fixtures
- [ ] README updated if user-visible behavior changes

## Error Handling

- Typed error classes from `@wtfoc/common` with stable `code` field
- Error codes: `MANIFEST_CONFLICT`, `STORAGE_UNREACHABLE`, `EMBED_FAILED`, `EDGE_EXTRACT_FAILED`, `SCHEMA_UNKNOWN`, etc.
- CLI exit codes: 0 = success, 1 = general, 2 = usage, 3 = storage, 4 = conflict
- Include enough context to debug: artifact ID, operation, backend type
- Never throw raw strings — always use error classes

## Logging

- `stderr` for logs, `stdout` for data
- CLI: default human-readable, `--json` for machine, `--quiet` for errors only
- **Never log secrets, tokens, wallet keys, or PII**

## FOC/Storage Rules

- Use `filecoin-pin` + `@filoz/synapse-sdk` for FOC operations
- Never hardcode CIDs, chain IDs, or wallet keys
- Support `--local` mode everywhere — must work without any FOC setup
- Upload segments first, verify they resolve, then update head manifest
- Testnet (Calibration) data may be reset — not archival. Warn users.

## Edge Extraction Rules

- Edge `type` is a string, not an enum — built-in: `references`, `closes`, `changes`
- Always include `evidence` field explaining why the edge exists
- `confidence: 1.0` for explicit edges (regex-extracted), `< 1.0` for semantic
- Repo-scope all identifiers: `FilOzone/synapse-sdk#142`, not just `#142`
- Custom edge types welcome: `myapp:depends-on`, `myapp:blocks`, etc.

## Adding Dependencies

Before adding a dependency, check:
- [ ] Bundle size impact (check with `npx package-size`)
- [ ] License compatibility (MIT, Apache-2.0, BSD — no GPL for MIT-licensed project)
- [ ] Is it actively maintained?
- [ ] Does it require native addons? (bad for portability)
- [ ] Does it belong in `common` (only if it's a pure schema/type helper) or a leaf package?

## What NOT to Do

- Don't add GraphRAG, RAPTOR, ColBERT, or advanced retrieval — future work
- Don't build a web dashboard — CLI only for MVP
- Don't add PDF parsing — markdown and plain text only
- Don't over-abstract — three similar lines beats a premature abstraction
- Don't add features not in SPEC.md without discussion
- Don't scaffold `@wtfoc/memory` or `@wtfoc/mcp` until core is stable
- Don't put I/O or business logic in `@wtfoc/common`

## Key Dependencies

```
@filoz/synapse-sdk       — FOC storage (upload/download/datasets)
filecoin-pin             — IPFS↔Filecoin bridge (CAR creation, dual CIDs)
@huggingface/transformers — local embeddings (MiniLM-L6-v2)
viem                     — wallet/chain interaction
commander                — CLI
```

## Demo Priority

If time is tight, ship in this order:
1. FOC upload/download (`@wtfoc/store`)
2. Chunking + edge extraction (`@wtfoc/ingest`)
3. Trace command (`@wtfoc/search` + `@wtfoc/cli`)
4. Verify command
5. Everything else is stretch
