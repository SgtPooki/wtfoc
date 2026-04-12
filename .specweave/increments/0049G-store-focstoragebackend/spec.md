# [impl] Store: FocStorageBackend

**Increment**: 0049G-store-focstoragebackend
**Type**: feature | **Priority**: P2 | **Labels**: implementation, ready
**Source**: GitHub #7

## Description

## Tasks from 001-store-backend Phase 6

From spec: `.specify/specs/001-store-backend/tasks.md`
Depends on: schema validation (#6 or whatever number)

- [ ] T014-T015: Unit tests with mocked synapse-sdk
- [ ] T016: Create `packages/store/src/backends/foc.ts` using @filoz/synapse-sdk + filecoin-pin
- [ ] T017: Error mapping (synapse errors → wtfoc typed errors)
- [ ] T018: `source: 'wtfoc'` namespace isolation
- [ ] T019: StorageResult with id=PieceCID, pieceCid, ipfsCid
- [ ] T020: AbortSignal support
- [ ] T021: Update createStore() factory for 'foc' backend
- [ ] T022: Optional integration test (FOC_TEST=1)
- [ ] T023: Export from index.ts

### Context
See also: #4 (FOC dataset metadata strategy) — may affect implementation.
Reference: synapse-sdk at `/Users/sgtpooki/code/work/filoz/filozone/synapse-sdk`
Reference: filecoin-pin at `/Users/sgtpooki/code/work/filoz/filecoin-project/filecoin-pin`

### Rules
- Read SPEC.md and AGENTS.md
- Behavioral tests with vitest
- pnpm test and pnpm lint must pass

---
Depends on: #6

## User Stories

- **US-001**: As a user, I want store focstoragebackend so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #7 on 2026-04-12.
