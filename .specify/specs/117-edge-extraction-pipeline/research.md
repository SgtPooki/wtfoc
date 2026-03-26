# Research: Edge Extraction Beyond Regex

**Feature**: 117-edge-extraction-pipeline | **Date**: 2026-03-25

## R-001: Tree-sitter for Code Edge Extraction

**Decision**: Use `web-tree-sitter` (WASM-based) for AST parsing of import/dependency edges.

**Rationale**: Tree-sitter provides fast, incremental, fault-tolerant parsing across languages. The WASM variant (`web-tree-sitter`) runs in Node.js without native compilation. Language grammars load lazily — only the grammars needed for detected languages are fetched.

**Alternatives considered**:
- `@babel/parser` — JS/TS only, no Python/Go/Rust support
- `typescript` compiler API — TS/JS only, heavy dependency, complex API
- Regex-based import parsing — fragile, misses aliased imports, can't handle multiline
- `compromise.js` / `wink-nlp` — NLP libraries, not code parsers; poor at import resolution

**Initial language support**: TypeScript, JavaScript, Python
**Grammar packages**: `tree-sitter-typescript`, `tree-sitter-python` (npm-bundled, not fetched at runtime)
**Dependency manifest parsing**: `package.json` via JSON parser, `requirements.txt` via line parser — NOT tree-sitter (these are not code files)
**Grammar packaging**: WASM files bundled as npm dependencies, loaded lazily per detected language. No runtime fetching for offline/CI compatibility.

## R-002: LLM Client for Edge Extraction

**Decision**: Use raw `fetch()` to call `/v1/chat/completions` endpoint. No SDK dependency.

**Rationale**: The openai SDK adds 2MB+ and has opinions about error handling that conflict with fail-open semantics. A thin fetch wrapper (~100 lines) targeting the standard chat completions API is simpler, lighter, and works identically across vLLM, LM Studio, OpenAI, and any OpenAI-compatible server.

**Alternatives considered**:
- `openai` npm package — heavy, unnecessary abstraction for a single endpoint
- `@anthropic-ai/sdk` — wrong provider API format
- `ai` (Vercel SDK) — unnecessary abstraction layer, large dependency

**JSON mode strategy** (three-tier fallback):
1. Set `response_format: { type: "json_object" }` if server supports it
2. Fall back to prompt-only: "Respond with valid JSON array"
3. Fall back to fenced block extraction: parse ```json ... ``` blocks with repair

## R-003: LLM Model Recommendations

**Decision**: Recommend `Qwen2.5-Coder-32B-Instruct` (Q8) as default for local extraction.

**Rationale**: From Codex deep review — 14B-32B is the sweet spot for homelab. The coder variant has better code understanding. Q8 quantization preserves structured output quality better than Q4. User confirmed this model fits in memory on their Mac.

**Alternatives considered**:
- `Qwen2.5-72B-Instruct-Q4` — Q4 quantization degrades JSON adherence; save for background jobs
- `Llama 3.1 70B Instruct` — slower, weaker at structured extraction than Qwen per-parameter
- Specialized NER models (GLiNER, etc.) — trained for person/org/location, not repo/issue/depends-on
- `Qwen2.5-Instruct-7B` — acceptable budget fallback but higher hallucination risk

## R-004: Edge Deduplication Strategy

**Decision**: Canonical key `(type, sourceId, targetType, targetId)` with evidence merging and provenance tracking.

**Rationale**: Multiple extractors will find the same edge. Regex finds `#123`, LLM also finds it. The canonical key prevents duplicate edges in the graph. Evidence is merged (concatenated with separator). Provenance tracks which extractors contributed. Confidence uses highest-wins with agreement boost.

**Merge rules**:
- Same canonical key → single edge
- Evidence: merge from all contributing extractors, separated by ` | `
- Confidence: `max(individual confidences)` + 0.05 boost per additional agreeing extractor (capped at 1.0)
- Provenance: `Set<string>` of extractor names (internal tracking, not on public Edge schema)

## R-005: Incremental LLM Extraction

**Decision**: Track per-**extraction-context** status in a JSON file alongside the collection manifest. LLM edges stored in a separate overlay file.

**Rationale**: LLM extraction is slow, can fail mid-run, and runs after ingest. Status must track extraction contexts (PR+comments, Slack threads) not individual chunks, because FR-012 batches by artifact context. A changed comment in a PR thread invalidates the whole context, not just one chunk. LLM edges go to an overlay file because segments are immutable.

**Status file format** (`~/.wtfoc/projects/<collection>.extraction-status.json`):
```json
{
  "extractorModel": "Qwen2.5-Coder-32B-Instruct",
  "contexts": {
    "pr:owner/repo#42": {
      "contextHash": "sha256-of-all-chunk-contents",
      "chunkIds": ["chunk-abc", "chunk-def"],
      "status": "completed",
      "edgeCount": 5,
      "timestamp": "2026-03-25T..."
    },
    "slack-thread:C01ABC/p123": {
      "contextHash": "sha256...",
      "chunkIds": ["chunk-ghi"],
      "status": "failed",
      "error": "timeout",
      "timestamp": "2026-03-25T..."
    }
  }
}
```

**Overlay edge file** (`~/.wtfoc/projects/<collection>.edges-overlay.json`):
- Contains edges produced by post-ingest LLM extraction
- Merged with segment edges at mount time
- Cleared on next full ingest (edges folded into new segments)
- Atomic writes: write to temp file, rename

On re-run: skip "completed" contexts (unless contextHash changed due to chunk content change or model change), retry "failed" and "pending". If `extractorModel` differs from status file, re-run all contexts.

**Alternatives considered**:
- Per-chunk tracking — wrong granularity for context-sensitive extraction (FR-012)
- Database (SQLite, etc.) — over-engineered for this use case
- In-segment metadata — segments are immutable, can't add extraction status
- No tracking (always re-run everything) — too slow for large collections

## R-006: SourceAdapter.extractEdges() Async Migration

**Decision**: Change `SourceAdapter.extractEdges()` from sync to async: `extractEdges(chunks: Chunk[]): Promise<Edge[]>`.

**Rationale**: The SourceAdapter interface is in `@wtfoc/common` and used by all adapters. Making it async aligns with the EdgeExtractor change and allows adapters to do I/O-based extraction in the future. Breaking change but mechanical — bounded to ~6 adapter implementations + ~4 call sites.

**Migration plan**:
1. Change interface in `@wtfoc/common`
2. Add `async` to each adapter's `extractEdges()` method
3. Add `await` at each call site in CLI ingest + MCP ingest
4. Update tests

**Risk**: Low. All adapters are internal. No external consumers.
