---
id: US-002
feature: FS-001
title: "Run individual stage evaluation (P1)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-002: Run individual stage evaluation (P1)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** to run `pnpm dogfood --collection <name> --stage <stage>` to evaluate a single pipeline stage
**So that** I can iterate quickly on one area without waiting for the full pipeline eval

---

## Acceptance Criteria

- [x] **AC-US2-01**: `--stage <name>` accepts values: `ingest`, `edges`, `resolution`, `storage`, `themes`, `signals`, `search`
- [x] **AC-US2-02**: When `--stage` is specified, only that stage's evaluator runs; the unified report contains only that stage's results
- [x] **AC-US2-03**: When `--stage edges` is used, `--extractor-url` and `--extractor-model` are required (the script errors with a helpful message if missing)
- [x] **AC-US2-04**: When `--stage` is omitted, all stages run (default behavior from US-001)

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

- [x] **T-009**: Create dogfood orchestrator script
