# Feature Specification: Search and Trace

**Feature Branch**: `003-search-and-trace`
**Created**: 2026-03-23
**Status**: Implemented (retroactive spec — updated to reflect what was built)
**Package**: `@wtfoc/search`

## Overview

`@wtfoc/search` provides local embeddings, vector search, and the hero `trace` command that follows explicit edges across source types with semantic fallback.

## What Was Built

### Embedders

**TransformersEmbedder** (`embedders/transformers.ts`):
- Uses `@huggingface/transformers` with `Xenova/all-MiniLM-L6-v2` (384d)
- Lazy model initialization — downloads on first use
- AbortSignal support
- Passes `dtype: "fp32"` to suppress warnings
- 6 tests (mocked pipeline)

**OpenAIEmbedder** (`embedders/openai.ts`):
- Works with any OpenAI-compatible API (OpenAI, LM Studio, Ollama, vLLM)
- Auto-detects dimensions from first API response (no hardcoded default)
- Auto-appends `/embeddings` to base URLs
- AbortSignal support
- Validated with: LM Studio (mxbai-embed-large, 1024d), Ollama on k8s (nomic-embed-text, 768d)
- 7 tests (mocked fetch)

### Vector Index

**InMemoryVectorIndex** (`index/in-memory.ts`):
- Brute-force cosine similarity (demo scale)
- Serialize/deserialize for manifest storage
- Dimension validation on add and search (throws VectorDimensionMismatchError)
- 6 tests

### Trace (Hero Feature)

**trace()** (`trace/trace.ts`):
- Embeds query → finds seed chunks via vector search
- Builds bidirectional edge index from all segments (forward + reverse)
- Follows explicit edges from seed chunks across source types
- Falls back to semantic similarity for unconnected chunks
- Groups results by sourceType
- Annotates each hop with: method (edge/semantic), edgeType, evidence, confidence
- `parentHopIndex` on each hop tracks the DFS tree structure for path reconstruction
- Cycle detection (visited set prevents infinite traversal)
- Configurable: maxPerSource, maxTotal, maxHops, minScore
- **Trace modes** (`TraceMode`):
  - `"discovery"` (default): find connected results across sources
  - `"analytical"`: also runs cross-source insight detection
- AbortSignal support
- 11 tests with multi-source fixture (Slack → Issue → PR → Code)

### Cross-Source Insights (Analytical Mode)

**detectInsights()** (`trace/insights.ts`):
- Post-hoc analysis of collected trace hops, gated behind `mode: "analytical"`
- Three insight kinds:
  - **Convergence**: 3+ source types appear in results → topic is discussed across silos
  - **Evidence chain**: True root-to-leaf paths via `parentHopIndex` crossing 3+ source types (e.g., Slack → Issue → PR → Code). Deduped by type sequence, capped at 3.
  - **Temporal cluster**: >50% of timestamped results are from the last 30 days → active topic
- Each insight has: `kind`, `summary` (human-readable), `hopIndices`, `strength` (0-1)
- `TraceResult.insights` is always present (empty array in discovery mode)
- 11 tests covering all insight types, DFS branching, and edge cases

### Query

**query()** (`query.ts`):
- Simple semantic search — embed query, find nearest chunks, return ranked
- No edge following (use trace() for that)
- Configurable: topK, minScore
- AbortSignal support
- 7 tests

## User Scenarios Validated

| Scenario | Status | Evidence |
|----------|--------|----------|
| Embed text locally (MiniLM 384d) | ✅ | Tests + e2e demo |
| Embed via LM Studio (mxbai 1024d) | ✅ | E2e demo, 0.86 top score on PDP docs |
| Embed via Ollama on k8s (nomic 768d) | ✅ | E2e demo, 0.72 top score |
| Vector search with topK | ✅ | Tests + e2e |
| Trace with edge following | ✅ | Tests (bidirectional edges) |
| Trace with semantic fallback | ✅ | E2e demo (15 results across source types) |
| Cycle detection | ✅ | Tests (visited set) |
| Dimension mismatch → friendly error | ✅ | CLI catches and shows guidance |
| Query with --json output | ✅ | CLI supports --json flag |

## Key Design Decisions

1. **Trace ≠ search.** Trace follows edges + semantic fallback. Query is semantic-only. Different contracts, different output shapes.
2. **Bidirectional edge traversal.** Edges stored one-directional in segments but indexed both ways at query time. Forward: `sourceId → targetId`. Reverse: `targetId → sourceId` with `← evidence` prefix.
3. **Auto-detect dimensions.** OpenAI embedder doesn't hardcode dimensions — detects from first API response. Works with any model.
4. **Model-centric, not server-centric.** CLI flags are `--embedder-url` + `--embedder-model`, not `--embedder lmstudio`. What matters is the model, not the server software.
5. **Dimension mismatch is a user error, not a crash.** CLI detects and shows actionable guidance before running trace/query.

## Dependencies

- `@wtfoc/common` — Embedder, VectorIndex, Edge, Segment interfaces
- `@huggingface/transformers` — local CPU embeddings
- `@wtfoc/store` — download segments for collection loading (peer dep)

## Tests

47 tests total across embedders (13), vector index (6), trace (11), insights (11), query (7).
