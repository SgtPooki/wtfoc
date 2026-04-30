# AGENTS.md — wtfoc

**Mission:** wtfoc is an evidence-backed **trace engine with explicit typed edges across any content type**. Builds shareable, improvable knowledge graphs. Any agent — AI or human — can ingest sources, extract evidence-backed edges (pattern, code, heuristic, temporal, LLM extractors run in parallel), and publish a content-addressed collection. Any other agent can fetch, improve, and republish. The knowledge gets better with each contributor.

**Read before framing or scope proposals:** [`docs/vision.md`](docs/vision.md) (north-star goals + anti-goals) and [`docs/why.md`](docs/why.md) (search vs trace, the four collection use cases — Extend / RAG / Share / Drift-detection). Collections hold any content type (engineering artifacts, customer data, time-series, audio metadata, anything). FOC is the *default* StorageBackend, not a requirement — pluggable seam.

Agent operating instructions for this repository.

## Getting started (every session)

Run this first — distinguishes your agent in the claim mutex and freshens the task queue:

```bash
export BEADS_ACTOR="<tool>-$(hostname -s)"         # claude-…, codex-…, cursor-…, gemini-…
GITHUB_TOKEN=$(gh auth token) bd github sync --pull-only
bd ready --limit 10                                # pick your next task
```

Then read, in order:
1. [`SPEC.md`](SPEC.md) for project-wide invariants.
2. [`docs/principles.md`](docs/principles.md) for design principles.
3. [`docs/beads-agent-protocol.md`](docs/beads-agent-protocol.md) before using `bd` for claim/worktree/PR-review rules.
4. The nearest nested `AGENTS.md` for the package or subtree you are editing.

**Claude Code users**: See [`CLAUDE.md`](CLAUDE.md) for available skills and workflow guidance. `BEADS_ACTOR` is preset via `.claude/settings.json`; `bd ready` auto-prints at session start.

## Session end

Before stopping:

```bash
bd status                        # DB overview — anything still in_progress?
git worktree list                # remove stale worktrees: git worktree remove <path>
git log --oneline -5             # what landed; any unpushed commits?
```

If you claimed a bead but didn't finish, either `bd update <id> --status open` (returns it to the queue) or leave it claimed with a note via `bd note <id> "…"` so the next agent knows the state.

## Purpose

Use this file for repository-specific operating rules that help agents work autonomously.

- Keep this file lean. Link to source documents instead of restating them.
- If commands, code maps, or workflow notes here become stale, update them in the same change.
- Prefer nested `AGENTS.md` files for package-local rules over growing this root file.

## Quick Commands

Run from the repo root unless a nested `AGENTS.md` says otherwise.

```bash
pnpm install
pnpm lint:fix
pnpm test
pnpm -r build
pnpm --filter @wtfoc/store build
pnpm --filter @wtfoc/search test
```

Do not run `pnpm lint` by itself after edits. Run `pnpm lint:fix`, then fix any remaining issues manually.

## Repo Map

- `packages/common`: contracts, schemas, interfaces, typed errors only
- `packages/store`: storage backends, manifest handling, artifact bundling
- `packages/ingest`: source adapters, chunking, edge extraction, segment building
- `packages/search`: embedders, vector index, query, trace
- `packages/mcp-server`: MCP protocol server, tool definitions, shared `createMcpServer` factory
- `packages/cli`: CLI wiring, output formatting, exit behavior
- `apps/web`: Preact SPA frontend + HTTP/MCP backend server
- `scripts`: issue dispatch, agent loop, repo maintenance helpers
- `.github`: CI and GitHub-specific agent instructions

## Non-Negotiables

- Respect the six seams defined in [`SPEC.md`](SPEC.md). Do not introduce new interfaces casually.
- Treat changes to `@wtfoc/common`, manifest shapes, segment shapes, CLI flags, and CI/workflow files as high-risk.
- Never add I/O, SDK wrappers, or business logic to `@wtfoc/common`.
- Never use real secrets, PII, wallet keys, or non-synthetic fixtures in the repo.

## Issue and Commit Discipline (NON-NEGOTIABLE)

**Every piece of work must have a GitHub issue.** If there is no issue for what you are about to do, create one first.

**Every commit that completes work on an issue must include `fixes #<number>` in the commit message body.** This ensures the issue is automatically closed when the commit lands on main (whether via direct push or PR merge). Use the exact format:

```
feat(search): add theme clustering command

Implements k-means clustering over stored embeddings with evidence-rich
cluster summaries.

fixes #59
```

Rules:
- Use `fixes #N` (not `closes #N`, not `resolves #N`) for consistency
- Place it on its own line at the end of the commit message body
- If a commit addresses multiple issues, add multiple `fixes` lines
- If a commit partially addresses an issue, do NOT use `fixes` — instead reference it with `relates to #N` or `progress on #N`
- Before pushing, verify that every completed issue has a commit with `fixes #N` — do not leave issues open when the work is done
- When creating a new feature that has no issue, create the issue first, then reference it in your commit

## Beads (local agent execution queue)

GitHub Issues stays canonical for specs and `fixes #N` commit closure. Beads (`bd`) is the local claim/coordination layer for multi-agent parallel work. **Read [`docs/beads-agent-protocol.md`](docs/beads-agent-protocol.md) in full before using `bd` in this repo.**

Critical rules (full rationale in the protocol doc):

- **Set `BEADS_ACTOR`** before running `bd` — `<tool>-<hostname>` convention (e.g. `claude-$(hostname -s)`). Multiple agents sharing an actor defeats the claim mutex.
- **Claim with `bd update <id> --claim`**. If it errors "already claimed by X", skip to the next `bd ready` item. Don't force-release.
- **Implementation beads REQUIRE their own worktree**: `git worktree add ../wtfoc-<short-id> -b beads/<short-id>`. Skip only for review-only or tiny docs edits.
- **`bd close` does NOT close the GitHub Issue.** `fixes #N` on the merge commit does. Never put a bead ID as a closure reference in commits.
- **Force-release is exceptional repair.** Only when `started_at` > 4h (30min for review/dispatch beads), no recent git activity from the prior claimant, no active worktree with uncommitted changes — AND you record the reason via `bd audit record`.
- **Mandatory `bd audit record` events**: force-release, claim abandonment, PR-review bead create, approve/changes-requested transitions, swarm/gate/merge-slot decisions, manual reconcile overrides. See the protocol doc for the full table.
- **Sync before a long claiming session**: `bd github sync` to pick up GH-side changes.

## Edit Checklist

Before editing:
- Read the nearest `AGENTS.md` for the area you are changing.
- Read the relevant spec if behavior or public contracts may change.

While editing:
- Reuse existing patterns before introducing new abstractions.
- Keep changes scoped to the task. Do not opportunistically refactor unrelated code.
- Update stale comments, docs, or examples in the touched area.

After editing:
- Run `pnpm lint:fix`.
- Run targeted tests for the changed package, then `pnpm test` if behavior changed or cross-package impact is plausible.
- Run `pnpm -r build` for cross-package or API changes.
- Update [`SPEC.md`](SPEC.md), README files, or specs when public behavior or contracts changed.
- Ensure your commit message includes `fixes #N` for every issue your change completes.

## Comment Policy

Prefer self-documenting code over explanatory comments.

- Use precise names, small functions, strong types, and focused tests before adding comments.
- Do not add comments that restate what the code already says.
- Comments should explain why, invariants, protocol constraints, security implications, or non-obvious tradeoffs.
- Use doc comments on exported APIs when the contract is not obvious from the type signature.
- Remove or update stale comments when touching nearby code.
- Do not leave TODOs without a linked spec, issue, or clear follow-up.

## Validation Libraries

- **valibot** is the project standard for schema validation (used in `@wtfoc/store`).
- **zod** is used only in `@wtfoc/mcp-server` because `@modelcontextprotocol/sdk` requires zod schemas for tool parameter definitions (peer dependency). Do not spread zod to other packages.

## Style Rules Worth Repeating

- No `any`
- No `as unknown as`
- No non-null assertions
- No default exports
- ESM only
- Named typed errors with stable `code` fields
- Long-running async work accepts `AbortSignal`
- Tests validate behavior, not implementation details

## Ask First

Pause and ask the user before:
- changing package scripts or CI semantics
- changing manifest or segment schema versions
- widening a public interface in `@wtfoc/common`
- adding dependencies without a clear package-level need
- changing issue/branch/worktree coordination rules

## Nested Instructions

This repo uses nested `AGENTS.md` files for package-local guidance. The closest file to the edited code wins.

- [`packages/common/AGENTS.md`](packages/common/AGENTS.md)
- [`packages/store/AGENTS.md`](packages/store/AGENTS.md)
- [`packages/ingest/AGENTS.md`](packages/ingest/AGENTS.md)
- [`packages/search/AGENTS.md`](packages/search/AGENTS.md)
- [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md)

GitHub-hosted agents also read:
- [`.github/copilot-instructions.md`](.github/copilot-instructions.md)
- files in [`.github/instructions/`](.github/instructions/)

## Active Technologies
- TypeScript strict mode, ESM only, Node >=24 + `@wtfoc/common`, `@wtfoc/ingest`, `@wtfoc/store`, `@wtfoc/search` (workspace packages only) (012-e2e-integration-pipeline)
- LocalStorageBackend + LocalManifestStore (temp directories, cleaned up after tests) (012-e2e-integration-pipeline)
- TypeScript strict mode, ESM only, Node >=24 + vitest, @qdrant/js-client-rest, commander, valibot; NEW: oxc-parser (JS/TS AST), raw fetch (LLM calls) (117-edge-extraction-pipeline)
- Local filesystem + optional FOC; Qdrant for vectors (117-edge-extraction-pipeline)
- TypeScript (strict, ESM-only), Node >= 24 + @wtfoc/common (interfaces), @wtfoc/ingest (adapters, chunker), @wtfoc/store (manifest, storage), @wtfoc/search (mount, vector index), commander (CLI) (118-incremental-ingest)
- Local filesystem (JSON sidecar files alongside manifests), optional FOC/Qdrant (118-incremental-ingest)
- TypeScript strict, ESM only, Node >=24 + `ignore` npm package (already installed in @wtfoc/config) (119-wtfocignore-support)
- N/A (file pattern matching only) (119-wtfocignore-support)
- TypeScript (ESM), Node 24 + pnpm workspaces, multi-stage Docker build (119-fix-docker-image)
- N/A (Dockerfile change only) (119-fix-docker-image)
- TypeScript strict mode, ESM only, Node >= 24 + Preact 10.x + @preact/signals (frontend), Hono (server routing), wagmi + viem (wallet connection), pg (Postgres), @filoz/synapse-sdk + filecoin-pin (FOC), siwe (wallet auth) (121-wallet-collection-flow)
- PostgreSQL (production) with in-memory fallback (local dev). Existing LocalStorageBackend + FocStorageBackend for segment/CAR storage. (121-wallet-collection-flow)

## Recent Changes
- 012-e2e-integration-pipeline: Added TypeScript strict mode, ESM only, Node >=24 + `@wtfoc/common`, `@wtfoc/ingest`, `@wtfoc/store`, `@wtfoc/search` (workspace packages only)
