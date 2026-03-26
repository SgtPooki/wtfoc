# wtfoc Constitution

## Core Principles

### I. Credible Exit at Every Seam

Every major component is an interface. Users can swap, replace, or eject any part of the stack at any time. Lock-in is a bug, not a feature.

Six defined seams: Embedder, VectorIndex, StorageBackend, SourceAdapter, ManifestStore, EdgeExtractor. All interfaces live in `@wtfoc/common`. Built-in implementations are defaults — never requirements.

### II. Standalone Packages

Each `@wtfoc/*` package is independently useful. Library packages use peer deps for cross-package refs. Application packages (`cli`, `mcp-server`) hard-depend on what they compose. `@wtfoc/common` is contracts only — no I/O, no business logic.

### III. Backend-Neutral Identity

Storage results use `id` (always present) with optional `ipfsCid?` and `pieceCid?`. Not every backend can produce CIDs. The public API never assumes FOC — it's the best default, not a requirement.

### IV. Immutable Data, Mutable Index

All persisted data (manifests, segments) includes `schemaVersion`. Readers reject unknown versions. Writers use latest. Old segments remain readable forever. Single writer per project for MVP.

### V. Edges Are First-Class

Cross-source connections are explicit typed edges, not just semantic similarity. Built-in types (`references`, `closes`, `changes`, `imports`) with string-typed `type` field for extensibility. LLM extractors add semantic types (`implements`, `depends-on`, `part-of`, etc.). Every edge includes `evidence` explaining why it exists.

The edge pipeline is: `ingest` (regex/heuristic/code edges) → `extract-edges` (LLM semantic edges) → `materialize-edges` (bake into segments) → `promote` (upload to FOC). Edges accumulate — each stage adds, never removes.

### V-b. Knowledge Graphs Are Shareable and Improvable

Collections are collaborative artifacts. Any agent — AI or human — can fetch a collection, improve it (add sources, extract better edges, re-chunk), and publish a new version. The manifest chain provides an audit trail of who contributed what.

Extraction metadata (which model, which contexts, what confidence) should travel with the collection so downstream consumers can make informed decisions about re-extraction. A collection promoted to FOC is not "done" — it's a starting point that others can build on.

### VI. Test-First

Tests written before implementation where practical. Unit tests use local/in-memory backends — no network calls. Golden fixtures for integration tests. Test interfaces, not implementations.

### VII. Bundle Uploads — Never Spam Small Pieces

**NON-NEGOTIABLE.** Never upload individual chunks or small segments as separate FOC pieces. Always bundle into a single CAR file per ingest batch. Each `wtfoc ingest` command produces at most ONE PieceCID on-chain.

Why: Each piece costs the SP gas for PDP proofs. Uploading thousands of small pieces is expensive and makes us a bad ecosystem citizen. Bundle into CAR, upload once, track internal CIDs in the manifest.

### VIII. Ship-First, Future-Aware

Ship working software, but make it worth extending. Every decision optimizes for: (1) working product that tells a story, (2) clean architecture showing what's possible, (3) code quality that doesn't embarrass us.

## Technical Constraints

- **TypeScript strict mode**, ESM only, no default exports
- **pnpm workspaces** with TypeScript project references
- **Biome** for formatting and linting
- **No `any`** — use `unknown` and narrow
- **No `as unknown as`** — if you need a double cast, the types are wrong. Fix the types.
- **No non-null assertions (`!`)** — check the value exists, throw a descriptive error if it doesn't. `if (!x) throw new Error(...)` not `x!`
- **Named, documented errors only** — never `throw new Error("something broke")`. Use typed error classes from `@wtfoc/common` (e.g. `StorageNotFoundError`, `EmbedFailedError`) with stable `code` fields. Every error must be traceable: include the operation attempted, the artifact ID, and the backend/component that failed. Consumers should be able to programmatically handle errors via `error.code` without parsing messages.
- **AbortSignal on all async interfaces** — every long-running operation accepts `signal?: AbortSignal` for proper cancellation
- **Self-documenting code over comments** — code should be readable without comments. Use comments only when the *why* isn't obvious from the code itself. Don't add comments that restate what the code does. Don't add JSDoc that just restates the function signature or parameter types. Don't add comments to code you didn't change. Three well-named variables beat one variable with a comment.
- **Conventional commits** scoped by package: `feat(store): add FOC upload`
- **SemVer 0.x** — all packages experimental, `bump-minor-pre-major` via release-please
- **Node >=24**

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
1. `/speckit.specify` — create the specification
2. `/speckit.clarify` — clarify and de-risk (run before /plan)
3. **Cross-review** — run `/peer-review` to get the spec reviewed by a different agent (Cursor or Codex) before ratification. Address all feedback.
4. `/speckit.plan` — create implementation plan
5. `/speckit.checklist` — generate quality checklists (optional)
6. `/speckit.tasks` — generate actionable tasks
7. `/speckit.analyze` — validate alignment & surface inconsistencies (optional)
8. `/speckit.implement` — execute implementation
9. `/speckit.taskstoissues` — convert tasks to GitHub issues (optional)

See also: `/speckit.constitution` — update project principles

No skipping steps. No "I'll write the spec later." The spec is the shared source of truth that prevents wasted work.

### Atomic Commits
Each commit is a discrete, isolated change. One logical thing per commit.
- Setting up tooling ≠ scaffolding packages
- Scaffolding one package ≠ scaffolding another
- Each commit should work by itself — no broken intermediate states

### Tests
- All changes must have tests
- Tests test **behavior**, not implementation — if the implementation changes but behavior doesn't, tests should still pass
- **vitest** runs TypeScript test files directly — no build step before testing
- `pnpm test` from root runs all tests across all packages
- Unit tests use local/in-memory backends — no network calls
- Golden fixtures for integration tests

### Monorepo Script Conventions (NON-NEGOTIABLE)
- **All npm scripts must work from both the package directory AND the root**
- `pnpm test` from root runs all tests. `pnpm --filter @wtfoc/store test` runs one package.
- **Package-level test scripts must NOT reference parent directories** (no `../..`, no `--dir ../..`)
- **Package-level test scripts must NOT reference the root vitest config** — the root config handles discovery
- **Standard package test script**: `"test": "vitest run"` — vitest auto-discovers `.test.ts` files in the package
- **Do NOT change test commands to use `node --test`** — we use vitest, not the Node test runner
- **Do NOT modify package.json scripts without explicit approval** — script changes affect all developers and CI

### CI Gates
- All code changes are gated by CI checks
- PRs must pass: tests, biome, build
- No merging with red CI

## Parallel Agent Coordination

This project uses multiple AI agents (Claude, Cursor, Codex) working in parallel. Coordination happens via GitHub issues, labels, and isolated git worktrees.

### Labels

| Label | Meaning | Who applies it |
|-------|---------|---------------|
| `spec` | Issue tracks a specification (not implementation) | `dispatch.sh spec` |
| `implementation` | Issue tracks implementation work | `dispatch.sh implement` or manual |
| `ready` | Issue is available for any agent to pick up | Human (after spec is ratified) |
| `assigned-claude` | Claimed by Claude — other agents must not work on this | Agent loop or `dispatch.sh assign` |
| `assigned-cursor` | Claimed by Cursor | Agent loop or `dispatch.sh assign` |
| `assigned-codex` | Claimed by Codex | Agent loop or `dispatch.sh assign` |
| `blocked` | Issue cannot proceed (missing dependency, needs decision) | Any agent or human |
| `reviewing-claude` | PR is being reviewed by Claude — other agents skip | Agent loop |
| `reviewing-cursor` | PR is being reviewed by Cursor | Agent loop |
| `reviewing-codex` | PR is being reviewed by Codex | Agent loop |
| `changes-requested` | PR has review feedback that needs to be addressed by the author | Agent loop or reviewer |
| `ready-to-merge` | PR reviewed, approved, ready for merge | Human or reviewer agent |
| `authored-claude` | PR/issue was created by Claude | Agent loop (on PR creation) |
| `authored-cursor` | PR/issue was created by Cursor | Agent loop (on PR creation) |
| `authored-codex` | PR/issue was created by Codex | Agent loop (on PR creation) |
| `reviewed-by-claude` | PR was reviewed by Claude | Agent loop (after posting review) |
| `reviewed-by-cursor` | PR was reviewed by Cursor | Agent loop (after posting review) |
| `reviewed-by-codex` | PR was reviewed by Codex | Agent loop (after posting review) |
| `reviewed-by-copilot` | PR was reviewed by GitHub Copilot | GitHub (automatic) |

### Rules

- **ALL review comments must be responded to.** This includes GitHub Copilot inline comments. For each comment: either fix the issue, or reply explaining why no change is needed. Do not ignore any comment. Do not blindly accept — evaluate each on its merits. All comments must have a response before marking ready-to-merge.
- **Review before new work.** Agents check for PRs to review BEFORE picking up new implementation issues. Reviewing unblocks the pipeline faster than starting new work.
- **One reviewer per PR.** `reviewing-<agent>` label prevents duplicate reviews. 2+ reviews (including Copilot) = enough.
- **One agent per issue.** If an issue has `assigned-<agent>`, no other agent touches it.
- **Claim before working.** Agents must label an issue `assigned-<agent>` before starting work.
- **One branch per issue.** Each issue gets its own branch and worktree (`../wtfoc-worktrees/<branch>/`).
- **PRs for all changes.** No direct commits to main. Agents push to their branch and open a PR.
- **`ready` means available.** Only pick up issues labeled `ready`. Unlabeled or `blocked` issues are off-limits.
- **Don't work ahead of dependencies.** If an issue says "Depends on #X", wait until #X is merged before starting.

### Workflow

```
Human creates spec issues (dispatch.sh spec)
  → Claude writes specs + plans + tasks
  → Tasks converted to GitHub issues (labeled: implementation, ready)
  → Agents pick up ready issues via agent-loop.sh
  → Each agent works in isolated worktree
  → Agent opens PR when done
  → Human (or /peer-review) reviews PR
  → Merge to main
  → Agent loops back for next issue
```

### Scripts

- `scripts/dispatch.sh spec <title> [desc] [agent]` — create spec issue + worktree
- `scripts/dispatch.sh implement <issue> [agent]` — create impl issue + worktree
- `scripts/dispatch.sh assign <issue> <agent>` — assign issue to agent
- `scripts/dispatch.sh status` — show all agent assignments
- `scripts/dispatch.sh cleanup` — remove merged worktrees
- `scripts/agent-loop.sh <agent>` — autonomous work loop (picks up assigned or ready issues)

## What wtfoc IS

- **A shareable, improvable knowledge graph.** Any agent (AI or human) can ingest sources, extract edges, and publish a collection. Any other agent can fetch it, improve it, and republish. The knowledge gets better with each contributor.
- **Decentralized persistent storage for RAG and knowledge bases.** Collections are CID-addressed, verifiable, and stored on Filecoin. The data outlives any single service.
- **An evidence-backed trace engine.** Every result links back to source artifacts with typed edges and confidence scores. No black-box summaries.

## What wtfoc Is NOT

- **Not a vector database.** We provide pluggable seams for vector stores, not a competing implementation.
- **Not an agent framework.** Agents use wtfoc as a knowledge layer — we don't orchestrate them.
- **Not a multi-writer database.** Single writer per project for now. Don't promise distributed coordination too early.
- **Never store opaque summaries without evidence links.** Every fact traces back to stored, verifiable source artifacts.
- **The differentiator is verifiable, portable knowledge state — not embeddings.** Embeddings are compute. CID-addressed evidence is the product.

## Governance

- This constitution and `SPEC.md` are the source of truth
- Changes to interfaces in `@wtfoc/common` require SPEC.md update
- Features not in SPEC.md require discussion before implementation

**Version**: 1.4.0 | **Ratified**: 2026-03-23 | **Last Amended**: 2026-03-26
