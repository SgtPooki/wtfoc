# AGENTS.md — wtfoc

Instructions for AI agents working on this codebase.

**Read these first, in order:**
1. [`SPEC.md`](SPEC.md) — foundational rules (invariants that apply to everything)
2. [`.specify/memory/constitution.md`](.specify/memory/constitution.md) — governance and development discipline
3. Feature specs in `.specify/specs/` — what you're actually building

## Project Overview

**wtfoc** ("What The FOC") is a decentralized knowledge tracing and recall tool built on FOC (Filecoin Onchain Cloud). It ingests knowledge from multiple sources (Slack, GitHub, docs, code), extracts relationship edges, stores everything on verifiable decentralized storage, and traces evidence-backed connections across sources.

## Repository Structure

```
wtfoc/
├── SPEC.md              # Foundational rules — project-wide invariants
├── AGENTS.md            # You are here
├── README.md            # Project overview for humans
├── LICENSE              # MIT
├── SECURITY.md          # Vulnerability reporting + immutable storage warnings
├── .specify/
│   ├── memory/
│   │   └── constitution.md  # Governance, development discipline
│   ├── specs/               # Feature specs (spec-kit driven)
│   │   └── 001-store-backend/
│   │       └── spec.md      # First feature spec
│   └── templates/           # Spec-kit templates
├── .claude/commands/        # Spec-kit slash commands
├── packages/
│   ├── common/          # @wtfoc/common — pure contracts, schemas, types
│   ├── store/           # @wtfoc/store — blob storage + manifest management
│   ├── ingest/          # @wtfoc/ingest — source adapters + chunking + edges
│   ├── search/          # @wtfoc/search — embedder + vector index + query + trace
│   └── cli/             # @wtfoc/cli — CLI composing all packages
├── fixtures/            # Golden demo dataset (synthetic only)
└── .githooks/           # Git hooks (strip co-author lines)
```

## How to Work on This Project (NON-NEGOTIABLE)

Every change follows the spec-kit flow. No exceptions.

1. **`/speckit.specify`** — write a spec for the change
2. **`/speckit.clarify`** — resolve ambiguities
3. **Cross-review** — spec reviewed by a different agent (Cursor or Codex) before ratification
4. **`/speckit.plan`** — create implementation plan from ratified spec
5. **`/speckit.tasks`** — generate task breakdown
6. **`/speckit.implement`** — execute implementation

Do not skip steps. Do not "write the spec later." The spec is the shared source of truth.

## Core Architecture Invariants

These are restated from SPEC.md so you don't have to dig through external docs.

1. **Every seam is an interface** in `@wtfoc/common`. Six seams: Embedder, VectorIndex, StorageBackend, SourceAdapter, ManifestStore, EdgeExtractor.
2. **Storage results are backend-neutral.** `StorageResult.id` is always present. `ipfsCid` and `pieceCid` are optional.
3. **Manifests and segments have `schemaVersion`.** Readers reject unknown versions. Writers always use latest.
4. **Single writer per project.** Concurrent updates rejected via `prevHeadId` mismatch.
5. **Ingest order:** chunks → embed → extract edges → bundle segment → upload → verify → update head → update local pointer.
6. **Trace ≠ search.** Trace follows explicit edges. Search finds semantically similar chunks. Trace falls back to search when no edges exist.
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
- Long-running operations accept `AbortSignal` for cancellation

## Commit Style

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Scope with package name: `feat(store): add FOC upload support`
- Keep commits atomic — one logical change per commit
- Link issues: `Fixes #n` or `Refs #n`
- Each commit must produce a working state

## Definition of Done (for PRs)

- [ ] Spec exists and is ratified (cross-reviewed)
- [ ] Tests pass (`pnpm -r test`)
- [ ] Tests test behavior, not implementation
- [ ] Biome passes (`pnpm biome check .`)
- [ ] Package builds (`pnpm -r build`)
- [ ] Public API changes: update SPEC.md
- [ ] No secrets, PII, or real customer data
- [ ] README updated if user-visible behavior changes

## Error Handling

- Typed error classes from `@wtfoc/common` with stable `code` field
- Error codes: `MANIFEST_CONFLICT`, `STORAGE_UNREACHABLE`, `EMBED_FAILED`, `SCHEMA_UNKNOWN`, etc.
- CLI exit codes: 0 success, 1 general, 2 usage, 3 storage, 4 conflict
- Never throw raw strings — always use error classes

## Adding Dependencies

Before adding a dependency, check:
- [ ] Bundle size impact
- [ ] License compatibility (MIT, Apache-2.0, BSD — no GPL)
- [ ] Actively maintained?
- [ ] Native addons? (bad for portability)
- [ ] Belongs in `common` (only if pure schema/type helper) or leaf package?

## What NOT to Do

- Don't skip the spec-kit flow
- Don't add features not in a ratified spec
- Don't put I/O or business logic in `@wtfoc/common`
- Don't add GraphRAG, RAPTOR, ColBERT — future work
- Don't build a web dashboard — CLI only for MVP
- Don't over-abstract — three similar lines beats a premature abstraction
- Don't scaffold `@wtfoc/memory` or `@wtfoc/mcp` until core is stable

## Key Dependencies

```
@filoz/synapse-sdk       — FOC storage (upload/download/datasets)
filecoin-pin             — IPFS↔Filecoin bridge (CAR creation, dual CIDs)
@huggingface/transformers — local embeddings (MiniLM-L6-v2)
viem                     — wallet/chain interaction
commander                — CLI
```

## Links

- [SPEC.md](SPEC.md) — foundational rules
- [Constitution](.specify/memory/constitution.md) — governance
- [Feature specs](.specify/specs/) — spec-kit specs
- [Issue #1](https://github.com/SgtPooki/wtfoc/issues/1) — architecture history (6 review rounds)
- [Issue #2](https://github.com/SgtPooki/wtfoc/issues/2) — Slack webhook (future)
