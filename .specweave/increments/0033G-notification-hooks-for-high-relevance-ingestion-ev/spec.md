# [feat] Notification hooks for high-relevance ingestion events

**Increment**: 0033G-notification-hooks-for-high-relevance-ingestion-ev
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #70

## Description

## Summary

Add configurable notification callbacks that fire during ingestion when
high-relevance content is discovered — e.g., a new chunk with edges to
multiple existing source types, or a cluster of new edges pointing at
the same target.

## Motivation

Today wtfoc is query-only: you have to ask it something to learn
anything. Notifications make wtfoc proactive — teams get alerted when
important new context appears across their tracked sources without
having to poll.

This is especially valuable when ingesting community sources (#65)
where signal is intermittent and unpredictable.

## Proposed design

### Not a new seam

This is **not** a new pluggable seam in `@wtfoc/common`. Notifications
are application-layer composition owned by `@wtfoc/cli`. The ingest
pipeline exposes a callback option; the CLI wires concrete notification
implementations into it.

### Package ownership

| Package | Responsibility |
|---------|---------------|
| `@wtfoc/ingest` | Exposes `onNotifiableEvent` callback option in ingest pipeline; evaluates trigger rules |
| `@wtfoc/cli` | Wires concrete notification targets (Discord, console); owns config/flags |

### Callback interface (in `@wtfoc/ingest`, not common)

```typescript
interface IngestNotificationEvent {
  type: 'cross_source_reference' | 'new_edge_cluster';
  collection: string;
  chunks: Chunk[];          // uses existing Chunk type from @wtfoc/common
  edges: Edge[];            // uses existing Edge type (sourceId/targetId/type/evidence/confidence)
  triggeredBy: string;      // rule name
}

interface IngestOptions {
  // ... existing options ...
  onNotifiableEvent?: (event: IngestNotificationEvent) => Promise<void>;
}
```

### Built-in notification targets (in `@wtfoc/cli`)

| Target | Destination | Config |
|--------|-------------|--------|
| Console | stderr (respects `--quiet`) | `--notify` flag |
| Discord | Discord channel via webhook | `--discord-webhook` flag or `WTFOC_DISCORD_WEBHOOK_URL` env var |

Config precedence: `CLI flag > env var > config file > default` (per SPEC.md §12).

### Trigger rules (per ingest batch)

| Rule | Fires when | Scope |
|------|-----------|-------|
| `cross_source_reference` | A new chunk has edges to chunks from 2+ different `sourceType` values in the collection | Per chunk, deduplicated |
| `new_edge_cluster` | 3+ new edges in the current batch reference the same target chunk | Per batch |

Future (blocked on #61): `high_relevance_chunk` — fires when signal score exceeds threshold.

### Pipeline placement

Notifications fire **after segment upload succeeds, before head manifest
update**. This ensures alerts reference persisted data but avoids alerting
on data that could fail at the manifest stage.

### Execution semantics

- **Fire-and-forget with timeout**: each notification target gets 10s to complete
- **Failures logged to stderr**, never fail the ingest pipeline
- **`--quiet` mode**: suppresses console notifications
- **`--json` mode**: notification events emitted as JSON objects to stderr
  (stdout remains reserved for data per SPEC.md §11)

### Traceability

Every notification includes chunk IDs, source URLs, and edge evidence
so the alert can be traced back to stored artifacts.

## Relationship to existing work

- Enhanced by #65 (community adapters) — most valuable with noisy sources
- Future enhancement with #61 (signal scoring) for score-based triggers
- Does not add a new seam — uses callback injection pattern

## Acceptance criteria

- [ ] `IngestOptions` accepts `onNotifiableEvent` callback
- [ ] `cross_source_reference` trigger rule implemented and tested
- [ ] `new_edge_cluster` trigger rule implemented and tested
- [ ] Discord webhook target sends formatted message with chunk/edge details
- [ ] Console target prints to stderr, respects `--quiet`
- [ ] `--json` mode emits notification events as JSON to stderr
- [ ] Notifications include chunk IDs, source URLs, edge evidence
- [ ] 10s timeout per notification; failures logged, never fail ingest
- [ ] `--notify` flag enables console notifications
- [ ] `--discord-webhook` flag / `WTFOC_DISCORD_WEBHOOK_URL` env var for Discord
- [ ] Tests cover trigger rule evaluation with fixture data (per batch)
- [ ] Tests mock webhook calls (no live API calls)
- [ ] Notifications never write to stdout

## User Stories

- **US-001**: As a user, I want notification hooks for high relevance ingestion ev so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #70 on 2026-04-12.
