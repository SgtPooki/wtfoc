# Demo: Theme Discovery — Instant Cluster Analysis

Run one command. Get the 5-10 semantic themes your engineering conversation is actually about.

## The Point

`wtfoc themes` runs greedy cosine clustering over all embeddings in a collection and surfaces semantic themes with representative snippets. No LLM. Pure math. Sub-second on a laptop.

The demo line:

> "Here are the key topics your engineering conversation is actually about — automatically, no LLM, pure math."

## Prerequisites

Run the [Quick Start](../quick-start/) demo first to create the `wtfoc-quick-start` collection.

## Run It

```bash
./docs/demos/theme-discovery/run.sh
```

Or against a different collection:

```bash
./docs/demos/theme-discovery/run.sh --collection foc-upload-flow
```

## What Happens

The script runs clustering on an existing collection (default: `wtfoc-quick-start`).

> **Note:** This demo is contrived for speed — it runs in seconds on a single-repo collection. In practice, theme discovery is most interesting with multi-repo collections spanning code, issues, docs, and community discussions. Use `--collection foc-upload-flow` for richer results.

### Broad themes (default threshold: 0.85)

```bash
./wtfoc themes -c wtfoc-quick-start --limit 10 --exemplars 3
```

Returns the top clusters with exemplar chunks showing what each theme is about.

### Fine-grained themes (threshold: 0.80)

```bash
./wtfoc themes -c wtfoc-quick-start --threshold 0.80 --limit 10
```

Lower threshold = more specific clusters. Useful for finding niche conversations buried in the data.

## Tuning

| Flag | Default | Effect |
|------|---------|--------|
| `--threshold` | 0.85 | Cosine similarity cutoff. Higher = broader themes, lower = more specific |
| `--exemplars` | 3 | Number of representative chunks per cluster |
| `--min-size` | 3 | Minimum chunks for a cluster to appear |
| `--limit` | 20 | Max clusters to display |
| `--all` | off | Show every cluster regardless of limit |

## Why It Matters

Theme discovery answers "what are we even talking about?" across repos, issues, docs, and code — without reading any of it. It's the fastest way to orient in a new codebase or audit where engineering attention is going.

## Reproduction

```bash
# Default (uses wtfoc-quick-start collection)
./docs/demos/theme-discovery/run.sh

# Against the upload-flow collection (recommended — more data)
./docs/demos/theme-discovery/run.sh --collection foc-upload-flow
```
