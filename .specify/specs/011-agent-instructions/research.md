# Research: Agent Instructions And Repo Setup

## Sources Reviewed

- GitHub Blog: [How to write a great AGENTS.md: lessons from over 2,500 repositories](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
- GitHub Docs: [Adding repository custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot)
- GitHub Docs: [Creating custom agents for Copilot coding agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents)
- Anthropic Docs: [Manage Claude's memory](https://docs.anthropic.com/en/docs/claude-code/memory)
- Cursor Docs: [Rules](https://docs.cursor.com/context/rules)
- AGENTS.md: [A simple, open format for guiding coding agents](https://agents.md/)

## Findings

### 1. Concrete commands and examples outperform general advice

GitHub's blog and Anthropic's memory guidance both stress concrete, specific instructions over vague style advice. The repo should keep exact commands, exact file locations, and explicit triggers for when specs or docs must be updated.

### 2. Scoped instructions are now a standard pattern

GitHub docs explicitly support multiple `AGENTS.md` files where the nearest file takes precedence. Anthropic documents recursive memory lookup, and Cursor supports project rules scoped by file patterns or subdirectories. For a monorepo, local instructions near each package are higher value than a large global file.

### 3. Vendor-specific instruction files complement cross-agent files

GitHub supports:
- repository-wide instructions via `.github/copilot-instructions.md`
- path-specific instructions via `.github/instructions/*.instructions.md`
- optional custom agents via `.github/agents/*.agent.md`

This complements, rather than replaces, cross-agent files like `AGENTS.md`.

### 4. Agent guidance should be maintained like code

Anthropic recommends reviewing memory periodically, and the AGENTS.md project positions the file as living documentation. That supports a repo rule that stale code maps, commands, and comments should be updated when discovered.

### 5. Comment discipline should be explicit

None of the reviewed docs prescribe "more comments" as a default. The durable pattern is to encode code style, commands, workflow, and architecture, then reserve comments for non-obvious rationale. This repo should explicitly state that self-documenting code is preferred and comments should focus on why, invariants, and constraints.

## Decisions Applied To This Repo

- Tighten the root `AGENTS.md` and remove duplicated policy text.
- Add package-scoped `AGENTS.md` files under each package.
- Add `.github/copilot-instructions.md`.
- Add path-specific instruction files for TypeScript, shared contracts, CLI code, and spec docs.
- Add explicit comment policy and stale-guidance maintenance rules.
