# Development

## Prerequisites

- Node.js >= 24
- pnpm (via corepack: `corepack enable`)

## Setup

```bash
git clone https://github.com/SgtPooki/wtfoc.git
cd wtfoc
pnpm install
pnpm -r build
```

## Commands

```bash
pnpm -r build          # Build all packages
pnpm test              # Run all tests (vitest)
pnpm lint:fix          # Lint and auto-fix (biome)
```

### Package-scoped

```bash
pnpm --filter @wtfoc/store build
pnpm --filter @wtfoc/search test
```

### Web server (hot-reload)

```bash
cd apps/web
WTFOC_EMBEDDER_URL=http://localhost:11434/v1 \
WTFOC_EMBEDDER_MODEL=nomic-embed-text \
pnpm dev:server
```

This uses `tsx --watch` for instant reload on TypeScript changes. For the frontend, `pnpm dev` runs Vite's dev server.

## Project Structure

```
packages/
  common/       Shared types, interfaces, schemas (no I/O, no business logic)
  store/        Storage backends (local, FOC) + manifest management
  ingest/       Source adapters + chunking + edge extraction + scoring
  search/       Embedders + vector index + query + trace
  mcp-server/   MCP protocol server + createMcpServer factory
  cli/          CLI wrapping all packages (commander.js)
apps/
  web/          Preact SPA frontend + Node.js HTTP/MCP backend server
skills/         Distributable agent skills (npx skills add)
```

## Spec-Driven Development

Every non-trivial change requires a spec, cross-reviewed by a different AI agent before implementation. The project uses [spec-kit](https://github.com/github/spec-kit):

```
/speckit.specify       Create or update a feature specification
/speckit.clarify       Identify underspecified areas, ask targeted questions
/speckit.plan          Generate implementation plan from spec
/speckit.tasks         Generate dependency-ordered tasks
/speckit.implement     Execute the implementation plan
/speckit.analyze       Cross-artifact consistency check
```

Feature specs live in `.specify/specs/`. The project constitution is at `.specify/memory/constitution.md`.

## Key Files

| File | Purpose |
|------|---------|
| [SPEC.md](SPEC.md) | Project-wide invariants and architecture rules |
| [AGENTS.md](AGENTS.md) | AI agent operating instructions |
| [.specify/memory/constitution.md](.specify/memory/constitution.md) | Governance and workflow |

## Style

- TypeScript strict mode, ESM only
- No `any`, no `as unknown as`, no non-null assertions
- Named typed errors with stable `code` fields
- Long-running async work accepts `AbortSignal`
- Tests validate behavior, not implementation details
- Prefer self-documenting code over comments

See [AGENTS.md](AGENTS.md) for the full style guide and edit checklist.

## Issue and Commit Discipline

- Every piece of work must have a GitHub issue
- Every commit that completes an issue must include `fixes #N` in the message body
- Use conventional commit prefixes: `feat`, `fix`, `refactor`, `docs`, `test`
