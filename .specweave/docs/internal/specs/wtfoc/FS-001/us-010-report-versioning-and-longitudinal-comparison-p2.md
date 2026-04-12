---
id: US-010
feature: FS-001
title: "Report versioning and longitudinal comparison (P2)"
status: completed
priority: P1
created: 2026-04-12T00:00:00.000Z
tldr: "**As a** wtfoc developer."
project: wtfoc
---

# US-010: Report versioning and longitudinal comparison (P2)

**Feature**: [FS-001](./FEATURE.md)

**As a** wtfoc developer
**I want** reports to be versioned and saved for later comparison
**So that** I can track quality trends across pipeline changes

---

## Acceptance Criteria

- [x] **AC-US10-01**: The unified `DogfoodReport` includes a `reportSchemaVersion` field (starting at `"1.0.0"`)
- [x] **AC-US10-02**: When `--output <path>` is provided, the JSON report is written to that file path
- [x] **AC-US10-03**: Report filenames default to `dogfood-<collection>-<ISO-timestamp>.json` when `--output` is a directory
- [x] **AC-US10-04**: Each stage report within the unified report includes its own `durationMs` for per-stage timing

---

## Implementation

**Increment**: [0001-dogfood-eval](../../../../../increments/0001-dogfood-eval/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

_No tasks defined for this user story_
