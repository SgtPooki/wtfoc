# Data Model: Edge Extraction Pipeline

**Feature**: 117-edge-extraction-pipeline | **Date**: 2026-03-25

## Entities

### Edge (existing — additive change)

| Field | Type | Description |
|-------|------|-------------|
| type | string | Relationship type: "references", "closes", "changes", "imports", "depends-on", or custom |
| sourceId | string | Chunk ID of the source artifact |
| targetType | string | Type of target: "issue", "file", "jira-ticket", "slack-message", "module", "package" |
| targetId | string | Repo-scoped target ID (e.g. "owner/repo#142", "PROJ-123") |
| evidence | string | Human-readable explanation (may contain merged evidence from multiple extractors) |
| confidence | number | 1.0 = explicit regex, <1.0 = semantic/inferred |
| provenance | string[]? | **NEW** — Optional list of extractor names that contributed to this edge. Persisted in segments. |

### ExtractorResult (new — internal)

| Field | Type | Description |
|-------|------|-------------|
| extractorName | string | Name of the extractor that produced these edges |
| edges | Edge[] | Edges produced by this extractor |
| confidenceTier | [number, number] | Min/max confidence range for this extractor |

### MergedEdge (new — internal)

| Field | Type | Description |
|-------|------|-------------|
| edge | Edge | The final deduplicated edge |
| provenance | Set\<string\> | Set of extractor names that found this edge |
| evidenceParts | string[] | Individual evidence strings before merging |

### ExtractionStatus (new — for incremental LLM extraction)

| Field | Type | Description |
|-------|------|-------------|
| extractorModel | string | Model used for extraction (re-run all if model changes) |
| contexts | Record\<string, ContextStatus\> | Per-context extraction status |

### ContextStatus (new — tracks extraction contexts, not individual chunks)

| Field | Type | Description |
|-------|------|-------------|
| contextId | string | Identifier for the extraction context (e.g. "pr:owner/repo#42", "slack-thread:C01ABC/p123") |
| contextHash | string | Hash of all chunk contents in this context (invalidated if any chunk changes) |
| chunkIds | string[] | Chunk IDs in this extraction context |
| status | "pending" \| "completed" \| "failed" | Extraction status |
| edgeCount | number? | Number of edges extracted (when completed) |
| error | string? | Error message (when failed) |
| timestamp | string? | ISO timestamp of last status change |

### OverlayEdgeStore (new — for post-ingest LLM edges)

| Field | Type | Description |
|-------|------|-------------|
| collectionId | string | Collection this overlay belongs to |
| edges | Edge[] | Post-ingest edges (with provenance) |
| createdAt | string | ISO timestamp |
| updatedAt | string | ISO timestamp |

**Storage**: `~/.wtfoc/projects/<collection>/edges-overlay.json`. Atomic writes via temp file + rename. Single-writer assumption (same as manifests). Cleared on next full ingest.

### ExtractorConfig (new — for LLM extractor)

| Field | Type | Description |
|-------|------|-------------|
| enabled | boolean | Whether LLM extraction is active |
| provider | string | Always "openai-compatible" for v1 |
| url | string | Chat completions endpoint URL |
| model | string | Model name |
| apiKey | string? | API key (optional for local servers) |
| jsonMode | "auto" \| "on" \| "off" | JSON response format mode |
| timeoutMs | number | Request timeout (default: 20000) |
| maxConcurrency | number | Max parallel LLM requests (default: 4) |
| maxInputTokens | number | Max tokens per request (default: 4000) |

## Relationships

```
Chunk --[1:N]--> Edge (via EdgeExtractor.extract())
Edge --[N:1]--> MergedEdge (via deduplication on canonical key)
MergedEdge --[N:N]--> ExtractorResult (via provenance tracking)
Collection --[1:1]--> ExtractionStatus (for incremental LLM tracking)
```

## State Transitions

### ChunkStatus lifecycle
```
pending → completed  (extraction succeeded)
pending → failed     (extraction error/timeout)
failed  → completed  (re-run succeeded)
failed  → failed     (re-run failed again)
completed → pending  (chunk content changed, needs re-extraction)
```

## Validation Rules

- Edge.confidence MUST be in [0.0, 1.0]
- Edge.evidence MUST be non-empty (LLM edges with empty evidence are rejected)
- Edge.type MUST be a non-empty string
- ExtractorConfig.url MUST be a valid URL starting with "http"
- ExtractorConfig.model MUST be non-empty when enabled is true
- ExtractorConfig.timeoutMs MUST be > 0
- ExtractorConfig.maxConcurrency MUST be >= 1
