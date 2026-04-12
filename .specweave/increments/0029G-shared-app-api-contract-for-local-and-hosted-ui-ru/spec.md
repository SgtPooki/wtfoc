# [spec] Shared app/API contract for local and hosted UI runtimes

**Increment**: 0029G-shared-app-api-contract-for-local-and-hosted-ui-ru
**Type**: spec | **Priority**: P3 | **Labels**: spec, P3
**Source**: GitHub #80

## Description

## Summary

Define the shared application/API contract used by both the local `wtfoc serve` runtime and the deployable web app.

This is the boundary that should keep product concerns out of the core packages while preventing the local and hosted UIs from drifting apart.

## Scope

Define and ratify the API/service contract for:

- collection discovery
- graph data
- query/search
- trace
- later promotion/write hooks if needed

## Example endpoints

- `GET /api/collections`
- `GET /api/graph`
- `GET /api/query`
- `GET /api/trace`

## Acceptance criteria

- [ ] Shared API/service contract is documented
- [ ] Contract is suitable for both local and hosted runtimes
- [ ] Collection, graph, query, and trace surfaces are defined
- [ ] Follow-on implementation can target this contract without re-deciding boundaries

## Parent

- Parent: #67


## User Stories

- **US-001**: As a user, I want shared app api contract for local and hosted ui ru so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #80 on 2026-04-12.
