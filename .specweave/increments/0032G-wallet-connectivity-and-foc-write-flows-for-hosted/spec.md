# [feat] Wallet connectivity and FOC write flows for hosted UI

**Increment**: 0032G-wallet-connectivity-and-foc-write-flows-for-hosted
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #75

## Description

## Summary

Add wallet connectivity and FOC write flows to the hosted UI.

This is intentionally separate from the initial read-oriented UI work. Wallet UX should focus on actions that actually require chain identity and user confirmation.

## Scope

- Wallet connect
- User confirmation for FOC writes
- Promote/publish flows from local or staged collections
- Verification UX for IPFS CID and PieceCID metadata

## Questions to resolve

- Which actions require wallet auth versus app auth?
- What is the promotion flow from local collection to FOC-backed collection?
- How should verification metadata appear in the UI?

## Acceptance criteria

- [ ] Wallet connectivity is scoped to FOC write/publish actions
- [ ] FOC promote/publish UX is defined
- [ ] Verification metadata is presented clearly in the UI
- [ ] Depends on the broader UI platform split from #67

## Parent

- Parent: #67
- Related: #60


## User Stories

- **US-001**: As a user, I want wallet connectivity and foc write flows for hosted so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #75 on 2026-04-12.
