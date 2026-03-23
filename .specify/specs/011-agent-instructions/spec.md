# Feature Specification: Agent Instructions And Repo Setup

**Feature Branch**: `011-agent-instructions`
**Created**: 2026-03-23
**Status**: Implemented
**Input**: User description: "Research best practices for AGENTS.md and agentic repo setup, improve this repository's guidance, and open a PR with the changes."

## Clarifications

### Session 2026-03-23

- Q: Should the improvement focus only on the root `AGENTS.md`, or also on broader agent-facing repo setup? → A: Improve both the root file and the surrounding repo setup used by common agents.
- Q: Should the solution optimize for a single agent vendor or for cross-agent reuse? → A: Cross-agent reuse first, with vendor-specific files added only where they reinforce the same rules.
- Q: Should comment guidance be made explicit? → A: Yes. Add an explicit self-documenting code and comment policy.

## Overview

The current repository already contains strong workflow and architecture guidance, but the root `AGENTS.md` duplicates substantial material from `SPEC.md` and the constitution, and it does not yet take full advantage of nested instructions or GitHub's repository and path-specific instruction files.

This feature makes the repo easier for coding agents to operate in by tightening the root `AGENTS.md`, adding scoped package-level `AGENTS.md` files, and adding GitHub Copilot instruction files that mirror the repository's actual constraints. The goal is faster onboarding for agents, less duplicated policy, and clearer local rules for high-risk areas.

## User Scenarios & Testing

### User Story 1 - Agents can find concrete repo-wide operating rules quickly (Priority: P1)

An agent opening the repository for the first time can identify the required read order, core commands, comment policy, verification expectations, and high-risk areas without scanning multiple large documents.

**Independent Test**: Open the root `AGENTS.md` and confirm it provides commands, edit checklist, comment guidance, and links to authoritative documents without restating the entire constitution.

### User Story 2 - Agents receive more precise local instructions in subtrees (Priority: P1)

An agent editing package code receives focused instructions for that package instead of relying on a single global file.

**Independent Test**: Open any package directory and confirm a local `AGENTS.md` exists with package-specific rules and verification commands.

### User Story 3 - GitHub-hosted agents get matching instructions (Priority: P2)

An agent working through GitHub Copilot coding agent or code review receives repository-wide and path-specific custom instructions aligned with the local `AGENTS.md` rules.

**Independent Test**: Confirm `.github/copilot-instructions.md` exists and `.github/instructions/*.instructions.md` provide scoped guidance for relevant files.

## Requirements

### Functional Requirements

- **FR-001**: The root `AGENTS.md` MUST be concise, operational, and primarily reference `SPEC.md`, the constitution, and feature specs instead of duplicating them.
- **FR-002**: The root `AGENTS.md` MUST include explicit command guidance, an edit checklist, and a comment policy that favors self-documenting code.
- **FR-003**: The repository MUST include nested `AGENTS.md` files for each package under `packages/` with package-specific boundaries and verification commands.
- **FR-004**: The repository MUST include `.github/copilot-instructions.md` with repository-wide guidance aligned with the root `AGENTS.md`.
- **FR-005**: The repository MUST include path-specific instruction files under `.github/instructions/` for at least TypeScript source, shared contracts, CLI code, and spec/instruction documents.
- **FR-006**: Agent-facing documentation MUST instruct contributors to update stale commands, code maps, and comments in the same change when inconsistencies are discovered.
- **FR-007**: The changes MUST preserve the repository's existing non-negotiable rules around spec-first development, package boundaries, testing expectations, and security.

## Success Criteria

- **SC-001**: The root `AGENTS.md` is shorter and less duplicative than before while still covering commands, comment policy, and edit workflow.
- **SC-002**: Each package under `packages/` contains a scoped `AGENTS.md` that reflects that package's role.
- **SC-003**: GitHub-specific instruction files exist and encode the same repo conventions without contradicting the root or package files.
- **SC-004**: The updated guidance explicitly discourages unnecessary comments and promotes self-documenting code.

## References

- GitHub Blog: [How to write a great AGENTS.md: lessons from over 2,500 repositories](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
- GitHub Docs: [Adding repository custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot)
- GitHub Docs: [Creating custom agents for Copilot coding agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents)
- Anthropic Docs: [Manage Claude's memory](https://docs.anthropic.com/en/docs/claude-code/memory)
- Cursor Docs: [Rules](https://docs.cursor.com/context/rules)
- AGENTS.md: [A simple, open format for guiding coding agents](https://agents.md/)
