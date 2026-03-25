# Demo: Gap Analysis — Self-Directed Research Assistant

Ingest partial data. The system tells you what's missing.

## The Point

After ingesting a few repos, `wtfoc` finds references pointing *outside* the collection — repos, docs sites, and specs your data mentions but you haven't ingested yet. It's a self-directed research assistant that tells you where to look next.

## Run It

```bash
./docs/demos/gap-analysis/run.sh
```

Or run against an existing collection (like the upload-flow-trace one):

```bash
./docs/demos/gap-analysis/run.sh --collection foc-upload-flow
```

## What Happens

### Step 1: Ingest partial data

The script deliberately ingests only 2 of the 4 FOC stack repos:

```bash
./wtfoc init gap-analysis-demo --local
./wtfoc ingest repo FilOzone/synapse-sdk -c gap-analysis-demo
./wtfoc ingest repo filecoin-project/filecoin-pin -c gap-analysis-demo
./wtfoc ingest github FilOzone/synapse-sdk -c gap-analysis-demo --since 90d
./wtfoc ingest github filecoin-project/filecoin-pin -c gap-analysis-demo --since 90d
```

No docs sites. No SP code. Deliberately incomplete.

### Step 2: Unresolved edges

```bash
./wtfoc unresolved-edges -c gap-analysis-demo
```

Shows edge resolution statistics — how many references in your data resolve to other chunks in the collection vs. pointing to things you don't have.

### Step 3: Suggested sources

```bash
./wtfoc suggest-sources -c gap-analysis-demo
```

Surfaces the repos and websites your data references but you haven't ingested, ranked by reference count. The system found these by analyzing cross-references in the content.

## The Demo Line

> "I ingested 2 repos and their recent GitHub activity. The system found edges pointing outside the collection and recommends ingesting `filecoin-project/curio`, `FilOzone/filecoin-services`, and the PDP specification — because the code I already ingested references them."

## Why It Matters

This is the difference between a search engine and a research assistant. A search engine answers questions about what you've given it. `wtfoc` tells you what you *should* give it next.

## Reproduction

```bash
# Full demo (ingest + analysis)
./docs/demos/gap-analysis/run.sh

# Analysis only on existing collection
./docs/demos/gap-analysis/run.sh --skip-ingest

# Against the upload-flow collection
./docs/demos/gap-analysis/run.sh --collection foc-upload-flow
```
