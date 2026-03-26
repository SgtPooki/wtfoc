# Demo: LLM Edge Extraction Pipeline

This demo shows the full edge extraction and materialization workflow:
**ingest -> extract-edges -> materialize-edges -> promote**

## What it demonstrates

1. **extract-edges** — LLM-based semantic relationship extraction from ingested content
2. **Runtime merge** — Overlay edges are automatically used by `trace` and `serve` without materialization
3. **materialize-edges** — Bake overlay edges into immutable segment data for FOC storage
4. **promote** — Upload segments with full edge data to Filecoin

## Prerequisites

- An existing collection (e.g. `wtfoc-quick-start` from the Quick Start demo)
- An OpenAI-compatible LLM endpoint for edge extraction (e.g. LM Studio, Ollama, vLLM)

## The Pipeline

### Step 1: Ingest content

```bash
wtfoc ingest repo SgtPooki/wtfoc -c my-collection
```

This creates segments with regex/heuristic edges (GitHub refs, import statements, etc.). These edges are high-confidence but limited in scope.

### Step 2: Extract LLM edges

Use any OpenAI-compatible endpoint. Three options:

**Option A: Claude via direct proxy (recommended — fast, no API key needed)**

```bash
# Terminal 1: start the proxy (uses your Claude Code subscription)
node scripts/claude-direct-proxy.mjs

# Terminal 2: extract edges
wtfoc extract-edges -c my-collection \
  --extractor-url http://localhost:4523/v1 \
  --extractor-model haiku
```

The proxy reads your Claude Code OAuth token from `~/.claude/.credentials.json` and forwards requests directly to the Anthropic API. ~0.8s per request, auto-refreshes tokens. See `scripts/claude-direct-proxy.mjs`.

**Option B: Local LLM (LM Studio, Ollama, vLLM)**

```bash
wtfoc extract-edges -c my-collection \
  --extractor-url http://localhost:8000/v1 \
  --extractor-model qwen3-32b
```

**Option C: Any OpenAI-compatible API**

```bash
wtfoc extract-edges -c my-collection \
  --extractor-url https://api.openai.com/v1 \
  --extractor-model gpt-4o \
  --extractor-key sk-...
```

This runs each source context through an LLM to discover semantic relationships like `implements`, `depends-on`, `part-of`, `mentions`, etc. Extracted edges are written to a **sidecar overlay file** — the immutable segments are not modified.

Key features:
- **Parallel**: `--context-concurrency 4` (default) processes 4 contexts simultaneously
- **Incremental**: Re-running skips already-processed contexts
- **Resumable**: Safe to interrupt and resume
- **Fail-open**: LLM failures don't block the pipeline

Check status after extraction:

```bash
wtfoc status -c my-collection
# Output includes:
#   Overlay edges: 711 (run materialize-edges to bake into segments)
```

### Step 3: Verify with trace (optional)

Overlay edges are automatically loaded by `trace` and `serve` at runtime:

```bash
wtfoc trace "how does the ingest pipeline work" -c my-collection
# Output includes:
#   Loaded 711 overlay edges from extract-edges
```

You can iterate: run `extract-edges` again with a different model or after adding new content. The overlay accumulates.

### Step 4: Materialize into segments

When you're satisfied with the overlay edges, bake them into the immutable segment data:

```bash
# Preview first
wtfoc materialize-edges -c my-collection --dry-run

# Then materialize
wtfoc materialize-edges -c my-collection
```

This rebuilds affected segments with merged edges and clears the overlay file. After materialization, the edges are part of the segment data and will survive promote/fetch.

### Step 5: Promote to FOC

```bash
wtfoc promote my-collection
```

If you forget to materialize first, promote will warn you:

```
  1234 overlay edges from extract-edges have not been materialized.
  These edges will NOT be included in the promoted data unless you materialize first:
  wtfoc materialize-edges -c my-collection
```

## Edge type comparison

| Source | Types | Confidence | Examples |
|--------|-------|------------|---------|
| Regex extractor | `references`, `closes` | 1.0 | `#123`, `Fixes #456` |
| Heuristic extractor | `references` | 0.8-0.9 | Slack permalinks, Jira keys |
| Code extractor | `imports`, `depends-on` | 0.95-1.0 | JS/TS/Python/Go imports |
| LLM extractor | `implements`, `part-of`, `mentions`, `uses`, `defines`, ... | 0.3-0.8 | Semantic relationships |

## Re-ingesting after changes

If you re-ingest (e.g. after adding `.wtfocignore` patterns), the segments are rebuilt with new chunk IDs. The extraction status and overlay are invalidated because chunk content hashes change. The correct workflow is:

```bash
wtfoc ingest repo ... -c my-collection    # Fresh segments, new chunk IDs
wtfoc extract-edges -c my-collection ...  # Re-extract (detects changed hashes)
wtfoc materialize-edges -c my-collection  # Bake in
wtfoc promote my-collection               # Upload to FOC
```

## Run the automated demo

```bash
./docs/demos/edge-extraction/run.sh
```

This runs the full pipeline on the `wtfoc-quick-start` collection using a local LLM.
