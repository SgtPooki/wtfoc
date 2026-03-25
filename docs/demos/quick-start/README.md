# Demo: Quick Start — Local-First, Zero-Key

Three commands. No API key. No Docker. Local embeddings — no cloud services needed. Ingest requires network access to clone repos.

## The Point

Skeptics ask "what's the setup cost?" — this demo answers: **zero**.

The local embedder (`all-MiniLM-L6-v2`) downloads on first run and works without any cloud service. You go from nothing to semantic trace in under a minute.

## Run It

```bash
./docs/demos/quick-start/run.sh
```

## What Happens

### Step 1: Create a collection

```bash
./wtfoc init wtfoc-quick-start --local
```

Creates a local collection. No accounts, no config files.

### Step 2: Ingest a repo

```bash
./wtfoc ingest repo SgtPooki/wtfoc -c wtfoc-quick-start
```

Clones the repo, chunks the source code and markdown, embeds everything locally. On a laptop this takes ~30 seconds for a medium repo.

### Step 3: Trace a question

```bash
./wtfoc trace "how does ingest work" -c wtfoc-quick-start
```

Returns evidence-backed connections across source types — code files, markdown docs, type definitions — with confidence scores and source URLs.

### Bonus: Semantic search

```bash
./wtfoc query "embedder model" -c wtfoc-quick-start
```

Pure vector similarity search — find the most relevant chunks without the cross-source tracing.

## The Contrast

Once you've seen it work locally, you can flip to Filecoin storage:

```bash
./wtfoc promote wtfoc-quick-start
```

Same collection, now on Filecoin with a CID you can share. The local experience is the on-ramp; decentralized storage is the destination.

## Reproduction

```bash
# Full demo
./docs/demos/quick-start/run.sh

# Query only (collection must already exist)
./docs/demos/quick-start/run.sh --skip-ingest

# With a remote embedder
./docs/demos/quick-start/run.sh --embedder-url lmstudio --embedder-model mxbai-embed-large-v1
```
