# Demo: Theme Discovery — Instant Cluster Analysis

Run one command. Get the 5-10 semantic themes your engineering conversation is actually about.

## The Point

`wtfoc themes` runs greedy cosine clustering over all embeddings in a collection and surfaces semantic themes with representative snippets. No LLM. Pure math. Sub-second on a laptop.

The demo line:

> "Here are the key topics your engineering conversation is actually about — automatically, no LLM, pure math."

## Run It

```bash
./docs/demos/theme-discovery/run.sh
```

Or against an existing collection:

```bash
./docs/demos/theme-discovery/run.sh --collection foc-upload-flow
```

## What Happens

### Ingest source data

The script ingests this repo to build a collection quickly (~2 min). For richer themes across multiple repos and source types, use `--collection foc-upload-flow`.

> **Note:** This demo is contrived for speed. In practice, theme discovery is most interesting with multi-repo collections spanning code, issues, docs, and community discussions.

### Broad themes (default threshold: 0.85)

```bash
./wtfoc themes -c theme-discovery-demo --limit 10 --exemplars 3
```

Returns the top clusters with exemplar chunks showing what each theme is about. Expect themes like:
- Upload pipeline and storage contexts
- PDP proof verification
- SDK type definitions
- DX friction and API ergonomics
- Documentation and onboarding

### Fine-grained themes (threshold: 0.80)

```bash
./wtfoc themes -c theme-discovery-demo --threshold 0.80 --limit 10
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
# Full demo
./docs/demos/theme-discovery/run.sh

# Themes only on existing collection
./docs/demos/theme-discovery/run.sh --skip-ingest

# Against the upload-flow collection (recommended — more data)
./docs/demos/theme-discovery/run.sh --collection foc-upload-flow
```
