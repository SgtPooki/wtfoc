# Claude Code Instructions

**Baseline rules**: [`AGENTS.md`](AGENTS.md) defines project-wide operating rules (style, seams, commit discipline, edit checklist). Follow AGENTS.md as the foundation.

## Skills

Available via `/skill-name` or `Skill({ skill: "name" })`:

| Skill | When to use |
|-------|-------------|
| `sw:grill` | Adversarial review of a change — stress-test assumptions |
| `sw:code-reviewer` | Structured code review before shipping |
| `/simplify` | Catch duplication, readability issues, dead code |
| `sw:tdd-cycle` | TDD red→green→refactor discipline |

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
3. Use `sw:grill` or `sw:code-reviewer` for anything non-trivial before pushing
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
