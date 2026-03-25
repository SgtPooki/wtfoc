# Demo: Incremental Ingestion — Collections Grow, Not Start Over

Add sources over time. Re-ingest safely. Watch traces get richer.

## The Point

The #1 question from eng-leads: **"Is this one-shot or incremental?"**

Answer: **Incremental.** You can add sources to a collection over days, weeks, or months. Each `ingest` appends new data. Duplicate content is automatically skipped via content-hash deduplication. Traces get richer as more sources connect.

## Prerequisites

Run the [Quick Start](../quick-start/) demo first to create the `wtfoc-quick-start` collection.

## Run It

```bash
./docs/demos/incremental-ingest/run.sh
```

## What Happens

The script builds on the existing `wtfoc-quick-start` collection (created by quick-start), adding new sources and demonstrating dedup:

> **Note:** This demo is contrived for speed (~2 min) using a single repo. In practice, incremental ingestion shines with multiple repos and source types added over days or weeks.

### Baseline: existing collection

Shows the current state of the `wtfoc-quick-start` collection and runs a trace to establish baseline results.

### Round 1: Add GitHub activity

```bash
./wtfoc ingest github SgtPooki/wtfoc -c wtfoc-quick-start --since 90d
```

Same trace now returns code + issues + PRs. The collection grew; nothing was replaced.

### Round 2: Re-ingest — dedup in action

```bash
./wtfoc ingest repo SgtPooki/wtfoc -c wtfoc-quick-start
```

Output shows chunks **skipped as duplicates**. Chunk count barely changes. Content-hash dedup means re-ingesting is safe and cheap.

## How Deduplication Works

Every chunk gets a deterministic ID: `SHA-256(content)`. Before adding new chunks, the ingest command loads all existing chunk IDs into a set and skips any incoming chunk that already exists. This means:

- Re-ingesting the same repo is safe (duplicates skipped)
- Overlapping `--since` windows are safe (same content = same hash)
- The only cost of re-ingestion is the fetch time, not storage

## Keeping Collections Fresh

Today, incremental updates are manual but straightforward:

```bash
# Weekly cron: fetch last 7 days of GitHub activity
./wtfoc ingest github FilOzone/synapse-sdk -c my-collection --since 7d
./wtfoc ingest github filecoin-project/filecoin-pin -c my-collection --since 7d

# Monthly: re-ingest repos to catch new code (dedup handles overlap)
./wtfoc ingest repo FilOzone/synapse-sdk -c my-collection
```

Use overlapping windows (e.g., `--since 14d` on a weekly cron) to avoid gaps. Dedup ensures no duplicates.

### Example crontab

```cron
# Every Monday at 2am: refresh GitHub activity
0 2 * * 1  cd /path/to/wtfoc && ./wtfoc ingest github FilOzone/synapse-sdk -c prod-collection --since 14d
0 2 * * 1  cd /path/to/wtfoc && ./wtfoc ingest github filecoin-project/filecoin-pin -c prod-collection --since 14d

# First of the month: full repo re-ingest (dedup handles it)
0 3 1 * *  cd /path/to/wtfoc && ./wtfoc ingest repo FilOzone/synapse-sdk -c prod-collection --batch-size 200
```

## What's Missing for Full Automation (US-013)

The manual cron approach works but has limitations. A proper `wtfoc sync` command would need:

| Feature | Status | What it enables |
|---------|--------|-----------------|
| **Source registry** | Not implemented | Collection remembers what sources were added and with what params |
| **Per-source watermarks** | Not implemented | Track "last synced at" per source so `sync` only fetches new content |
| **Cursor persistence** | Not implemented | Resume pagination across runs (especially Slack) |
| **`wtfoc sync` command** | Not implemented | Zero-config incremental update: reads registry, fetches only new content |
| **Watch mode** | Not implemented | Long-running process that polls sources on an interval |

The architecture supports all of this — segments are immutable, manifest chain tracks history, chunk IDs are deterministic. The missing piece is metadata: storing *what* was ingested and *when* so the next run can pick up where it left off.

### Proposed `wtfoc sync` flow

```bash
# First time: register sources
./wtfoc ingest github FilOzone/synapse-sdk -c my-collection --since 90d
# (manifest now records: source=github, repo=FilOzone/synapse-sdk, lastSynced=<timestamp>)

# Later: sync fetches only new content
./wtfoc sync -c my-collection
# (reads source registry, runs ingest for each source with --since=lastSynced)
```

## The Demo Line

> "This isn't one-shot. I started with source code, added GitHub issues, then re-ingested — same collection, duplicates automatically skipped. Each round made the traces richer. For production, a weekly cron with overlapping `--since` windows keeps it fresh."

## Reproduction

```bash
# Full demo (requires wtfoc-quick-start collection from quick-start demo)
./docs/demos/incremental-ingest/run.sh

# With LM Studio embedder
./docs/demos/incremental-ingest/run.sh --embedder-url lmstudio --embedder-model mxbai-embed-large-v1
```
