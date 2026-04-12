# Real-time Slack ingestion via webhook

**Increment**: 0052G-real-time-slack-ingestion-via-webhook
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #2

## Description

## Summary

Add real-time Slack ingestion via webhook so new messages/threads are ingested automatically as they arrive, instead of requiring periodic manual `--since` polling.

## Current State (updated 2026-03-25)

The bot-token + `conversations.history` path is **implemented and working**:

```bash
wtfoc ingest slack "#general" -c my-collection --since 90d
```

This covers:
- [x] Bot token with `channels:history`, `channels:read` scopes
- [x] Backfill via `conversations.history` API with `oldest` parameter
- [x] Thread context preserved (replies grouped with parent via `groupChatMessages`)
- [x] Chunking + edge extraction
- [x] Incremental via `--since` flag (dedup handles overlap)

**What remains is the real-time push path** — receiving messages as they happen via Slack Events API, rather than polling with `--since`.

## What's Left

### Real-time webhook ingestion

1. **Event subscription** (Slack Events API) for `message` events
2. **Webhook endpoint** that receives new messages and:
   - Chunks the message (with thread context if reply)
   - Extracts edges (#issue refs, URLs, @mentions)
   - Appends to existing collection segment (or creates new micro-segment)
   - Updates head manifest
3. **Deployment**: webhook receiver needs to be reachable from Slack — ties into #118 (K8s deployment) and #111 (runtime split)

### Incremental sync improvements

The bot-token adapter works but is stateless between runs — no cursor persistence. See #118 for the broader incremental ingestion design, which includes:
- Per-source watermarks (Slack `oldest` timestamp)
- Cursor persistence across runs
- `wtfoc sync` command for zero-config updates

## Slack Access Methods (for reference)

| Method | Who can use | Scope | Status |
|--------|------------|-------|--------|
| Bot token + `conversations.history` | Anyone who can install a bot | Channels bot is invited to | **Implemented** |
| Events API webhook | Anyone who can install a bot | Real-time push | This issue |
| Native export (Settings > Exports) | Admins only | Public channels only | Not planned |

## Acceptance Criteria

- [x] Slack bot app with minimal scopes
- [x] Backfill fetches channel history via API
- [x] Messages chunked + edge-extracted + added to collection
- [x] Thread context preserved (replies grouped with parent)
- [x] Incremental via `--since` (dedup handles overlap)
- [ ] Webhook receives messages in real-time via Events API
- [ ] New messages auto-appended to collection without manual ingest run
- [ ] Cursor persistence between runs (#118)

## Related

- #118 (deployable incremental ingestion — cursor persistence, sync command)
- #111 (runtime split — webhook receiver maps to ingest-worker)
- #70 (notification hooks — webhook events could trigger alerts)

## User Stories

- **US-001**: As a user, I want real time slack ingestion via webhook so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #2 on 2026-04-12.
