# [feat] Source auth and connector management for hosted UI

**Increment**: 0031G-source-auth-and-connector-management-for-hosted-ui
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #76

## Description

## Summary

Design and build source authentication and connector management for the hosted UI.

This should live in the deployed app/backend control plane, not inside a thin local `wtfoc serve` runtime.

## Scope

- Connector setup UX
- GitHub / Slack / Discord auth flows as applicable
- Secret storage model
- Permissions for adding, refreshing, or removing sources

## Questions to resolve

- Where do source credentials live?
- Which actions require app auth?
- What backend components are required for connector refresh and ingestion?

## Acceptance criteria

- [ ] Connector auth boundary is defined
- [ ] Secret storage model is documented
- [ ] Source management permissions are defined
- [ ] Depends on the broader UI platform split from #67

## Parent

- Parent: #67
- Related: #10
- Related: #31
- Related: #33


## User Stories

- **US-001**: As a user, I want source auth and connector management for hosted ui so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #76 on 2026-04-12.
