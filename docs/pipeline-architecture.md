# wtfoc Collection Pipeline Architecture

This document describes the full pipeline for building, maintaining, and querying a wtfoc collection — from raw sources through to semantic search and trace queries.

## Pipeline Overview

```
Sources (GitHub, Slack, Web, HN, Discord)
  │
  ▼
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌───────────────┐
│  Ingest  │───▶│  Chunk   │───▶│  Embed    │───▶│ Build Segment │
│ (fetch)  │    │ (split)  │    │ (vectors) │    │ (store blob)  │
└─────────┘    └──────────┘    └───────────┘    └───────────────┘
                    │                                    │
                    ▼                                    ▼
              ┌──────────┐                      ┌──────────────┐
              │  Edges   │                      │   Manifest   │
              │(pattern) │                      │  (head.json) │
              └──────────┘                      └──────────────┘
                                                       │
                                               ┌───────┴────────┐
                                               ▼                ▼
                                        ┌────────────┐  ┌──────────────┐
                                        │extract-edges│  │   Query /    │
                                        │  (LLM)     │  │   Trace      │
                                        └────────────┘  └──────────────┘
```

## Stage 1: Ingest (Source Fetching)

**Command**: `wtfoc ingest <sourceType> [args...]`

Adapters fetch raw content from external sources:

| Adapter | Source | What it fetches |
|---------|--------|----------------|
| `repo` | Git repositories | All tracked files (clones/pulls repo) |
| `github` | GitHub API | Issues, PRs, comments, reviews |
| `slack` | Slack Bot API | Channel messages + threads |
| `website` | Web crawler | HTML pages converted to markdown |
| `discord` | Discord API | Channel messages |
| `hackernews` | Algolia API | HN posts/comments by search query |

### Incremental Ingest (Cursors)

Each source gets a cursor stored in `{collection}.ingest-cursors.json` tracking the max timestamp seen. Subsequent ingests only fetch items newer than the cursor.

**Limitation**: The `repo` adapter does not set timestamps on chunks, so cursors are never advanced for repo sources. Every file is walked on every ingest (dedup prevents re-embedding, but I/O overhead remains).

### What's Stored vs. Discarded

**Stored in segments**: chunk text (`content`), embeddings, edges, BM25 terms, source metadata.

**NOT stored**: raw source documents. Only the chunked representation survives. To re-process with different chunking logic or new adapter behavior, you must re-fetch from the original source.

**This is the biggest architectural gap.** Without a raw source archive, `reingest` can only re-process what's already been chunked — it cannot apply new adapters, better code chunkers, or updated file filters to the original content.

## Stage 2: Chunking

Content is split into chunks before embedding.

### Markdown Chunker (default)
- **Default chunk size**: 512 characters, 0 overlap
- **Max chunk chars**: 4000 (~1.5K tokens)
- **Split priority**: ATX headers → paragraph breaks (`\n\n`) → sentence endings → hard char cap
- **Chunk ID**: SHA-256 of content text (deterministic, dedup key)

### Code Chunker (repo adapter)
- **Chunk size**: 512 characters, 50-char overlap
- **NOT AST-aware**: splits by raw character window, not by function/class boundaries
- **Exception**: manifest files (package.json, go.mod, etc.) emitted as single chunks

### Rechunk

`rechunkOversized()` is a post-processing step that splits any chunk exceeding `maxChars` using the same markdown split logic.

### Gap: No Tree-Sitter Chunking

Tree-sitter is used for edge extraction but NOT for chunking. Code files are split at arbitrary character boundaries, so a function may span two chunks — reducing embedding quality and edge extraction accuracy. AST-aware chunking is tracked as issue #134.

## Stage 3: Embedding

**Embedder interface**: `embed(text) → Float32Array` and `embedBatch(texts) → Float32Array[]`

**Built-in implementations**:
- `TransformersEmbedder` — local, uses transformers.js (default: `Xenova/all-MiniLM-L6-v2`, 384d)
- `OpenAIEmbedder` — any OpenAI-compatible `/v1/embeddings` endpoint (OpenAI, OpenRouter, LM Studio, Ollama, vLLM)

**Rate-limit handling** (added 2026-04-11):
- Retry with exponential backoff on 429, 5xx, and transient provider errors
- Pre-emptive pacing via `--embedder-rate-limit <rpm>`
- Provider-error detection for OpenRouter-style "200 OK with error body" responses
- 60s base wait on provider routing failures (linear growth per attempt)

**Embedder profiles**: Named bundles of model + dimensions + pooling + prefix, configurable in `.wtfoc.json`.

Embeddings are stored as `number[]` in each chunk within the segment blob.

## Stage 4: Edge Extraction (Pattern-Based)

Edges are extracted during ingest from the **composite extractor pipeline**:

### Extractor Layers (run in parallel, merged)

| Extractor | What it finds | Confidence |
|-----------|--------------|------------|
| **Adapter** | Import statements, `// See #42` comments, markdown links (repo-specific) | 1.0 |
| **Regex** | GitHub `#N` refs, `owner/repo#N`, GitHub URLs, `Closes/Fixes/Resolves #N` | 0.5–1.0 |
| **Heuristic** | Slack permalinks, Jira keys (`PROJ-123`), markdown hyperlinks | 0.8–0.85 |
| **Code** | Import statements (oxc-parser AST for JS/TS, regex fallback for Python/Go/Rust/Solidity), package.json deps | 0.95–1.0 |
| **Tree-sitter** | AST-derived edges via HTTP sidecar (`--tree-sitter-url`). Supported: TS, JS, Python, Go, Rust, Ruby, Java, C/C++. Fail-open. | varies |
| **LLM** | Semantic relationships via chat completions (optional, `--extractor-*` flags). Design discussions, person mentions, concept refs. | 0.3–0.8 |

### Merge Logic

Edges are deduped by `(type, sourceId, targetType, targetId)`. When multiple extractors find the same edge:
- Evidence strings are joined with ` | `
- Confidence = max(individual) + 0.05 per additional agreeing extractor, capped at 1.0
- Provenance tracks which extractors contributed
- Edge cap: 100 per chunk

## Stage 5: Segment Assembly & Storage

`buildSegment()` assembles chunks + embeddings + edges + BM25 terms + signal scores into a `Segment` blob:

```
Segment {
  schemaVersion, embeddingModel, embeddingDimensions,
  chunks: [{ id, content, embedding[], terms[], source, sourceType, sourceUrl, timestamp, metadata, signalScores }],
  edges: [{ type, sourceId, targetType, targetId, evidence, confidence }]
}
```

- Serialized as JSON, uploaded to storage backend
- Segment ID = SHA-256 of serialized JSON (content-addressed, immutable)
- Old segments are never deleted (audit trail)

## Stage 6: Extract-Edges (LLM, Post-Hoc)

**Command**: `wtfoc extract-edges -c <collection> --extractor-*`

A separate, incremental pass that sends chunks to an LLM for deeper semantic edge extraction:

- Groups chunks by source context (file/document)
- Tracks per-context status in `{collection}.extraction-status.json`
- Uses `contextHash` (SHA-256 of chunk content) to detect content changes
- Only re-processes contexts where content or model changed
- Fail-open: failed contexts are silently skipped

### Overlay Edges

LLM-extracted edges are stored in `{collection}.edges-overlay.json`, NOT merged into immutable segment blobs. Loaded at mount time.

**Gap**: Overlay edges are not versioned with the collection, not included in `reindex` or `reingest`, and not captured in `CollectionRevision` snapshots.

## Stage 7: Query & Trace

**`wtfoc query <text>`**: Semantic search — embeds query, cosine similarity against chunk vectors, returns ranked results.

**`wtfoc trace <query>`**: Evidence-backed connection tracing — follows edges across chunks to build knowledge graphs.

Both load all segments into an in-memory vector index on every invocation. No persistent vector backend exists (gap: tracked in spec 118-incremental-ingest).

## Incremental Update Commands

### `wtfoc reindex`
Re-embeds a collection with a new model. Preserves existing edges. Does NOT re-fetch sources or re-chunk.

### `wtfoc reingest`
Rebuilds from stored segments with current ignore patterns. Re-extracts pattern edges (regex + heuristic + code + optional tree-sitter). Does NOT run LLM extraction. Does NOT re-fetch sources.

### `wtfoc ingest` (again)
Re-runs adapter against the original source. Cursor-based incremental fetch for supported adapters. Chunk-level dedup prevents re-processing unchanged content.

## Keeping Collections Current (Requirements)

For an always-up-to-date collection serving internal agents:

1. **Periodic re-ingest**: `wtfoc ingest` per source on a schedule (cron). Cursors skip already-seen content.
2. **Re-embed on model change**: `wtfoc reindex` with `--target` to swap models without downtime.
3. **Edge extraction**: `wtfoc extract-edges` incrementally after ingest (skips unchanged contexts).
4. **Full rebuild**: `wtfoc reingest` when ignore patterns or edge extractors change.

### What's Missing for Production Always-Current Use

| Gap | Impact | Mitigation |
|-----|--------|-----------|
| No raw source archive | Can't re-chunk with new logic without re-fetching | Store raw content alongside segments |
| No segment-level re-processing | Must re-embed/re-extract everything even for 1 changed file | Add `--segment-filter` or file-level targeting |
| Repo adapter no cursor advancement | Every file walked on every ingest | Add git-diff-based change detection |
| Overlay edges not in segments | LLM edges lost on reindex/reingest | `materialize-edges` command exists but must be run manually |
| In-memory vector index | Every query reloads all segments | Persistent vector backend (Qdrant, SQLite-vec) |
| Dedup set loaded from storage | O(totalChunks) I/O on every ingest | Store chunk-ID index in manifest or sidecar file |
| No AST-aware code chunking | Functions split at arbitrary boundaries | Tree-sitter chunking (issue #134) |

## Edge Types Needed (Current vs. Desired)

### Currently Implemented
- `imports` / `depends-on` (code)
- `references` (GitHub issues/PRs, Jira, Slack)
- `links-to` (URLs, markdown hyperlinks)
- LLM-extracted semantic edges (design discussions, person mentions, concept references)

### Desired But Missing
- **Temporal edges**: `TemporalEdgeExtractor` exists in code but is NOT wired into any pipeline. Links chat messages to GitHub activity by timestamp proximity.
- **Code-path edges**: Function call chains, module dependency graphs (requires tree-sitter chunking + AST analysis)
- **User story edges**: Connecting customer feedback → feature requests → implementation code → documentation
- **Documentation edges**: Linking API docs → implementation → test cases
- **Drift edges**: Detecting when docs and code diverge (the `drift-analysis` demo exists but isn't an automated edge type)
