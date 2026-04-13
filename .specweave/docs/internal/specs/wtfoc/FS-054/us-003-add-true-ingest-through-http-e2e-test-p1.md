---
id: US-003
feature: FS-054
title: "Add true ingest-through-HTTP E2E test (P1)"
status: completed
priority: P1
created: 2026-04-13T00:00:00.000Z
tldr: "**As a** developer verifying the ingest pipeline end-to-end."
project: wtfoc3
---

# US-003: Add true ingest-through-HTTP E2E test (P1)

**Feature**: [FS-054](./FEATURE.md)

**As a** developer verifying the ingest pipeline end-to-end
**I want** at least one E2E test that sends data through the actual HTTP ingest endpoint rather than pre-seeding with `seedCollection()`
**So that** adapter wiring, request validation, and server-side orchestration are proven under real HTTP conditions

---

## Acceptance Criteria

- [x] **AC-US3-01**: A new E2E test file (or test block within existing E2E) POSTs ingest payload to the server's HTTP ingest endpoint and verifies the collection is created
- [x] **AC-US3-02**: After ingest via HTTP, the test queries the newly created collection and verifies results are returned (full round-trip: HTTP ingest -> store -> HTTP query)
- [x] **AC-US3-03**: The test validates request validation by sending a malformed payload and asserting a 400 response
- [x] **AC-US3-04**: The test does NOT use `seedCollection()` or any direct store manipulation — all data flows through HTTP
- [x] **AC-US3-05**: The test runs against the same server startup used by existing E2E tests (shared `startServer` helper)

---

## Implementation

**Increment**: [0054-test-suite-quality](../../../../../increments/0054-test-suite-quality/spec.md)

**Tasks**: See increment tasks.md for implementation details.


## Tasks

- [x] **T-014**: Full test suite and lint pass
