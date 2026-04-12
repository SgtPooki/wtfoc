---
id: US-001
feature: FS-001
title: "Run full pipeline evaluation (P1)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-001: Run full pipeline evaluation (P1)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** to run `pnpm dogfood --collection <name> --extractor-url <url> --extractor-model <model>` from the monorepo root and get a unified quality report across all pipeline stages
**So that** I can identify which parts of the pipeline are degrading and prioritize fixes

---

## Acceptance Criteria

- [x] **AC-US1-01**: A developer script at `scripts/dogfood.ts` is runnable via `pnpm dogfood` (root package.json script entry using tsx)
- [x] **AC-US1-02**: `--collection <name>` is required; the script loads the collection head from the manifest store (same pattern as existing CLI commands)
- [x] **AC-US1-03**: `--extractor-url <url>` and `--extractor-model <model>` are accepted as CLI args for stages that need LLM access (edge eval)
- [x] **AC-US1-04**: The script runs all 7 stage evaluators in sequence (ingest, edges, resolution, storage, themes, signals, search) and produces a unified `DogfoodReport` JSON object
- [x] **AC-US1-05**: The unified report includes `timestamp` (ISO 8601), `reportSchemaVersion` (starting at `"1.0.0"`), `collectionName`, `durationMs`, and a `stages` array of `EvalStageResult` in pipeline order
- [x] **AC-US1-06**: JSON output is printed to stdout when `--json` is passed; human-readable summary is printed by default
- [x] **AC-US1-07**: The script exits with code 0 on success, 1 on evaluation failure

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

- [x] **T-001**: Add shared eval types to @wtfoc/common [P]
- [x] **T-009**: Create dogfood orchestrator script
