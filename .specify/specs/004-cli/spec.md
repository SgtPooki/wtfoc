# Feature Specification: CLI

**Feature Branch**: `004-cli`
**Created**: 2026-03-23
**Status**: Implemented (retroactive spec — updated to reflect what was built)
**Package**: `@wtfoc/cli`

## Overview

`@wtfoc/cli` composes all wtfoc packages into user-facing commands. Supports local and FOC storage, pluggable embedders, and human/JSON/quiet output modes.

## What Was Built

### Commands

| Command | Description | Status |
|---------|-------------|--------|
| `wtfoc init <name>` | Create a new project | ✅ |
| `wtfoc ingest repo <path\|owner/repo> -c <name>` | Ingest repo source code + docs | ✅ |
| `wtfoc trace <query> -c <name> [--mode discovery\|analytical]` | Evidence-backed cross-source trace | ✅ |
| `wtfoc query <text> -c <name>` | Semantic search | ✅ |
| `wtfoc status -c <name>` | Show collection info | ✅ |
| `wtfoc verify <id>` | Verify artifact exists | ✅ |

### Global Flags

| Flag | Description |
|------|-------------|
| `--storage <type>` | Storage backend: `local` (default) or `foc` |
| `--json` | Machine-readable JSON output to stdout |
| `--quiet` | Errors only (suppress progress) |

### Embedder Flags (on ingest, trace, query)

| Flag | Description |
|------|-------------|
| `--embedder <type>` | `local` (default) or `api` |
| `--embedder-url <url>` | API endpoint (shortcuts: `lmstudio`, `ollama`, or any URL) |
| `--embedder-model <model>` | Model name (REQUIRED for API embedders) |
| `--embedder-key <key>` | API key (optional for local servers) |

### Key Behaviors

1. **Model mismatch detection**: If collection was embedded with model A and you try to query with model B, CLI shows friendly error with guidance.
2. **Dimension mismatch detection**: Pre-flight check before trace/query — catches incompatible embedders before wasting time loading the index.
3. **FOC storage**: `--storage foc` reads `PRIVATE_KEY` from env, uploads segments with dual CIDs (IPFS + PieceCID), downloads via IPFS gateway.
4. **stderr for logs, stdout for data**: Progress messages go to stderr, results go to stdout. Enables piping.
5. **`./wtfoc` wrapper**: Shell script at repo root runs the built CLI (`node packages/cli/dist/cli.js`).

### Ingest Flow

1. `createStore()` with storage backend from `--storage`
2. `createEmbedder()` from `--embedder-*` flags
3. Model mismatch check against existing collection
4. `RepoAdapter.parseConfig()` validates source
5. Walk repo files → chunk → extract edges
6. `embedder.embedBatch()` all chunks
7. `buildSegment()` with chunks + embeddings + edges
8. `store.storage.upload()` segment bytes → get storage ID
9. Update manifest with new segment + head pointer
10. `store.manifests.putHead()` with prevHeadId conflict check

### Output Formatting

- **Trace**: Grouped by sourceType with emoji icons, score, content snippet, source URL, storage ID, edge annotations. In `--mode analytical`, a "Cross-Source Insights" section shows convergence, evidence chains, and temporal clusters with strength percentages.
- **Query**: Ranked results with score, sourceType, source, URL, storage ID
- **Status**: Project name, chunk count, segment count, embedding model, last updated
- **All commands**: `--json` returns structured JSON, `--quiet` suppresses

## User Scenarios Validated

| Scenario | Status |
|----------|--------|
| Init local project | ✅ |
| Init FOC project | ✅ |
| Ingest local fixture repo | ✅ |
| Ingest real GitHub repo (FIL-Builders/foc-cli, 231 chunks) | ✅ |
| Ingest 3 repos into one collection (7530 chunks) | ✅ |
| Trace with local embedder (MiniLM 384d) | ✅ |
| Trace --mode analytical (cross-source insights) | ✅ |
| Trace with LM Studio (mxbai 1024d) | ✅ |
| Trace with Ollama on k8s (nomic 768d) | ✅ |
| Trace against FOC-stored data | ✅ |
| Query with topK | ✅ |
| Status shows collection info | ✅ |
| Verify artifact exists (local) | ✅ |
| Model mismatch → friendly error | ✅ |
| Dimension mismatch → friendly error | ✅ |
| --json output mode | ✅ |
| --quiet mode | ✅ |

## Dependencies

- `@wtfoc/common` — types, CURRENT_SCHEMA_VERSION
- `@wtfoc/store` — createStore, LocalStorageBackend, FocStorageBackend
- `@wtfoc/ingest` — RepoAdapter, RegexEdgeExtractor, buildSegment
- `@wtfoc/search` — TransformersEmbedder, OpenAIEmbedder, InMemoryVectorIndex, trace, query
- `commander` — CLI framework
