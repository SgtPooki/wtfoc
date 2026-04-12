# spec(deployment): ideal runtime split and per-component container images

**Increment**: 0025G-deployment-ideal-runtime-split-and-per-component-c
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #111

## Description

## Summary
Ratify a target multi-process deployment for when the single long-lived server stops being the best operational shape. Deliver a spec and phased plan for per-component container images based on runtime responsibility, not package names.

## Why
wtfoc already has strong package boundaries, but the current runtime is mostly unified. Documenting the ideal split makes future scaling and reliability work deliberate instead of reactive.

This issue is about the target architecture, triggers, and rollout plan. It does not require an immediate split.

## Proposed target components

1. `wtfoc-gateway`
- Public HTTP edge only: TLS/routing/auth hooks/rate limits/static assets.
- Exposes REST and MCP-over-HTTP at the edge.
- Does not implement retrieval, hydration, or ingest.

2. `wtfoc-query-runtime`
- Read path only: collection hydration, cache policy, query, trace, and MCP tool execution behind the gateway.
- Does not serve static assets or run long-lived ingest workflows.

3. `wtfoc-ingest-worker`
- Write path only: source acquisition, chunking, embedding during ingest, edge extraction, segment build/upload, and head/revision advancement.
- Does not serve public traffic.

4. `wtfoc-mcp-stdio`
- Packaging target for stdio MCP distribution.
- Not a default peer network service.

## Container direction
- `Dockerfile.gateway`
- `Dockerfile.query`
- `Dockerfile.ingest`
- Optional `Dockerfile.mcp`
- Use shared build stages and workspace pruning.
- Do not create separate images for library-only seams.

## Must-cover architecture concerns
- Shared contract for collection identity, manifest/version, and cache invalidation.
- Consistency model for reads after writes.
- Internal auth/security between components.
- Minimal ingest job orchestration model.
- Observability and correlation across components.
- Explicit statement that MCP-over-HTTP terminates at the gateway but executes in the query runtime.

## Non-goals
- No requirement to split immediately.
- Not one image per package.
- No separate embedder or vector-index deployables until scale data justifies it.

## Acceptance criteria
- Ratified target topology and triggers for moving off single-process.
- Clear owns / does-not-own boundaries for each component.
- Phased image plan that starts with query + gateway, then ingest.
- Preserves existing package seams instead of inventing a parallel architecture.

## Notes
Cross-review feedback: treat `wtfoc-mcp-stdio` as a packaging/release target rather than a default deployed service, and make the cross-service contracts explicit so the split does not just move today’s ambiguity across process boundaries.


## User Stories

- **US-001**: As a user, I want deployment ideal runtime split and per component c so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #111 on 2026-04-12.
