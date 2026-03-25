# Implementation Plan: Edge Extraction Beyond Regex

**Branch**: `117-edge-extraction-pipeline` | **Date**: 2026-03-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/117-edge-extraction-pipeline/spec.md`
**Review**: Cross-reviewed by Codex (gpt-5.4) and Cursor. All findings addressed below.

## Summary

Replace the regex-only `EdgeExtractor` with a layered, composable extraction pipeline. The async `EdgeExtractor` interface feeds a `CompositeEdgeExtractor` that orchestrates: (1) regex baseline, (2) heuristic link detection (Slack/Jira/markdown), (3) tree-sitter code analysis, and (4) optional LLM-based semantic extraction via any OpenAI-compatible endpoint. Edges are deduplicated by canonical key, confidence-calibrated by tier, and provenance-tracked.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >=24
**Primary Dependencies**: vitest, @qdrant/js-client-rest, commander, valibot; NEW: web-tree-sitter (code parsing), raw fetch (LLM calls)
**Storage**: Local filesystem + optional FOC; Qdrant for vectors
**Testing**: vitest — unit tests with mocks, golden fixtures for edge extraction
**Target Platform**: CLI + MCP server + web API (Node.js server)
**Project Type**: Monorepo library + CLI + web service
**Performance Goals**: Non-LLM extractors within 20% of regex-only throughput (SC-003); LLM runs in background
**Constraints**: No cloud API required by default; LLM fail-open; AbortSignal on all async ops
**Scale/Scope**: Hundreds to thousands of chunks per collection; LLM batches of 2k-6k tokens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | ✅ PASS | EdgeExtractor is an existing seam in `@wtfoc/common`. Composed extractors are pluggable. LLM extractor uses any OpenAI-compatible endpoint. |
| II. Standalone Packages | ✅ PASS | Edge extraction stays in `@wtfoc/ingest`. LLM client is a thin wrapper, not a new package. |
| III. Backend-Neutral Identity | ✅ PASS | No storage identity changes. |
| IV. Immutable Data, Mutable Index | ✅ PASS | Segments remain immutable. Post-ingest LLM edges stored in an overlay edge file (mutable index). Provenance added as optional field on Edge schema (additive, backwards-compatible). |
| V. Edges Are First-Class | ✅ PASS | This feature directly strengthens edge coverage and quality. Preserves evidence + confidence model. |
| VI. Test-First | ✅ PASS | Golden fixtures for heuristic patterns. Mock OpenAI responses for LLM extractor. |
| VII. Bundle Uploads | N/A | No storage changes. |
| VIII. Ship-First, Future-Aware | ✅ PASS | Layered approach ships heuristics first (immediate value), LLM later (optional enhancement). |
| AbortSignal on all async interfaces | ✅ PASS | FR-001 requires signal support. Signal wired from CLI/MCP through to extractors. |
| No `any`, no non-null assertions | ✅ PASS | Enforced by biome. |
| Conventional commits | ✅ PASS | Will use `feat(ingest):` scope. |

**Gate result: PASS — no violations.**

## Breaking Changes

This feature introduces two breaking interface changes:
- `EdgeExtractor.extract()`: sync → async
- `SourceAdapter.extractEdges()`: sync → async

Both are in `@wtfoc/common`. Requires a **minor version bump** (0.x SemVer). Add CHANGELOG entry.

## Supersedes

This plan **supersedes** the dedup rules in `002-ingest-pipeline/spec.md` (which used `(type, sourceId, targetId)` without `targetType`). The canonical dedup key is now `(type, sourceId, targetType, targetId)` per FR-015.

## Project Structure

### Documentation (this feature)

```text
specs/117-edge-extraction-pipeline/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: technology research
├── data-model.md        # Phase 1: entity model
├── contracts/           # Phase 1: interface contracts
│   ├── edge-extractor.ts      # Async EdgeExtractor interface
│   ├── source-adapter.ts      # Updated SourceAdapter interface
│   ├── composite-extractor.ts # CompositeEdgeExtractor contract
│   └── llm-extractor-config.ts # LLM config schema
├── quickstart.md        # Phase 1: developer quickstart
└── checklists/
    └── requirements.md  # Quality checklist
```

### Source Code (repository root)

```text
packages/common/src/
├── interfaces/
│   ├── edge-extractor.ts     # MODIFY: sync → async interface
│   └── source-adapter.ts     # MODIFY: extractEdges sync → async
└── schemas/
    └── edge.ts               # MODIFY: add optional provenance field

packages/ingest/src/
├── edges/
│   ├── extractor.ts          # EXISTING: RegexEdgeExtractor (update to async)
│   ├── extractor.test.ts     # EXISTING: update for async
│   ├── heuristic.ts          # NEW: HeuristicEdgeExtractor
│   ├── heuristic.test.ts     # NEW: tests
│   ├── tree-sitter.ts        # NEW: TreeSitterEdgeExtractor
│   ├── tree-sitter.test.ts   # NEW: tests
│   ├── llm.ts                # NEW: LlmEdgeExtractor
│   ├── llm.test.ts           # NEW: tests
│   ├── composite.ts          # NEW: CompositeEdgeExtractor
│   ├── composite.test.ts     # NEW: tests
│   └── merge.ts              # NEW: dedup/merge/confidence logic
└── adapters/
    ├── github/adapter.ts     # MODIFY: extractEdges → async
    ├── repo/adapter.ts       # MODIFY: extractEdges → async
    ├── slack.ts              # MODIFY: extractEdges → async
    ├── discord.ts            # MODIFY: extractEdges → async
    ├── hackernews.ts         # MODIFY: extractEdges → async
    └── website.ts            # MODIFY: extractEdges → async

packages/cli/src/
├── helpers.ts                # MODIFY: add withExtractorOptions(), createLlmClient()
└── commands/
    ├── ingest.ts             # MODIFY: wire CompositeEdgeExtractor, pass extractor config
    └── extract-edges.ts      # NEW: standalone LLM re-extraction command

packages/mcp-server/src/
└── tools/ingest.ts           # MODIFY: await async extractEdges

packages/store/src/
└── e2e-pipeline.test.ts      # MODIFY: await async extract calls

packages/ingest/README.md     # MODIFY: update code example
```

**Structure Decision**: All edge extraction code lives in `packages/ingest/src/edges/`. No new packages. LLM client is a thin fetch wrapper in the same directory.

## Adapter `extractEdges()` Migration Strategy

Current state: each adapter has its own `extractEdges()` that creates a `RegexEdgeExtractor` internally and may add source-specific edges (e.g., repo adapter adds file-relationship edges).

**Decision**: Adapter `extractEdges()` remains for **source-specific edges only** (edges that require adapter-internal state, like PR changed-file edges). The `CompositeEdgeExtractor` handles all pattern-based extraction (regex, heuristic, LLM). The CLI/MCP ingest path changes from:
```
edges = [...adapter.extractEdges(chunks), ...edgeExtractor.extract(chunks)]
```
to:
```
edges = [...await adapter.extractEdges(chunks), ...await compositeExtractor.extract(chunks)]
```
Adapters that currently just delegate to `RegexEdgeExtractor` (slack, discord, hackernews, website) should return `[]` and let the composite handle it. GitHub and repo adapters keep source-specific edges (changed-file edges, import edges from file walking).

## LLM Edge Persistence Design

**Problem**: Segments are immutable. LLM extraction runs in background, after ingest. Where do LLM edges go?

**Solution**: Overlay edge file stored alongside the collection manifest.
- Path: `~/.wtfoc/projects/<collection>/edges-overlay.json`
- Contains edges produced by post-ingest extractors (LLM)
- Loaded at mount time and merged with segment edges
- On next full ingest, overlay edges are folded into new segments and the overlay is cleared
- Single-writer assumption (same as manifests). Atomic write via temp file + rename.

This preserves segment immutability while allowing incremental edge enrichment.

## Implementation Phases

### Phase 1: Async Interface + Composite Orchestrator (P1)
1. Change `EdgeExtractor.extract()` to async with `AbortSignal` in `@wtfoc/common`
2. Change `SourceAdapter.extractEdges()` to async in `@wtfoc/common`
3. Add optional `provenance?: string[]` field to `Edge` schema
4. Update `RegexEdgeExtractor` to return `Promise<Edge[]>`
5. Update **all** adapters: github, repo, slack, discord, hackernews, website
6. Update **all** call sites: CLI ingest, MCP ingest, e2e tests, README examples
7. Wire `AbortSignal` from CLI/MCP through to extractors end-to-end
8. Implement `CompositeEdgeExtractor` with merge/dedup (JSON-stable-stringify keys, not `|` delimiter)
9. Wire into CLI ingest command
10. Add per-edge `provenance` in merge output
11. Add CHANGELOG entry for breaking interface changes
12. Cap edges per chunk (max 100) to prevent memory exhaustion from massive link lists

### Phase 2: Heuristic Extractor (P1)
1. Implement `HeuristicEdgeExtractor` (Slack permalinks, Jira keys, markdown links)
2. Add to default `CompositeEdgeExtractor` pipeline
3. Golden fixture tests
4. FR-011/FR-012 concrete deliverables: extraction prompt template, few-shot example set

### Phase 3: Tree-sitter Code Extractor (P2)
1. Add `web-tree-sitter` dependency with grammar WASM files **npm-bundled** (not fetched at runtime)
2. Implement `TreeSitterEdgeExtractor` for TS/JS/Python imports
3. Parse `package.json` deps with JSON parser (not tree-sitter). Parse `requirements.txt` with line parser (not JSON).
4. Wire for `sourceType: "code"` chunks only
5. Narrow FR-005 v1 to **imports and dependency declarations only** (symbol references deferred)

### Phase 4: LLM Extractor + Config (P3)
1. Add extractor config schema — **discriminated union**: `{ enabled: false }` | `{ enabled: true, url, model, ... }`
2. CLI flags (`--extractor-url`, `--extractor-model`, etc.) using **base URL** pattern matching embedder (e.g. `http://localhost:1234/v1`, appends `/chat/completions`)
3. Implement `LlmEdgeExtractor` with OpenAI-compatible fetch client
4. Structured prompt with 2-4 few-shot examples (FR-011)
5. JSON mode with three-tier fallback parsing (FR-011)
6. Artifact-context batching with `contextId`/`contextHash` tracking (FR-012)
7. Incremental extraction status tracking per **extraction context** (not just per chunk)
8. Overlay edge persistence (edges-overlay.json) with atomic writes
9. **Non-blocking** ingest: LLM extraction enqueued as background work, does not block ingest completion. Edges land in overlay file, merged at next mount. (FR-009)
10. Fail-open behavior: LLM failure = logged warning, no user-facing error (FR-008)
11. New `wtfoc extract-edges` CLI command for standalone LLM re-extraction
12. Temperature 0 + optional seed for determinism
13. Rate limiting with semaphore (maxConcurrency), timeouts, max tokens per request

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Async interface breaks many call sites | Medium | Medium | Full migration checklist: 6 adapters, 2 ingest paths, 3 e2e test files, 1 README. Mechanical change. |
| Tree-sitter WASM binary size | Low | Low | Grammars npm-bundled, loaded lazily per detected language. |
| LLM JSON parsing unreliable across servers | High | Medium | Three-tier fallback: constrained → plain → fenced block repair. |
| Heuristic false positives (Jira patterns in non-Jira contexts) | Medium | Low | High confidence threshold (0.8-0.9) + canonical dedup. |
| LLM hallucinated edges | High | High | Require evidence quoting source span. Reject empty evidence. Low confidence tier. |
| Overlay edge file corruption | Low | Medium | Atomic write (temp + rename). Single-writer assumption documented. |
| Adapter extractEdges() double-counting with composite | Medium | High | Clear migration: adapters return source-specific edges only, composite handles patterns. |
| Regex inferred confidence 0.5 conflicts with FR-018 tier "1.0" | N/A | N/A | Resolved: FR-018 updated to "regex explicit = 1.0, regex inferred = 0.5". Inferred behavior preserved. |

## Future Work (out of scope, cross-linked)

- **Background enrichment orchestration**: Auto-trigger LLM extraction after ingest (e.g. `--enrich` flag, daemon mode, cron). The extraction pipeline provides the primitives (overlay store, incremental status, re-runnable command, fail-open). Orchestration composes them. See #3 for context.
- **Symbol reference edges**: Tree-sitter can extract function/class references beyond imports. Deferred from FR-005 v1.

## Confidence Tier Resolution

FR-018 is updated to reflect current regex behavior:
- **Regex explicit** (pattern match with known repo context): 1.0
- **Regex inferred** (bare `#N` resolved via batch affinity): 0.5
- **Tree-sitter deterministic**: 0.95-1.0
- **Heuristic structural**: 0.8-0.9
- **LLM explicit** (with quoted evidence): 0.6-0.8
- **LLM inferred**: 0.3-0.6
- **Agreement boost**: +0.05 per additional agreeing extractor (capped at 1.0). Merged confidence may exceed per-extractor band.
