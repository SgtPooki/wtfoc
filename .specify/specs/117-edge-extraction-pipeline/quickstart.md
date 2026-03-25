# Quickstart: Edge Extraction Pipeline

## Development Setup

```bash
# From repo root
pnpm install
pnpm build
```

## Running Tests

```bash
# All edge extraction tests
pnpm vitest run packages/ingest/src/edges/

# Specific extractor
pnpm vitest run packages/ingest/src/edges/heuristic.test.ts
pnpm vitest run packages/ingest/src/edges/composite.test.ts
```

## Using the Composite Extractor

```typescript
import { CompositeEdgeExtractor } from "@wtfoc/ingest";
import { RegexEdgeExtractor, HeuristicEdgeExtractor } from "@wtfoc/ingest";

const composite = new CompositeEdgeExtractor();
composite.register({ name: "regex", extractor: new RegexEdgeExtractor() });
composite.register({ name: "heuristic", extractor: new HeuristicEdgeExtractor() });

const edges = await composite.extract(chunks);
```

## Enabling LLM Extraction

### Via CLI flags
```bash
# Base URL pattern (same as --embedder-url). /chat/completions appended automatically.
wtfoc ingest repo ./my-project \
  --collection my-collection \
  --extractor-url http://localhost:1234/v1 \
  --extractor-model Qwen2.5-Coder-32B-Instruct \
  --extractor-enabled
```

### Via environment variables
```bash
export WTFOC_EXTRACTOR_URL=http://localhost:1234/v1
export WTFOC_EXTRACTOR_MODEL=Qwen2.5-Coder-32B-Instruct
export WTFOC_EXTRACTOR_ENABLED=true
wtfoc ingest repo ./my-project --collection my-collection
```

### Via .wtfoc.json
```json
{
  "edgeExtraction": {
    "enabled": true,
    "url": "http://localhost:1234/v1",
    "model": "Qwen2.5-Coder-32B-Instruct",
    "jsonMode": "auto",
    "timeoutMs": 20000,
    "maxConcurrency": 4
  }
}
```

## Re-running Failed LLM Extraction

```bash
# Re-runs only failed + pending extraction contexts (not individual chunks)
# LLM edges stored in overlay file, merged at mount time
wtfoc extract-edges --collection my-collection \
  --extractor-url http://localhost:1234/v1 \
  --extractor-model Qwen2.5-Coder-32B-Instruct
```

## Confidence Tiers

| Extractor | Confidence | Edge Types |
|-----------|-----------|------------|
| Regex (explicit) | 1.0 | references, closes, changes |
| Regex (inferred) | 0.5 | references (bare #N resolved via batch affinity) |
| Tree-sitter | 0.95-1.0 | imports, depends-on |
| Heuristic | 0.8-0.9 | references (Slack/Jira/markdown links) |
| LLM explicit | 0.6-0.8 | any type with quoted evidence |
| LLM inferred | 0.3-0.6 | semantic relationships |
| Multi-extractor agreement | +0.05/extractor | boost when extractors converge (capped at 1.0) |

## Key Files

| File | Purpose |
|------|---------|
| `packages/common/src/interfaces/edge-extractor.ts` | Async interface |
| `packages/ingest/src/edges/extractor.ts` | RegexEdgeExtractor |
| `packages/ingest/src/edges/heuristic.ts` | HeuristicEdgeExtractor |
| `packages/ingest/src/edges/tree-sitter.ts` | TreeSitterEdgeExtractor |
| `packages/ingest/src/edges/llm.ts` | LlmEdgeExtractor |
| `packages/ingest/src/edges/composite.ts` | CompositeEdgeExtractor |
| `packages/ingest/src/edges/merge.ts` | Dedup/merge logic |
| `packages/cli/src/helpers.ts` | CLI flag definitions |
