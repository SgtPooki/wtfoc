# Implementation Plan: Agent Instructions And Repo Setup

**Branch**: `011-agent-instructions` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/.specify/specs/011-agent-instructions/spec.md`

## Summary

Improve agent onboarding and consistency in this monorepo by tightening the root `AGENTS.md`, adding package-scoped `AGENTS.md` files, and adding GitHub Copilot repository and path-specific instruction files. Keep the guidance concrete and low-duplication while preserving existing workflow and architecture constraints.

## Technical Context

**Language/Version**: Markdown documentation, repository instruction files
**Primary Dependencies**: Existing repo documents, GitHub custom instruction support
**Testing**: Manual verification plus repository lint/build/test commands
**Target Platform**: Local coding agents plus GitHub-hosted Copilot agents
**Project Type**: TypeScript monorepo
**Constraints**: Must preserve spec-first development rules; must not contradict `SPEC.md` or the constitution

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | PASS | No seam changes |
| II. Standalone Packages | PASS | Package-specific docs reinforce existing boundaries |
| III. Backend-Neutral Identity | PASS | Guidance preserves existing storage-neutral rules |
| IV. Immutable Data, Mutable Index | PASS | No schema or manifest behavior changes |
| V. Edges Are First-Class | PASS | No edge behavior changes |
| VI. Test-First | PASS | No code behavior changes; verification still required |
| VII. Bundle Uploads | PASS | No change |
| VIII. Hackathon-First | PASS | Better repo setup reduces coordination overhead without adding product scope |

## Planned Changes

```text
AGENTS.md                                  # tighten root guidance
packages/*/AGENTS.md                       # add package-local instructions
.github/copilot-instructions.md            # repo-wide Copilot instructions
.github/instructions/*.instructions.md     # path-specific instructions
.specify/specs/011-agent-instructions/*    # spec artifacts and research notes
```

## Design Decisions

- Keep the root file focused on repo-wide operations rather than restating the constitution.
- Put local constraints next to the code they govern using nested `AGENTS.md` files.
- Use GitHub instruction files because official GitHub docs support repository-wide and path-specific instructions that can complement `AGENTS.md`.
- Encode comment guidance explicitly to discourage unnecessary explanatory comments.

## Verification Plan

1. Review all new instruction files for internal consistency.
2. Run `pnpm lint:fix`.
3. Run `pnpm test`.
4. Run `pnpm -r build`.
