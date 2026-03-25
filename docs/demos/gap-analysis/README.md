# Demo: Gap Analysis — Self-Directed Research Assistant

Ingest partial data. The system tells you what's missing.

## The Point

After ingesting a few repos, `wtfoc` finds references pointing *outside* the collection — repos, docs sites, and specs your data mentions but you haven't ingested yet. It's a self-directed research assistant that tells you where to look next.

## Prerequisites

Run the [Quick Start](../quick-start/) demo first to create the `wtfoc-quick-start` collection.

## Run It

```bash
./docs/demos/gap-analysis/run.sh
```

Or run against a different collection (like the upload-flow-trace one):

```bash
./docs/demos/gap-analysis/run.sh --collection foc-upload-flow
```

## What Happens

The script runs two analysis commands against an existing collection (default: `wtfoc-quick-start`):

> **Note:** This demo is contrived for speed — it analyzes a single-repo collection and runs in seconds. For richer gap analysis with more unresolved edges, use `--collection foc-upload-flow` with a pre-built multi-repo collection.

### Step 1: Unresolved edges

```bash
./wtfoc unresolved-edges -c wtfoc-quick-start
```

Shows edge resolution statistics — how many references in your data resolve to other chunks in the collection vs. pointing to things you don't have.

### Step 2: Suggested sources

```bash
./wtfoc suggest-sources -c wtfoc-quick-start
```

Surfaces the repos and websites your data references but you haven't ingested, ranked by reference count. The system found these by analyzing cross-references in the content.

## The Demo Line

> "I ingested one repo. The system found edges pointing outside the collection and recommends ingesting referenced repos, docs sites, and specs — because the code I already ingested references them."

## Why It Matters

This is the difference between a search engine and a research assistant. A search engine answers questions about what you've given it. `wtfoc` tells you what you *should* give it next.

## Reproduction

```bash
# Default (uses wtfoc-quick-start collection)
./docs/demos/gap-analysis/run.sh

# Against the upload-flow collection (richer results)
./docs/demos/gap-analysis/run.sh --collection foc-upload-flow
```
