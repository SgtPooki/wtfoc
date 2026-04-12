# [feat] Distribute wtfoc as Claude Code skill, npx skill, and MCP server

**Increment**: 0036G-distribute-wtfoc-as-claude-code-skill-npx-skill-an
**Type**: spec | **Priority**: P2 | **Labels**: spec, implementation, P2
**Source**: GitHub #62

## Description

## Problem

The trace-then-analyze workflow (run `wtfoc trace`, feed results to an LLM for synthesis) is powerful but requires manual copy-paste. We should make this a seamless experience for Claude Code users.

## Three incremental paths

### 1. Claude Code Skill (`.claude/skills/`)
- Create `SKILL.md` that instructs Claude to run `wtfoc trace`, capture output, and synthesize
- Zero infrastructure — anyone who clones the repo gets it
- Invoke with `/trace-analyze` in Claude Code

### 2. Distributable via `npx skills`
- Publish skill so users can install with `npx skills add sgtpooki/wtfoc --skill trace-analyze -a claude-code`
- Uses the Vercel Labs skills ecosystem
- Works across Claude Code, Cursor, Codex, and other agents

### 3. MCP Server (`@wtfoc/mcp-server`)
- Expose `trace`, `query`, `ingest`, `status` as MCP tools
- Users install with `claude mcp add wtfoc -- npx -y @wtfoc/mcp-server`
- Claude gets native tool access to wtfoc — no bash piping
- Follows the same pattern as `@fil-b/foc-storage-mcp`

## Subtasks
- [ ] #63 — Claude Code skill (SKILL.md) — `/trace-analyze` slash command
- [ ] #64 — `npx skills` distribution
- [ ] #66 — MCP server (`@wtfoc/mcp-server`)

## User Stories

- **US-001**: As a user, I want distribute wtfoc as claude code skill npx skill an so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #62 on 2026-04-12.
