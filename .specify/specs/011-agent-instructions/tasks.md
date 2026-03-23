# Tasks: Agent Instructions And Repo Setup

**Input**: Design documents from `.specify/specs/011-agent-instructions/`

## Phase 1: Research And Design

- [x] T001 Review current `AGENTS.md`, `SPEC.md`, constitution, package layout, and workflow files
- [x] T002 Review official guidance for AGENTS, repository instructions, and agent-scoped rules
- [x] T003 Write `spec.md`, `plan.md`, and `research.md`

## Phase 2: Implementation

- [x] T004 Rewrite root `AGENTS.md` to reduce duplication and add explicit comment policy
- [x] T005 Add nested `AGENTS.md` files for `packages/common`, `packages/store`, `packages/ingest`, `packages/search`, and `packages/cli`
- [x] T006 Add `.github/copilot-instructions.md`
- [x] T007 Add path-specific instruction files under `.github/instructions/`

## Phase 3: Verification

- [ ] T008 Run `pnpm lint:fix`
- [ ] T009 Run `pnpm test`
- [ ] T010 Run `pnpm -r build`
- [ ] T011 Open a pull request with the completed changes
