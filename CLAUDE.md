# Claude Code Instructions

**Baseline rules**: [`AGENTS.md`](AGENTS.md) defines project-wide operating rules (style, seams, commit discipline, edit checklist). Follow AGENTS.md as the foundation.

## Vision and mission — read before reasoning about wtfoc

These two docs define what wtfoc is and where it's going. Read them before making framing claims, scope proposals, or design decisions. Don't reduce wtfoc to "RAG" or "Filecoin storage" — both are wrong. **wtfoc is a trace engine with explicit typed edges across any content type.** RAG is one of four collection use cases. FOC is the *default* StorageBackend, not a requirement.

- [`docs/vision.md`](docs/vision.md) — north-star goals, what "done" looks like, anti-goals
- [`docs/why.md`](docs/why.md) — what the differentiator is (search vs trace), how it compares to other tools
- [`docs/autoresearch/autonomous-loop-runbook.md`](docs/autoresearch/autonomous-loop-runbook.md) — operational guide for the closed-loop improvement system

Collections can hold any content (engineering artifacts, customer data, financial time-series, audio metadata, etc.). The substrate-of-community-improvable-collections is the moat — not retrieval quality.

## Skills

Available via `/skill-name` or `Skill({ skill: "name" })`:

| Skill | When to use |
|-------|-------------|
| `/grill` | Adversarial review of a change — stress-test assumptions |
| `/code-reviewer` | Structured code review before shipping |
| `/simplify` | Catch duplication, readability issues, dead code |
| `/tdd-cycle` | TDD red→green→refactor discipline |
| `/judge-llm` | Deep independent validation of completed work |
| `/debug` | Systematic root-cause debugging |

**Next task**: `bd ready` (see [`docs/beads-agent-protocol.md`](docs/beads-agent-protocol.md) before claiming).

**Parallel work**: Append "use subagents" to requests.

## Subagent Strategy

- **Protect main context** — delegate anything that produces large output
- **Research via subagents** — URLs, external docs → fetch and summarize, don't load raw content
- **Codebase exploration** — use Explore subagents for broad searches
- **Parallel research** — launch multiple subagents concurrently for independent questions

## Workflow

Implement directly. No increment planning required.

1. Read the relevant code before changing it
2. Run `pnpm test` + `pnpm lint:fix` after changes
3. Use `/grill` or `/code-reviewer` for anything non-trivial before pushing
4. Open a PR via `gh pr create` for changes

**Large-scale changes**: `/batch` — decomposes into parallel agents with worktree isolation.

## Testing

- Unit/Integration: Vitest (`.test.ts`), ESM mocking with `vi.hoisted()` + `vi.mock()`
- Run from root: `pnpm test` or per-package: `pnpm --filter @wtfoc/<pkg> test`
- Always run `pnpm lint:fix` (never `pnpm lint` alone)
- Must run `pnpm -r build` before pushing — CI tsc catches errors vitest misses

## Principles

1. **Simplicity First**: Minimal code, minimal impact
2. **No Laziness**: Root causes, senior standards
3. **DRY**: Flag and eliminate repetitions aggressively
4. **Test before ship**: Tests pass at every step

## Secrets

Before CLI tools, check existing config (`grep -q` only — never display values).

## Nested Repos

Before git operations, scan: `for d in repositories packages services apps libs workspace; do [ -d "$d" ] && find "$d" -maxdepth 2 -name ".git" -type d; done`

## External Services

CLI tools first (`gh`, `wrangler`, `supabase`) → MCP for complex integrations.

## Limits

**Max 1500 lines/file** — extract before adding.
