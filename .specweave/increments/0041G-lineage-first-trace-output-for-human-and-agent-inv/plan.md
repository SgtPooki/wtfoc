# Plan: Lineage-first trace output

**Increment**: 0041G-lineage-first-trace-output-for-human-and-agent-inv
**Status**: Planned

## Architecture

Changes follow the existing package dependency chain:

```
@wtfoc/common (types) → @wtfoc/search (logic) → @wtfoc/cli (formatting) + @wtfoc/mcp-server (JSON)
```

### New modules

- `packages/search/src/trace/lineage.ts` — `buildLineageChains()`: reconstructs DFS tree paths from `hops[]` via `parentHopIndex`. Same approach as `detectEvidenceChains` in insights.ts but extracted as reusable utility.
- `packages/search/src/trace/conclusion.ts` — `buildConclusion()`: heuristic-based agent conclusion block. Uses edge types (`closes`, `addresses`) to identify candidate fixes, seed confidence for primary artifact.

### Modified modules

- `packages/search/src/trace/trace.ts` — Add `timestamp?` to TraceHop, `lineageChains` and `conclusion?` to TraceResult, `TraceView` type
- `packages/search/src/trace/indexing.ts` — Carry `chunk.timestamp` into ChunkData
- `packages/search/src/trace/traversal.ts` — Populate timestamp in followEdges hop creation
- `packages/search/src/trace/insights.ts` — Refactor `detectEvidenceChains` to use `buildLineageChains`
- `packages/cli/src/commands/trace.ts` — Add `--view <lineage|timeline|evidence>` flag
- `packages/cli/src/output.ts` — Refactor into dispatcher with 3 formatters (lineage, timeline, evidence)
- `packages/mcp-server/src/tools/trace.ts` — Add optional `view` parameter

## Approach

1. **View is presentation, not data** — `trace()` always computes full TraceResult; `--view` only affects CLI rendering
2. **Additive JSON changes** — `lineageChains` and `conclusion` are new fields; existing `groups`, `hops`, `insights`, `stats` unchanged
3. **Default by mode** — analytical → lineage view, discovery → evidence view (zero change for existing users)
4. **Heuristic conclusion** — no LLM; edge-type matching for candidateFixes, seed confidence for primaryArtifact
5. **Leverage recent edge work** — directional temporal-semantic edges, canonical edge vocabulary, and structured evidence provide the data; this plan builds the presentation

## Dependencies

- Builds on parentHopIndex (already in TraceHop)
- Builds on Chunk.timestamp (already in common/schemas/chunk.ts)
- Leverages canonical edge types: `closes`, `addresses`, `references`, `changes` (already landed via a04ffd2)
- Leverages directional temporal-semantic edges: `discussed-before`, `addressed-after` (already landed via 5d7686f)

## Codex peer review changes

- T-011 (insights refactor) deferred → SgtPooki/wtfoc#211 (coupling risk with battle-tested DFS)
- T-012 (exports) folded into parent tasks (T-002, T-003, T-004, T-009)
- T-005 (conclusion) reordered AFTER T-006/T-007 (CLI/view contracts first)
- Added: conclusion optional contract, UTC timestamp grouping, --view overrides --mode, golden tests for evidence view
- Added: T-011 → integration edge case tests

## Dependency graph (tasks)

```
T-001 (timestamp) → T-002 (TraceView type + exports)
  ↓
T-003 (lineage builder + exports) → T-004 (attach to TraceResult + exports)
  ↓
T-005 (--view flag) + T-006 (evidence extraction + golden tests)
  ↓
T-007 (lineage formatter) + T-008 (timeline formatter)
  ↓
T-009 (conclusion block + exports) → T-010 (MCP)
  ↓
T-011 (integration edge case tests)
```
