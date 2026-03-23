# wtfoc Constitution

## Core Principles

### I. Credible Exit at Every Seam

Every major component is an interface. Users can swap, replace, or eject any part of the stack at any time. Lock-in is a bug, not a feature.

Six defined seams: Embedder, VectorIndex, StorageBackend, SourceAdapter, ManifestStore, EdgeExtractor. All interfaces live in `@wtfoc/common`. Built-in implementations are defaults — never requirements.

### II. Standalone Packages

Each `@wtfoc/*` package is independently useful. Library packages use peer deps for cross-package refs. Application packages (`cli`) hard-depend on what they compose. `@wtfoc/common` is contracts only — no I/O, no business logic.

Five packages for hackathon: `common`, `store`, `ingest`, `search`, `cli`. Memory and MCP are deferred until core is stable.

### III. Backend-Neutral Identity

Storage results use `id` (always present) with optional `ipfsCid?` and `pieceCid?`. Not every backend can produce CIDs. The public API never assumes FOC — it's the best default, not a requirement.

### IV. Immutable Data, Mutable Index

All persisted data (manifests, segments) includes `schemaVersion`. Readers reject unknown versions. Writers use latest. Old segments remain readable forever. Single writer per project for MVP.

### V. Edges Are First-Class

Cross-source connections are explicit typed edges, not just semantic similarity. Three built-in types (`references`, `closes`, `changes`) with string-typed `type` field for extensibility. Every edge includes `evidence` explaining why it exists.

### VI. Test-First

Tests written before implementation where practical. Unit tests use local/in-memory backends — no network calls. Golden fixtures for integration tests. Test interfaces, not implementations.

### VII. Hackathon-First, Future-Aware

Ship the demo, but make it worth extending. Every decision optimizes for: (1) working demo that tells a story, (2) clean architecture showing what's possible, (3) code quality that doesn't embarrass us.

## Technical Constraints

- **TypeScript strict mode**, ESM only, no default exports
- **pnpm workspaces** with TypeScript project references
- **Biome** for formatting and linting
- **No `any`** — use `unknown` and narrow
- **AbortSignal on all async interfaces** — every long-running operation accepts `signal?: AbortSignal` for proper cancellation
- **Conventional commits** scoped by package: `feat(store): add FOC upload`
- **SemVer 0.x** — all packages experimental, `bump-minor-pre-major` via release-please
- **Node >=18**

## Security

- Never commit secrets (wallet keys, API tokens)
- Redact PII before upload — data on FOC/IPFS is permanent and public
- Fixtures must be synthetic — no real customer data
- `--local` mode requires no wallet or network

## SDK Policy

- Use `filecoin-pin` + `@filoz/synapse-sdk` for FOC storage
- Use `foc-cli` only for features the SDKs don't provide
- Use `filecoin-nova` for website crawling
- Don't reinvent what the FOC ecosystem ships

## Development Discipline

### Spec-First Development (NON-NEGOTIABLE)

Every change requires a spec. No implementation without a ratified specification.

**Flow:**
1. `/speckit.specify` — write the spec for the change
2. `/speckit.clarify` — resolve ambiguities
3. **Cross-review** — spec must be reviewed by a different agent (Cursor or Codex) before ratification. If Claude wrote the spec, Cursor or Codex reviews it. If Codex wrote it, Cursor or Claude reviews it.
4. `/speckit.plan` — create implementation plan from ratified spec
5. `/speckit.tasks` — generate task breakdown
6. `/speckit.implement` — execute implementation

No skipping steps. No "I'll write the spec later." The spec is the shared source of truth that prevents wasted work.

### Atomic Commits
Each commit is a discrete, isolated change. One logical thing per commit.
- Setting up tooling ≠ scaffolding packages
- Scaffolding one package ≠ scaffolding another
- Each commit should work by itself — no broken intermediate states

### Tests
- All changes must have tests
- Tests test **behavior**, not implementation — if the implementation changes but behavior doesn't, tests should still pass
- Unit tests use local/in-memory backends — no network calls
- Golden fixtures for integration tests

### CI Gates
- All code changes are gated by CI checks
- PRs must pass: tests, biome, build
- No merging with red CI

## Governance

- This constitution and `SPEC.md` are the source of truth
- Changes to interfaces in `@wtfoc/common` require SPEC.md update
- Features not in SPEC.md require discussion before implementation

**Version**: 1.1.0 | **Ratified**: 2026-03-23 | **Last Amended**: 2026-03-23
