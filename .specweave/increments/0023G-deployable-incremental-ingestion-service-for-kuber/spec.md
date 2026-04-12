# feat: deployable incremental ingestion service for Kubernetes

**Increment**: 0023G-deployable-incremental-ingestion-service-for-kuber
**Type**: feature | **Priority**: P2 | **Labels**: scale, P2
**Source**: GitHub #118

## Description

## Summary

Deploy wtfoc as a long-running service that incrementally ingests sources for a collection on a schedule, rather than requiring manual `--since` flags and cron jobs.

Today, incremental ingestion works but is **manual and stateless**: you run `wtfoc ingest github owner/repo -c col --since 7d` repeatedly, content-hash dedup prevents duplicates, and segments append to the manifest chain. This is functional but requires external orchestration and doesn't track what was synced or when.

The goal is a deployable service (targeting Kubernetes) that manages source registries, watermarks, and scheduled syncs — so a collection stays fresh automatically.

## What Works Today

- **Append semantics**: `ingest` appends segments to existing collections (never replaces)
- **Content-hash dedup**: `SHA-256(content)` chunk IDs mean re-ingesting is safe and cheap
- **`--since` filtering**: GitHub adapter supports server-side `since` param; Slack uses `oldest`
- **Manifest chain**: `prevHeadId` tracks history; `ManifestConflictError` prevents lost updates
- **Embedding model enforcement**: mismatched models abort rather than corrupt the index

## What's Missing

### 1. Source Registry (per-collection)

Collections don't remember what sources were ingested or with what parameters. Need a `sources` field in the manifest or a sidecar config:

```typescript
interface SourceRecord {
  type: "github" | "repo" | "website" | "slack" | "discord" | "hackernews";
  args: Record<string, string>;  // e.g., { repo: "owner/repo" }

  // Dual cursors — see §2 for rationale
  forwardCursor: string | null;  // newest content successfully synced (ISO timestamp, commit SHA, etc.)
  rearCursor: string | null;     // oldest content reached during backfill (null = backfill not started)
  backfillComplete: boolean;     // true once rearCursor has reached the beginning of the source

  paginationCursor?: string;     // adapter-specific opaque token for resuming mid-page
}
```

### 2. Dual Cursors: Forward + Rear

A single `lastSyncedAt` timestamp is not enough. Sources have two independent ingestion directions:

```
                    source timeline
  ◄────────────────────────────────────────────►
  oldest                                   newest

  ◄── rearCursor              forwardCursor ──►
       (backfill)              (new content)
```

**Forward cursor** — tracks the newest content successfully synced. Each `sync` run fetches everything *after* this point. Moves forward over time.

**Rear cursor** — tracks how far back the initial backfill has reached. Large sources (e.g., a repo with 5 years of issues) can't be fully ingested in one run. The rear cursor lets backfill resume where it left off across multiple runs, working backward through history.

**Why both?**
- A user runs `wtfoc ingest github owner/repo -c col --since 90d` — this sets `forwardCursor = now` and `rearCursor = now - 90d`, with `backfillComplete = false`.
- `sync` picks up new content after `forwardCursor` (fast, small batches).
- A separate backfill job can work backward from `rearCursor` toward the beginning of the source (slow, large batches, interruptible).
- Without dual cursors, you either miss old content or re-fetch everything every time.

**Per-adapter cursor semantics:**

| Source | Forward cursor | Rear cursor | Pagination cursor |
|--------|---------------|-------------|-------------------|
| GitHub issues | `since` ISO timestamp | oldest `created_at` reached | page number or `Link` header |
| GitHub PRs | `updated_at` of newest PR synced | oldest `updated_at` reached | page number |
| Slack | Unix timestamp of newest message | Unix timestamp of oldest message reached | Slack `cursor` token |
| Website | last crawl timestamp | N/A (single-pass crawl) | — |
| Repo (code) | commit SHA of last ingested HEAD | N/A (full clone each time, dedup handles it) | — |
| HackerNews | Algolia `created_at_i` of newest item | oldest `created_at_i` reached | Algolia page offset |

### 3. Cursor Persistence

Slack adapter uses cursor-based pagination within a run but doesn't persist cursors between runs. For large channels, this means re-fetching from the watermark every time. The `paginationCursor` field in the source record solves this — adapters save their opaque resume token so the next run picks up mid-page.

### 4. `wtfoc sync` Command

Zero-config incremental update that reads the source registry and runs ingest for each source:

```bash
# Register sources (first time)
wtfoc ingest github FilOzone/synapse-sdk -c my-collection --since 90d

# Later: sync all registered sources (forward direction only)
wtfoc sync -c my-collection

# Backfill: extend history backward for all sources
wtfoc sync -c my-collection --backfill

# Backfill a specific source
wtfoc sync -c my-collection --backfill --source github:FilOzone/synapse-sdk
```

### 5. Kubernetes Deployment

A container image and Helm chart (or similar) that runs `sync` on a configurable schedule:

```yaml
# Conceptual — not prescriptive about format
collection: foc-ecosystem
schedule: "0 */6 * * *"  # every 6 hours
backfillSchedule: "0 3 * * 0"  # weekly backfill on Sunday 3am
sources:
  - type: github
    repo: FilOzone/synapse-sdk
  - type: github
    repo: filecoin-project/curio
  - type: website
    url: https://docs.filecoin.cloud/
```

Key deployment concerns:
- **Resource limits**: ingest is memory-intensive during embedding; needs configurable batch sizes
- **Concurrency**: manifest conflict detection exists but needs retry-with-backoff for multi-pod scenarios
- **Embedder**: should support external embedder URL (e.g., a shared embedding service in the cluster)
- **Storage**: local storage needs a PVC; FOC storage needs `WTFOC_PRIVATE_KEY` as a Secret
- **Health checks**: liveness/readiness probes based on last successful sync timestamp
- **Observability**: structured logs for sync events, chunk counts, dedup stats, errors

### 6. Watch Mode (stretch)

Long-running process that polls sources on an interval rather than running as a cron job. Lower latency but more complex lifecycle management.

## Implementation Phases

1. **Source registry + dual cursors** — Store source metadata in manifest; `wtfoc sources -c <col>` lists them with cursor positions
2. **`wtfoc sync` command** — Reads registry, runs forward sync per source; `--backfill` flag extends history backward
3. **Container image** — Dockerfile that runs `sync` on a schedule (can use existing image + entrypoint)
4. **K8s manifests** — CronJob or Deployment with configurable schedule, resource limits, secrets; separate backfill CronJob

## Related

- US-013 in `docs/user-stories.md` (incrementally ingest and monitor sources over time)
- Demo: `docs/demos/incremental-ingest/` (shows manual incremental workflow that works today)
- #2 (real-time Slack ingestion — overlaps with watch mode stretch)
- #39 (project config file — manifest vs sidecar for source registry)
- #102 (incremental ingest pipeline — direct predecessor)
- #103 (Docker image — prerequisite for K8s deliverables)
- #107 (shared runtime state — relevant if cross-process hydration lands)
- #108 (collection cache freshness — ingest worker updating heads implies invalidation)
- #109 (long-lived server responsibilities — watch mode is a runtime boundary question)
- #110 (scale triggers for external embedder — #118 mentions shared embedding service)
- #111 (deployment runtime split — sync engine maps to `wtfoc-ingest-worker`)


## User Stories

- **US-001**: As a user, I want deployable incremental ingestion service for kuber so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #118 on 2026-04-12.
