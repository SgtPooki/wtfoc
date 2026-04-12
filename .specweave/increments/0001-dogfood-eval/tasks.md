# Tasks: Holistic dogfood evaluation skill

## Task Notation

- `[T###]`: Task ID
- `[P]`: Parallelizable with other P tasks in the same phase
- `[ ]`: Not started
- `[x]`: Completed
- Model hints: haiku (simple/mechanical), sonnet (default), opus (architectural/complex)

---

## Phase 1: Foundation — Shared Types + Ingest Evaluator

### T-001: Add shared eval types to @wtfoc/common [P]

**User Story**: US-001, US-003 | **Satisfies ACs**: AC-US1-04, AC-US1-05, FR-003
**Status**: [x] Completed

**Description**: Add `EvalStageResult`, `EvalCheck`, and `DogfoodReport` types to `packages/common/src/schemas/eval.ts` and export from `packages/common/src/index.ts`. These are the shared envelope types all stage evaluators return.

**Implementation Details**:
- Create `packages/common/src/schemas/eval.ts` with the types from plan.md:
  - `EvalCheck { name, passed, actual, expected?, detail? }`
  - `EvalStageResult { stage, startedAt, durationMs, verdict, summary, metrics, checks }`
  - `DogfoodReport { reportSchemaVersion: string, timestamp, collectionId, collectionName, stages: EvalStageResult[], verdict, durationMs }`
- Add `reportSchemaVersion: string` to `DogfoodReport` (AC-US8-01 requires `"1.0.0"`)
- Export all three types from `packages/common/src/index.ts`

**Test Plan**:
- **File**: `packages/common/src/schemas/eval.test.ts`
- **Tests**:
  - **TC-001**: Types are JSON-serializable (no circular refs, no non-serializable fields)
    - Given a fully-populated `DogfoodReport` object
    - When `JSON.stringify()` is called
    - Then it round-trips to the same shape with no errors
  - **TC-002**: `DogfoodReport.verdict` aggregation rule (fail > warn > pass)
    - Given stage results with mixed verdicts
    - When a helper `aggregateVerdict(stages)` is called
    - Then it returns "fail" if any stage failed, "warn" if any warned, else "pass"

**Dependencies**: None

---

### T-002: Implement ingest evaluator [P]

**User Story**: US-003 | **Satisfies ACs**: AC-US3-01 through AC-US3-07
**Status**: [x] Completed

**Description**: Create `packages/ingest/src/eval/ingest-evaluator.ts` implementing `evaluateIngest(segments, head)`. This is a pure data-inspection function — no LLM calls, no network access.

**Implementation Details**:
- Create directory `packages/ingest/src/eval/`
- Implement `evaluateIngest(segments: Segment[], head: CollectionHead): Promise<EvalStageResult>`:
  - Flatten all chunks across segments
  - **Chunk count + source-type distribution** (AC-US3-02): `Record<string, number>` keyed by sourceType
  - **Chunks-per-segment distribution** (AC-US3-02): min/max/mean across segments
  - **Metadata completeness** (AC-US3-03): % of chunks with non-empty `documentId`, `documentVersionId`, `contentFingerprint` — each as a separate rate; also per-source-type breakdown (AC-US3-06)
  - **Required fields check** (AC-US3-05): count chunks missing `id`, `content`, `sourceType`, or `source`; emit one `EvalCheck` per field
  - **Chunk sizing** (AC-US3-04): min/max/mean/median content length; flag chunks < 50 or > 10,000 chars as warnings in `checks`
  - **Verdict**: "fail" if any required-field violation count > 0, "warn" if any sizing warnings, "pass" otherwise
- Export `evaluateIngest` from `packages/ingest/src/index.ts`

**Test Plan**:
- **File**: `packages/ingest/src/eval/ingest-evaluator.test.ts`
- **Tests**:
  - **TC-001**: Reports correct chunk count and source-type distribution
    - Given 3 segments with 2 github chunks and 1 slack chunk each
    - When `evaluateIngest()` runs
    - Then `metrics.totalChunks === 9`, `metrics.sourceTypeDistribution.github === 6`, `.slack === 3`
  - **TC-002**: Required-field check catches missing `id`
    - Given a segment with one chunk where `id` is `""`
    - When `evaluateIngest()` runs
    - Then a check named `"required:id"` has `passed: false` and `actual: 1`
  - **TC-003**: Metadata completeness rate with full metadata
    - Given all chunks have non-empty `documentId`, `documentVersionId`, `contentFingerprint`
    - When `evaluateIngest()` runs
    - Then `metrics.documentIdRate === 1`, `metrics.documentVersionIdRate === 1`, `metrics.contentFingerprintRate === 1`
  - **TC-004**: Metadata completeness rate with partial metadata
    - Given 2 of 4 chunks have `contentFingerprint`
    - When `evaluateIngest()` runs
    - Then `metrics.contentFingerprintRate === 0.5`
  - **TC-005**: Chunk sizing flags short and long chunks
    - Given one chunk with 30 chars and one with 12000 chars
    - When `evaluateIngest()` runs
    - Then two sizing checks are `passed: false` and `verdict === "warn"`
  - **TC-006**: Verdict is "pass" for well-formed collection
    - Given segments with fully-valid chunks (required fields, valid sizes)
    - When `evaluateIngest()` runs
    - Then `result.verdict === "pass"`
  - **TC-007**: Per-source-type metadata breakdown
    - Given 2 github chunks with `documentId` and 2 slack chunks without
    - When `evaluateIngest()` runs
    - Then `metrics.perSourceType.github.documentIdRate === 1` and `.slack.documentIdRate === 0`

**Dependencies**: T-001

---

## Phase 2: Core Evaluators

### T-003: Implement edge extraction evaluator (wraps runEdgeEval) [P]

**User Story**: US-004 | **Satisfies ACs**: AC-US4-01 through AC-US4-05
**Status**: [x] Completed

**Description**: Create `packages/ingest/src/eval/edge-extraction-evaluator.ts` that wraps `runEdgeEval()` from `packages/ingest/src/edges/eval.ts`. Maps `EvalReport` → `EvalStageResult`. Do NOT modify `eval.ts`.

**Implementation Details**:
- Create `evaluateEdgeExtraction(options: EvalOptions, signal?: AbortSignal): Promise<EvalStageResult>`
- Call `runEdgeEval(options, signal)` — existing function, no changes
- Map `EvalReport` to `EvalStageResult`:
  - `stage`: `"edge-extraction"`
  - `metrics.stages`: the raw `EvalReport.stages[]` array (raw/normalized/gated `StageMetrics`)
  - `metrics.gates`: `EvalReport.gates`
  - `metrics.coverage`: `EvalReport.coverage`
  - `metrics.negatives`: `EvalReport.negatives`
  - `metrics.gatedF1`: `EvalReport.stages[2].microF1` (gated stage F1 — AC-US4-05)
  - `metrics.goldSurvivalRate`: `EvalReport.gates.goldSurvivalRate` (AC-US4-05)
  - `metrics.coverageRate`: `EvalReport.coverage.evaluatedChunks / EvalReport.coverage.totalChunks` (AC-US4-05)
- **Verdict thresholds**: fail if gated microF1 < 0.3, warn if < 0.5, pass otherwise
- Add one `EvalCheck` per stage (raw/normalized/gated) with `name: "f1:<stage>"`, `actual: microF1`, `passed: f1 >= 0.3`
- Export from `packages/ingest/src/index.ts`

**Test Plan**:
- **File**: `packages/ingest/src/eval/edge-extraction-evaluator.test.ts`
- **Tests**:
  - **TC-001**: Maps EvalReport metrics to EvalStageResult correctly
    - Given a mock `runEdgeEval` returning a well-structured `EvalReport` with gated microF1=0.6
    - When `evaluateEdgeExtraction()` runs
    - Then `result.metrics.gatedF1 === 0.6`, `result.metrics.goldSurvivalRate` is populated
  - **TC-002**: Verdict is "fail" when gated F1 < 0.3
    - Given a mock `runEdgeEval` returning gated microF1=0.2
    - When `evaluateEdgeExtraction()` runs
    - Then `result.verdict === "fail"`
  - **TC-003**: Verdict is "warn" when gated F1 is between 0.3 and 0.5
    - Given a mock `runEdgeEval` returning gated microF1=0.4
    - When `evaluateEdgeExtraction()` runs
    - Then `result.verdict === "warn"`
  - **TC-004**: Verdict is "pass" when gated F1 >= 0.5
    - Given a mock `runEdgeEval` returning gated microF1=0.7
    - When `evaluateEdgeExtraction()` runs
    - Then `result.verdict === "pass"`
  - **TC-005**: Abort signal is forwarded to runEdgeEval
    - Given an AbortSignal that fires immediately
    - When `evaluateEdgeExtraction()` is called
    - Then `runEdgeEval` is called with that signal

**Dependencies**: T-001

---

### T-004: Implement edge resolution evaluator [P]

**User Story**: US-005 | **Satisfies ACs**: AC-US5-01 through AC-US5-06
**Status**: [x] Completed

**Description**: Create `packages/search/src/eval/edge-resolution-evaluator.ts` wrapping `analyzeEdgeResolution()` and `buildSourceIndex()` from `packages/search/src/edge-resolution.ts`. Adds cross-source density and source-type pair metrics.

**Implementation Details**:
- Create directory `packages/search/src/eval/`
- Implement `evaluateEdgeResolution(segments: Segment[]): Promise<EvalStageResult>`:
  - Build source index: `buildSourceIndex(segments)`
  - Run: `analyzeEdgeResolution(segments, index)` → get `totalEdges`, `resolvedEdges`, `bareRefs`, `unresolvedEdges`, `unresolvedByRepo`
  - Compute `resolutionRate = resolvedEdges / totalEdges` (0 if totalEdges=0)
  - Compute `bareRefRate = bareRefs / totalEdges`
  - **Cross-source density** (AC-US5-03): For each resolved edge, check if `edge.sourceId`'s chunk sourceType differs from the resolved target's sourceType. `crossSourceEdges / resolvedEdges` is the density.
    - Build `chunkSourceTypeMap: Map<chunkId, sourceType>` from all segment chunks
    - Add a new `resolveTarget(targetId, index): string | undefined` helper in `@wtfoc/search` that returns the matched chunk ID (not just boolean). This extends the existing `resolves()` logic to expose the matched chunk for sourceType lookup.
    - For each edge where target resolves, look up source chunk's sourceType and resolved target chunk's sourceType via the map
  - **Source-type pair distribution** (AC-US5-05): `Record<"from->to", number>` for resolved cross-source edges
  - **Top-10 unresolved repos** (AC-US5-04): from `unresolvedByRepo` sorted desc, slice to 10
  - `metrics`: all of the above
  - `checks`: one for resolutionRate (pass if >= 0.15, warn if < 0.23 baseline)
  - **Verdict**: fail if resolutionRate < 0.05, warn if < 0.23, pass otherwise
- Export from `packages/search/src/index.ts`

**Test Plan**:
- **File**: `packages/search/src/eval/edge-resolution-evaluator.test.ts`
- **Tests**:
  - **TC-001**: Reports correct resolution rate
    - Given segments with 4 edges: 2 resolved, 1 bare ref (#123), 1 unresolved
    - When `evaluateEdgeResolution()` runs
    - Then `metrics.totalEdges === 4`, `metrics.resolvedEdges === 2`, `metrics.resolutionRate === 0.5`
  - **TC-002**: Cross-source density computed correctly
    - Given 2 resolved edges where source chunk is "github" type and target is "slack" type
    - When `evaluateEdgeResolution()` runs
    - Then `metrics.crossSourceEdgeDensity === 1.0` and `metrics.sourceTypePairs["github->slack"] === 2`
  - **TC-003**: Top-10 unresolved repos
    - Given 15 distinct unresolved repos
    - When `evaluateEdgeResolution()` runs
    - Then `metrics.topUnresolvedRepos.length === 10`
  - **TC-004**: Verdict "fail" when resolutionRate < 0.05
    - Given segments with 0 resolved edges out of 20
    - When `evaluateEdgeResolution()` runs
    - Then `result.verdict === "fail"`
  - **TC-005**: Empty collection returns pass with zero metrics
    - Given empty segments array
    - When `evaluateEdgeResolution()` runs
    - Then `result.verdict === "pass"` and `metrics.totalEdges === 0`

**Dependencies**: T-001

---

### T-005: Implement storage evaluator [P]

**User Story**: US-006 | **Satisfies ACs**: AC-US6-01 through AC-US6-05
**Status**: [x] Completed

**Description**: Create `packages/store/src/eval/storage-evaluator.ts` implementing `evaluateStorage(head, storage)`. Checks segment download integrity, derived edge layer consistency, and document catalog accuracy.

**Implementation Details**:
- Create directory `packages/store/src/eval/`
- Implement `evaluateStorage(head: CollectionHead, storage: StorageBackend, signal?: AbortSignal): Promise<EvalStageResult>`:
  - **Segment integrity** (AC-US6-01, AC-US6-02): For each `head.segments[i].id`, `download()` and `JSON.parse()`. Verify shape has `id`, `chunks` (array), `edges` (array). Count segments/chunks/edges. Track parse failures.
  - **Derived edge layer consistency** (AC-US6-03): If `head.derivedEdgeLayers` exists, for each layer `download(layer.id)`, parse as `Edge[]`, check every `edge.sourceId` exists in the set of chunk IDs from segments. Count dangling references.
  - **Document catalog** (AC-US6-04): Load the document catalog sidecar file from the manifest directory (same path used by `DocumentCatalog` in `@wtfoc/ingest`). If the catalog file exists, verify every `documentId` entry references chunk IDs that exist in segments; report orphaned entries.
  - `checks`: one per segment-parse-failure, one for derived-layer dangling refs, one for catalog orphans
  - **Verdict**: fail if any segment fails to download/parse, warn if derived layer has dangling refs or catalog has orphans, pass otherwise
- Export from `packages/store/src/index.ts`

**Test Plan**:
- **File**: `packages/store/src/eval/storage-evaluator.test.ts`
- **Tests**:
  - **TC-001**: Reports correct segment/chunk/edge counts when all segments download cleanly
    - Given a mock storage that returns valid segment JSON for each ID in head.segments
    - When `evaluateStorage()` runs
    - Then `metrics.segmentCount`, `metrics.totalChunks`, `metrics.totalEdges` match the fixture data
  - **TC-002**: Verdict "fail" when a segment fails to download
    - Given a mock storage that throws for one segment ID
    - When `evaluateStorage()` runs
    - Then `result.verdict === "fail"` and a failed check exists for that segment ID
  - **TC-003**: Verdict "fail" when a segment parses as invalid JSON
    - Given a mock storage returning `"not json"` for one segment
    - When `evaluateStorage()` runs
    - Then `result.verdict === "fail"`
  - **TC-004**: Derived edge layer dangling ref detected
    - Given a derived layer edge with `sourceId` not present in any segment chunk
    - When `evaluateStorage()` runs
    - Then `result.verdict === "warn"` and `metrics.derivedLayerDanglingRefs === 1`
  - **TC-005**: Clean collection yields "pass"
    - Given well-formed head, valid segments, no derived layers
    - When `evaluateStorage()` runs
    - Then `result.verdict === "pass"`

**Dependencies**: T-001

---

### T-006: Implement search/trace evaluator [P]

**User Story**: US-007 | **Satisfies ACs**: AC-US7-01 through AC-US7-08
**Status**: [x] Completed

**Description**: Create `packages/search/src/eval/search-evaluator.ts` implementing `evaluateSearch()`. Runs canned `query()` and `trace()` calls from a fixture file and measures retrieval + provenance quality.

**Implementation Details**:
- Create `packages/search/src/eval/search-eval-fixtures.ts` with 3–5 test queries, each with:
  - `queryText: string`
  - `expectedSourceTypes: string[]` (at least one of these should appear in top-K)
  - `topK: number` (default 5)
- Create `packages/search/src/eval/search-evaluator.ts`:
  - Signature: `evaluateSearch(collection: MountedCollection, segments: Segment[], signal?: AbortSignal): Promise<EvalStageResult>`
  - **Query eval** (AC-US7-03): For each fixture query, call `query(queryText, embedder, vectorIndex, { topK })`. Record result count, top-result score, whether expected source types appear in top-K.
  - **Trace eval** (AC-US7-04): For each fixture query, call `trace(queryText, embedder, vectorIndex, segments, { mode: "analytical" })`. Record total hops, edge hops vs semantic hops, distinct source types reached, insight count.
  - **Provenance quality** (AC-US7-05): For edge hops, count those where `connection.evidence` and `connection.edgeType` are non-empty. Report rate.
  - **Aggregate metrics** (AC-US7-06):
    - MRR: for each query, reciprocal rank of first result matching expected source type; mean across queries
    - Source-type coverage: distinct source types reached by any trace / total source types in collection
    - Edge-hop ratio: total edge hops / total hops across all traces
  - **Verdict**: fail if all queries return 0 results, warn if MRR < 0.3, pass otherwise
- Export from `packages/search/src/index.ts`

**Test Plan**:
- **File**: `packages/search/src/eval/search-evaluator.test.ts`
- **Tests**:
  - **TC-001**: Per-query result includes top-result score and source type match flag
    - Given a mock `query()` returning 3 results with sourceType "github"
    - And fixture query expects sourceType "github"
    - When `evaluateSearch()` runs
    - Then `metrics.queryResults[0].expectedSourceTypeFound === true`
  - **TC-002**: MRR calculation
    - Given 2 queries where query 1 matches at rank 1 (RR=1.0) and query 2 at rank 2 (RR=0.5)
    - When `evaluateSearch()` runs
    - Then `metrics.meanReciprocalRank === 0.75`
  - **TC-003**: Edge-hop ratio computed from trace results
    - Given a mock `trace()` returning 4 hops: 3 edge hops and 1 semantic hop
    - When `evaluateSearch()` runs
    - Then `metrics.edgeHopRatio === 0.75`
  - **TC-004**: Provenance quality rate
    - Given trace hops where 2 of 4 edge hops have non-empty evidence
    - When `evaluateSearch()` runs
    - Then `metrics.provenanceQualityRate === 0.5`
  - **TC-005**: Verdict "fail" when all queries return 0 results
    - Given mock `query()` always returns empty array
    - When `evaluateSearch()` runs
    - Then `result.verdict === "fail"`
  - **TC-006**: Verdict "warn" when MRR < 0.3
    - Given results where no expected source types appear in top-K
    - When `evaluateSearch()` runs
    - Then `result.verdict === "warn"`

**Dependencies**: T-001

---

### T-007: Implement themes/clustering evaluator [P]

**User Story**: US-008 | **Satisfies ACs**: AC-US8-01 through AC-US8-06
**Status**: [x] Completed

**Description**: Create `packages/search/src/eval/themes-evaluator.ts` implementing `evaluateThemes()`. Runs GreedyClusterer against collection chunks and reports cluster quality metrics.

**Implementation Details**:
- Create `packages/search/src/eval/themes-evaluator.ts`:
  - Signature: `evaluateThemes(segments: Segment[], embedder?: Embedder, extractorOptions?: { baseUrl: string; model: string }): Promise<EvalStageResult>`
  - Flatten all chunks from segments, extract embeddings
  - Run `GreedyClusterer` with default threshold (0.72) — same as `themes` command
  - **Cluster metrics** (AC-US8-01): cluster count, min/max/mean size, noise chunk count
  - **Intra-cluster cohesion** (AC-US8-02): for each cluster, compute mean pairwise cosine similarity of chunk embeddings
  - **Source-type diversity** (AC-US8-03): for each cluster, count distinct sourceTypes; report mean diversity
  - **LLM label quality** (AC-US8-04, optional): `labelClusters()` currently lives in `packages/cli/src/llm-labels.ts` — import it directly from that path (it only depends on `@wtfoc/ingest`'s `chatCompletion`). If extractorOptions provided, call it and report label count, duplicate label rate, mean label length. NOTE: extracting labeling into `@wtfoc/search` is a follow-up refactor.
  - **Verdict**: fail if 0 clusters found, warn if mean cohesion < 0.5, pass otherwise
  - Skippable when no embedder configured (AC-US8-05)
- Export from `packages/search/src/index.ts`

**Test Plan**:
- **File**: `packages/search/src/eval/themes-evaluator.test.ts`
- **Tests**:
  - **TC-001**: Reports correct cluster count and sizes
    - Given segments with chunks that form 3 distinct clusters
    - When `evaluateThemes()` runs
    - Then `metrics.clusterCount === 3` and min/max/mean sizes are correct
  - **TC-002**: Intra-cluster cohesion computed correctly
    - Given a cluster with known embeddings (high similarity)
    - When `evaluateThemes()` runs
    - Then `metrics.meanCohesion` is close to expected value
  - **TC-003**: Source-type diversity reported per cluster
    - Given a cluster containing github and slack chunks
    - When `evaluateThemes()` runs
    - Then that cluster's diversity count is 2
  - **TC-004**: Verdict "fail" when no clusters formed
    - Given segments with 1 chunk (can't cluster)
    - When `evaluateThemes()` runs
    - Then `result.verdict === "fail"` or graceful handling
  - **TC-005**: LLM labeling skipped when no extractor options
    - Given no extractorOptions
    - When `evaluateThemes()` runs
    - Then `metrics.labels` is undefined and no LLM calls made

**Dependencies**: T-001

---

### T-008: Implement signal scoring evaluator [P]

**User Story**: US-009 | **Satisfies ACs**: AC-US9-01 through AC-US9-05
**Status**: [x] Completed

**Description**: Create `packages/ingest/src/eval/signal-evaluator.ts` implementing `evaluateSignals()`. Runs HeuristicChunkScorer against all chunks and reports signal distribution.

**Implementation Details**:
- Create `packages/ingest/src/eval/signal-evaluator.ts`:
  - Signature: `evaluateSignals(segments: Segment[]): Promise<EvalStageResult>`
  - Flatten all chunks from segments
  - Run `HeuristicChunkScorer.score()` on each chunk's content
  - **Per-signal distribution** (AC-US9-01, AC-US9-02): for each signal type (pain, praise, feature_request, workaround, question), count chunks with non-zero score
  - **Coverage** (AC-US9-02): total chunks scored, chunks with at least one non-zero signal
  - **Per-source-type breakdown** (AC-US9-03): `Record<sourceType, Record<signalType, count>>`
  - **Verdict**: pass always (signals are informational, no failure threshold)
  - No LLM or embedder required (AC-US9-04)
- Export from `packages/ingest/src/index.ts`

**Test Plan**:
- **File**: `packages/ingest/src/eval/signal-evaluator.test.ts`
- **Tests**:
  - **TC-001**: Reports correct signal distribution
    - Given chunks with known content matching pain/praise patterns
    - When `evaluateSignals()` runs
    - Then `metrics.signalCounts.pain > 0` and `metrics.signalCounts.praise > 0`
  - **TC-002**: Coverage rate computed correctly
    - Given 4 chunks: 2 with signals, 2 without
    - When `evaluateSignals()` runs
    - Then `metrics.signalCoverage === 0.5`
  - **TC-003**: Per-source-type breakdown populated
    - Given github chunks with pain signals and slack chunks with praise signals
    - When `evaluateSignals()` runs
    - Then `metrics.perSourceType.github.pain > 0` and `.slack.praise > 0`
  - **TC-004**: Empty segments handled gracefully
    - Given empty segments array
    - When `evaluateSignals()` runs
    - Then `result.verdict === "pass"` and `metrics.totalChunks === 0`

**Dependencies**: T-001

---

## Phase 3: Orchestrator Script

### T-009: Create dogfood orchestrator script

**User Story**: US-001, US-002, US-010 | **Satisfies ACs**: AC-US1-01 through AC-US1-07, AC-US2-01 through AC-US2-04, AC-US10-01 through AC-US10-04
**Status**: [x] Completed

**Description**: Create `scripts/dogfood.ts` as a developer-only script run via `pnpm dogfood`. This orchestrates all 7 stage evaluators sequentially and formats the unified `DogfoodReport`. NOT a public CLI command.

**Implementation Details**:
- Add to root `package.json`: `"dogfood": "tsx scripts/dogfood.ts"`
- Create `scripts/dogfood.ts`:
  - Parse CLI args with `parseArgs` from `node:util` (lightweight, no Commander.js needed):
    - `--collection <name>` (required) — AC-US1-02
    - `--stage <name>` — one of `ingest|edges|resolution|storage|themes|signals|search` — AC-US2-01
    - `--json` — output JSON to stdout — AC-US1-06
    - `--output <path>` — write JSON report to file or directory — AC-US10-02, AC-US10-03
    - `--skip-llm` — skip LLM-dependent stages (edges, themes labeling, search)
    - `--extractor-url <url>`, `--extractor-model <model>` — AC-US1-03
    - `--embedder-url <url>`, `--embedder-model <model>`
  - Action:
    1. Load store (reuse `createStore`/`LocalManifestStore` from @wtfoc/store)
    2. Load head via `store.manifests.getHead(collection)`
    3. Load all segments
    4. Determine which stages to run (all or `--stage` subset) — AC-US2-02
    5. Validate stage-specific required options (AC-US2-03: `--stage edges` requires `--extractor-url` and `--extractor-model`)
    6. Run each enabled stage evaluator in order, catch errors and mark stage as failed
    7. Build `DogfoodReport` with `reportSchemaVersion: "1.0.0"`, `timestamp`, `collectionName`, `durationMs`, `stages`, aggregate `verdict` — AC-US1-04, AC-US1-05, AC-US10-01, AC-US10-04
    8. Output: if `--json`, print `JSON.stringify(report, null, 2)` to stdout; else print human summary — AC-US1-06
    9. If `--output <path>`: write JSON to file; if path is directory, use filename `dogfood-<collection>-<timestamp>.json` — AC-US10-02, AC-US10-03
    10. Exit codes: 0=success, 1=eval failure — AC-US1-07

**Test Plan**:
- **File**: `scripts/dogfood.test.ts`
- **Tests**:
  - **TC-001**: `--stage edges` without extractor options exits with code 1
    - Given `--stage edges` and no `--extractor-url`/`--extractor-model`
    - When the script runs
    - Then process exits with code 1 and error message
  - **TC-002**: `--stage ingest` runs only the ingest evaluator
    - Given mocked evaluators and `--stage ingest`
    - When the orchestrator runs
    - Then only `evaluateIngest` is called, others are not
  - **TC-003**: JSON output matches DogfoodReport shape
    - Given mocked evaluators returning pass verdicts
    - When the script runs with `--json`
    - Then stdout contains valid JSON with `reportSchemaVersion`, `timestamp`, `collectionName`, `stages`, `verdict`
  - **TC-004**: Report written to file when `--output <path>` is a file path
    - Given `--output /tmp/test-report.json`
    - When the script runs
    - Then `/tmp/test-report.json` contains the JSON report
  - **TC-005**: Aggregate verdict is "fail" if any stage fails
    - Given one stage evaluator throws an error (caught and marked fail)
    - When the script runs
    - Then the DogfoodReport has `verdict === "fail"` and exits with code 1

**Dependencies**: T-002, T-003, T-004, T-005, T-006, T-007, T-008

---

### T-010: Human-readable report formatter

**User Story**: US-001 | **Satisfies ACs**: AC-US1-06
**Status**: [x] Completed

**Description**: Create `scripts/dogfood-formatter.ts` with a `formatDogfoodReport(report: DogfoodReport): string` function for human-readable console output. Follows the style of `formatEvalReport` from `packages/ingest/src/edges/eval.ts`.

**Implementation Details**:
- Create `scripts/dogfood-formatter.ts`
- Function: `formatDogfoodReport(report: DogfoodReport): string`
- Output sections:
  1. Header with collection name, timestamp, total duration, aggregate verdict (PASS/WARN/FAIL)
  2. Per-stage summary table: `stage | verdict | duration | summary`
  3. Per-stage detail: key metrics inline (pick 3–5 most important per stage)
     - Ingest: chunkCount, contentFingerprintRate, requiredFieldViolations
     - Edge extraction: gatedF1, goldSurvivalRate, coverageRate
     - Resolution: resolutionRate, crossSourceEdgeDensity, topUnresolvedRepos (top 3)
     - Storage: segmentCount, totalChunks, derivedLayerDanglingRefs
     - Themes: clusterCount, meanCohesion, sourceTypeDiversity
     - Signals: signalCoverage, per-type counts
     - Search: meanReciprocalRank, edgeHopRatio, provenanceQualityRate

**Test Plan**:
- **File**: `scripts/dogfood-formatter.test.ts`
- **Tests**:
  - **TC-001**: Output includes collection name and aggregate verdict
    - Given a DogfoodReport with `collectionName: "myrepo"` and `verdict: "pass"`
    - When `formatDogfoodReport(report)` is called
    - Then the returned string contains `"myrepo"` and `"PASS"`
  - **TC-002**: Skipped stage is labelled "skipped"
    - Given a DogfoodReport where edge-extraction stage has `summary: "skipped: no extractor configured"`
    - When `formatDogfoodReport(report)` is called
    - Then the string includes `"skipped"` for the edge-extraction row
  - **TC-003**: Failed stage is highlighted
    - Given a DogfoodReport with one stage `verdict: "fail"`
    - When `formatDogfoodReport(report)` is called
    - Then the string contains `"FAIL"` for that stage

**Dependencies**: T-001

---

## Phase 4: Integration + Wiring

### T-011: Export new evaluators from package index files

**User Story**: FR-002, FR-003 | **Satisfies ACs**: AC-US4-01, AC-US5-01
**Status**: [x] Completed

**Description**: Ensure all new evaluator functions are exported from their package `index.ts` files so the orchestrator script can import them.

**Implementation Details**:
- `packages/ingest/src/index.ts`: export `evaluateIngest`, `evaluateEdgeExtraction`, `evaluateSignals`
- `packages/search/src/index.ts`: export `evaluateEdgeResolution`, `evaluateThemes`, `evaluateSearch`
- `packages/store/src/index.ts`: export `evaluateStorage`
- `packages/common/src/index.ts`: export `EvalStageResult`, `EvalCheck`, `DogfoodReport` (done in T-001)
- Run `pnpm build` at root to verify all exports compile

**Test Plan**:
- **File**: Build-time check (TypeScript compilation)
- **Tests**:
  - **TC-001**: All new exports compile without errors
    - Given clean build
    - When `pnpm build` runs
    - Then exits with code 0 and no TS errors

**Dependencies**: T-002, T-003, T-004, T-005, T-006, T-007, T-008

---

## Phase 5: Verification

### T-012: Run full test suite + lint

**User Story**: All | **Satisfies ACs**: All
**Status**: [x] Completed

**Description**: Run `pnpm test` and `pnpm lint:fix` across the monorepo. Ensure all new tests pass and no existing tests regress.

**Implementation Details**:
- `pnpm test` — all packages
- `pnpm lint:fix` — fix any auto-fixable issues
- Fix any failures before marking complete

**Test Plan**:
- **TC-001**: All tests pass
  - Given all implementation tasks complete
  - When `pnpm test` runs
  - Then exit code 0 with no failures
- **TC-002**: No lint errors
  - When `pnpm lint:fix` runs
  - Then exit code 0

**Dependencies**: T-011

---

### T-013: Verify acceptance criteria coverage

**User Story**: All | **Satisfies ACs**: All
**Status**: [x] Completed

**Description**: Walk through each AC in spec.md and confirm it is satisfied by the implementation. Check the boxes in spec.md as each AC is verified.

**Implementation Details**:
- For each AC in spec.md, trace it to a task and test case
- Run `pnpm dogfood --help` to confirm option names match spec
- If any AC is unaddressed, open a follow-up task or fix in place

**Test Plan**:
- **TC-001**: All P1 ACs (US-001 through US-005) have implementation + test coverage
- **TC-002**: All P2 ACs (US-006 through US-010) have implementation + test coverage

**Dependencies**: T-012
