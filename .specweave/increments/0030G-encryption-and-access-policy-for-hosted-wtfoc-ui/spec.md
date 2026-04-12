# [design] Encryption and access policy for hosted `wtfoc` UI

**Increment**: 0030G-encryption-and-access-policy-for-hosted-wtfoc-ui
**Type**: spec | **Priority**: P3 | **Labels**: question, spec, P3
**Source**: GitHub #79

## Description

## Summary

Define the encryption and access policy model for `wtfoc` collections in the UI/product layer.

This should be separated from the initial graph/search/trace UI because it changes storage, search, and trust boundaries.

## Scope

- Collection-level encryption model
- Key ownership and sharing model
- What remains searchable versus encrypted-at-rest only
- Query/trace behavior for protected content

## Questions to resolve

- Which artifacts can be encrypted without breaking search and trace?
- Are raw content, chunks, manifests, and embeddings treated differently?
- How does a user grant access to encrypted collections?

## Acceptance criteria

- [ ] Encryption boundary is documented
- [ ] Search/trace implications are explicitly described
- [ ] Key ownership/sharing model is defined at a high level
- [ ] Depends on the broader UI platform split from #67

## Parent

- Parent: #67


## User Stories

- **US-001**: As a user, I want encryption and access policy for hosted wtfoc ui so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #79 on 2026-04-12.
