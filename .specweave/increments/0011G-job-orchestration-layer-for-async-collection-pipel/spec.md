# feat: job orchestration layer for async collection pipelines

**Increment**: 0011G-job-orchestration-layer-for-async-collection-pipel
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #168

## Description

## Summary

wtfoc needs a job orchestration layer to manage long-running, observable, restartable background work across collections. Today every operation (ingest, extract-edges, materialize, CID pull, Qdrant indexing) is either a CLI one-shot or a synchronous request handler. This breaks down with multiple tenants, large collections, or server restarts mid-pipeline.

## Problem

| Operation | Current behavior | What breaks |
|-----------|-----------------|-------------|
| CID collection pull (#167) | Synchronous in request handler | Timeouts on large collections |
| Incremental ingest (#118) | CLI-only, no scheduling | Can't run as a service |
| Edge extraction | CLI-only, long-running | No progress visibility, no resume |
| Materialize + promote | CLI-only, sequential | No pipeline orchestration |
| Qdrant indexing | Implicit during mount | No retry on partial failure |

## Proposed design

### Job abstraction

```typescript
interface Job {
  id: string;
  type: "cid-pull" | "ingest" | "extract-edges" | "materialize" | "promote";
  collection: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: { current: number; total: number; phase: string };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
```

### Core requirements

1. **Durable job state** — Jobs survive server restarts (persist to disk or DB, not just in-memory)
2. **Concurrency control** — Limit parallel jobs per collection and globally (prevent OOM from multiple large ingests)
3. **Progress reporting** — Each job reports granular progress (segments downloaded, chunks indexed, contexts extracted)
4. **Cancellation** — AbortController-based, propagated through the pipeline
5. **Pipeline composition** — A "full pipeline" job composes: ingest → extract-edges → materialize, with each step as a sub-job
6. **API surface** — REST endpoints for job CRUD + SSE or polling for progress

### API sketch

```
POST   /api/jobs                    — Create a job (returns job ID immediately)
GET    /api/jobs                    — List jobs (filterable by collection, status)
GET    /api/jobs/:id                — Get job status + progress
DELETE /api/jobs/:id                — Cancel a running job
GET    /api/jobs/:id/events         — SSE stream for real-time progress (future)
```

### What this is NOT

- Not a distributed task queue (no Redis, no Celery) — single-process is fine for now
- Not the deployment runtime split (#111) — this is the internal scheduling model that any runtime shape needs
- Not a full workflow engine — just durable async jobs with progress

## Open questions

1. **Storage for job state** — JSON files alongside manifests? SQLite? In-memory with periodic flush?
2. **Pipeline DAG vs linear** — Do we need arbitrary DAG dependencies, or is a linear pipeline (ingest → extract → materialize) sufficient?
3. **Multi-tenant fairness** — How do we prevent one tenant's large ingest from starving others? Simple FIFO? Per-collection quotas?
4. **Retry semantics** — Should failed jobs auto-retry? How many times? With backoff?

## Relationship to other issues

- **#167** (async CID ingestion) — First consumer; currently synchronous, should become a job
- **#118** (deployable incremental ingestion) — Scheduled ingestion needs job orchestration to manage runs
- **#111** (runtime split spec) — The ingest-worker component's internal model depends on this design
- **#33** (GitHub adapter rate limiting) — Rate-limited adapters need jobs that can pause/resume

## Acceptance criteria

- [ ] Job abstraction with durable state that survives restarts
- [ ] REST API for creating, listing, and cancelling jobs
- [ ] CID pull (#167) converted to use job layer as proof of concept
- [ ] Progress reporting visible in web UI
- [ ] Concurrency limits prevent resource exhaustion

## User Stories

- **US-001**: As a user, I want job orchestration layer for async collection pipel so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #168 on 2026-04-12.
