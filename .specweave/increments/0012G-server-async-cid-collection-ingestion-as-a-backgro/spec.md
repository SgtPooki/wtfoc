# feat(server): async CID collection ingestion as a background job

**Increment**: 0012G-server-async-cid-collection-ingestion-as-a-backgro
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #167

## Description

## Summary

When a CID collection is loaded via `/api/collections/cid/:cid/...`, the server currently performs all work synchronously in the request handler:

1. Fetch manifest from IPFS
2. Download all segment data from IPFS
3. Index all chunks into Qdrant
4. Persist segments + manifest to local storage

For large collections this blocks the request for a long time and could timeout. The CID ingestion should instead be an async background job.

## Proposed design

1. **POST `/api/collections/cid/:cid`** — Kicks off a background ingestion job, returns immediately with a job ID and status `"pending"`
2. **GET `/api/collections/cid/:cid/status`** — Returns job progress (segments downloaded, chunks indexed, etc.) or the final collection status once complete
3. The UI shows a progress indicator while the job runs
4. Job state survives server restarts (persist job metadata to disk)

## Current behavior

Everything happens in one request — works fine for small collections (~2K chunks, ~30s) but won't scale to larger ones (10K+ chunks).

## Context

Added in PR #166 — CID collections now download segments to local storage and index into Qdrant on first load. This issue tracks making that process async and observable.

## User Stories

- **US-001**: As a user, I want server async cid collection ingestion as a backgro so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #167 on 2026-04-12.
