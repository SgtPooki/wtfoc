# Tasks: Lineage-first trace output

**Increment**: 0041G-lineage-first-trace-output-for-human-and-agent-inv
**Tasks**: 11 | **Codex peer review**: incorporated (3 HIGH, 5 MEDIUM addressed)
**Deferred**: Insights DFS refactor (originally T-011 in plan) → SgtPooki/wtfoc#211

### T-001: Add timestamp to TraceHop
**User Story**: US-005 | **Satisfies ACs**: AC-US5-01 | **Status**: [x] completed
**Implementation**: Add `timestamp?: string` to TraceHop interface. Carry `chunk.timestamp` through ChunkData in indexing.ts. Populate in traversal.ts followEdges and trace.ts seed/fallback hop creation.
**Files**: `packages/search/src/trace/trace.ts`, `packages/search/src/trace/indexing.ts`, `packages/search/src/trace/traversal.ts`
**Test Plan**: Given segments with timestamped chunks → When trace runs → Then TraceHop objects carry the timestamp field. Given chunks without timestamps → When trace runs → Then timestamp is undefined (not null, not crash).

### T-002: Add TraceView type and export from barrels
**User Story**: US-001, US-002, US-003 | **Satisfies ACs**: AC-US1-02, AC-US3-02 | **Status**: [x] completed
**Implementation**: Add `export type TraceView = "lineage" | "timeline" | "evidence"` to trace.ts. Export from `packages/search/src/trace/index.ts` and `packages/search/src/index.ts`.
**Files**: `packages/search/src/trace/trace.ts`, `packages/search/src/trace/index.ts`, `packages/search/src/index.ts`
**Test Plan**: Given TraceView type exported → When imported from @wtfoc/search → Then type is available

### T-003: Build lineage chain reconstruction
**User Story**: US-006 | **Satisfies ACs**: AC-US6-01 | **Status**: [x] completed
**Implementation**: New file `lineage.ts`. Define `LineageChain` interface with `hopIndices`, `typeSequence`, `sourceTypeDiversity`. Implement `buildLineageChains(hops)` — walk DFS tree via parentHopIndex, extract root-to-leaf paths, sort by length desc then diversity desc. `typeSequence` deduplicates consecutive repeated sourceTypes (e.g., pr→pr→code becomes ["pr","code"]). Unknown sourceTypes pass through as-is. Export from barrel files.
**Files**: NEW `packages/search/src/trace/lineage.ts`, NEW `packages/search/src/trace/lineage.test.ts`, `packages/search/src/trace/index.ts`
**Test Plan**: Given hops with parentHopIndex links → When buildLineageChains called → Then returns chains sorted by length with correct type sequences. Given branching DFS → Then produces separate chains. Given seed-only hops (no parentHopIndex) → Then produces single-hop chains. Given empty array → Then returns empty. Given consecutive repeated sourceTypes → Then typeSequence deduplicates them. Given zero hops → Then returns [].

### T-004: Attach lineageChains to TraceResult
**User Story**: US-006 | **Satisfies ACs**: AC-US6-01 | **Status**: [x] completed
**Implementation**: Add `lineageChains: LineageChain[]` to TraceResult interface. Call `buildLineageChains(hops)` in trace() after insight detection. Always computed (cheap, not mode-gated) — available in both discovery and analytical JSON. Export LineageChain from barrel files.
**Files**: `packages/search/src/trace/trace.ts`, `packages/search/src/index.ts`
**Test Plan**: Given a trace query with edge traversal → When trace() returns → Then result.lineageChains is populated. Given discovery mode → When trace() returns → Then lineageChains is still present (always computed).

### T-005: Add --view flag to trace command
**User Story**: US-001, US-003 | **Satisfies ACs**: AC-US1-02, AC-US3-02 | **Status**: [x] completed
**Implementation**: Add `.option('--view <view>', ...)` to trace command. Validate: lineage|timeline|evidence. Default: lineage for analytical, evidence for discovery. **Explicit --view always overrides mode default.** Pass view to formatTrace().
**Files**: `packages/cli/src/commands/trace.ts`
**Test Plan**: Given `--view lineage` flag → When trace runs → Then formatTrace receives view="lineage". Given no --view with --mode analytical → Then view defaults to "lineage". Given `--mode discovery --view lineage` → Then explicit --view wins (lineage, not evidence).

### T-006: Extract current output as evidence formatter + golden tests
**User Story**: US-003 | **Satisfies ACs**: AC-US3-01 | **Status**: [x] completed
**Implementation**: Refactor formatTrace() into dispatcher. Extract current grouped-by-sourceType body into `formatTraceEvidence()`. Route when view === "evidence". Zero behavior change. Add snapshot/golden tests for evidence output with both modes, --json, and --quiet to enforce "unchanged" contract.
**Files**: `packages/cli/src/output.ts`, NEW `packages/cli/src/output.test.ts`
**Test Plan**: Given a TraceResult with multiple source types → When formatTraceEvidence called → Then output matches existing grouped format exactly (golden snapshot). Given --json format → Then raw JSON unchanged. Given --quiet → Then empty string.

### T-007: Implement lineage formatter
**User Story**: US-001 | **Satisfies ACs**: AC-US1-01, AC-US1-03 | **Status**: [x] completed
**Implementation**: Add `formatTraceLineage(result)` to output.ts. For each chain: header with type sequence (deduplicated consecutive types, unknown types pass through as-is), then numbered hops with sourceType/source/confidence/snippet/edge-type/URL. Orphan hops (not in any chain) in "Related context" section. Insights after chains in analytical mode.
**Files**: `packages/cli/src/output.ts`, `packages/cli/src/output.test.ts`
**Test Plan**: Given TraceResult with lineageChains → When formatTraceLineage called → Then output shows numbered chains with type sequence headers. Given orphan hops → Then "Related context" section appears. Given zero hops → Then graceful empty output. Given all single-hop chains → Then each renders without chain header.

### T-008: Implement timeline formatter
**User Story**: US-002 | **Satisfies ACs**: AC-US2-01, AC-US2-02 | **Status**: [x] completed
**Implementation**: Add `formatTraceTimeline(result)` to output.ts. Global sort of ALL hops by timestamp (not per-chain). Group by UTC calendar date (YYYY-MM-DD headers). Invalid/malformed timestamps treated as undated. Undated hops in "(no timestamp)" group at end. Stable sort: ties broken by hop index.
**Files**: `packages/cli/src/output.ts`
**Test Plan**: Given hops with timestamps across multiple days → When formatTraceTimeline called → Then output groups by UTC date chronologically. Given undated hops → Then they appear at end. Given all hops on same day → Then single date header. Given all undated → Then just "(no timestamp)" group. Given malformed timestamp → Then treated as undated, no crash.

### T-009: Build agent conclusion block
**User Story**: US-004 | **Satisfies ACs**: AC-US4-01, AC-US4-02 | **Status**: [x] completed
**Implementation**: New file `conclusion.ts`. `conclusion` is optional on TraceResult — omitted when no reliable signal exists (not always-present with empty arrays). `buildConclusion(hops, chains)`: primaryArtifact from highest-confidence seed hop, candidateFixes from edge-based hops (not semantic) with `closes`/`addresses` edge types, relatedContext from orphan hops not in chains, recommendedNextReads from chain leaf hops. Computed in analytical mode only. Returns undefined if no hops. Export from barrel files.
**Files**: NEW `packages/search/src/trace/conclusion.ts`, NEW `packages/search/src/trace/conclusion.test.ts`, `packages/search/src/trace/trace.ts`, `packages/search/src/trace/index.ts`
**Test Plan**: Given hops with closes/addresses edges → When buildConclusion called → Then candidateFixes includes those hops. Given seed hop → Then primaryArtifact is the seed. Given hops not in any chain → Then relatedContext includes them. Given zero hops → Then returns undefined. Given no closes/addresses edges → Then candidateFixes is empty array, conclusion still returned with primaryArtifact.

### T-010: Update MCP trace tool
**User Story**: US-004 | **Satisfies ACs**: AC-US4-03 | **Status**: [x] completed
**Implementation**: Add optional `view?: TraceView` to MCP trace params schema. lineageChains and conclusion already in JSON via TraceResult. Add regression test: older clients ignoring new fields still get valid JSON.
**Files**: `packages/mcp-server/src/tools/trace.ts`
**Test Plan**: Given MCP trace call with analytical mode → When result returned → Then JSON includes lineageChains and conclusion fields. Given MCP trace without view param → Then still works (backward compat). Given discovery mode → Then lineageChains present, conclusion absent.

### T-011: Integration tests for edge cases
**User Story**: US-001, US-002, US-003, US-004 | **Satisfies ACs**: all | **Status**: [x] completed
**Implementation**: Add integration tests covering: zero hops, one hop, all undated hops, all hops on same day, lineageChains empty but groups exist, conclusion omitted in discovery mode. Verify all three formatters handle these gracefully.
**Files**: `packages/cli/src/output.test.ts`, `packages/search/src/trace/trace.test.ts`
**Test Plan**: Given zero hops → When each formatter called → Then no crash, graceful empty output. Given one hop → Then single-item display. Given lineageChains empty → Then lineage view shows only "Related context".
