# Feature Specification: Real Data Demo

**Feature Branch**: `014-real-data-demo`
**Created**: 2026-03-23
**Status**: Draft
**Input**: "Wire GitHubAdapter into CLI, create demo script for 7 real FOC repos, verify trace/query across real data. Refs #19, spec 006."

## Overview

Wire the newly built `GitHubAdapter` into the CLI's `ingest` command as the `github` source type, then create a demo script that ingests 7 real FOC ecosystem GitHub repos into a single collection. The demo proves wtfoc works on real data — cross-repo trace and query across actual issues, PRs, and comments.

This is the hackathon deliverable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CLI github ingest command (Priority: P1)

An operator runs `wtfoc ingest github FilOzone/synapse-sdk --collection foc-demo` and the system ingests issues, PRs, and comments from that repo into the collection.

**Why this priority**: Without CLI wiring, the GitHub adapter is unusable outside of code.

**Independent Test**: Run the ingest command against a real small repo and verify chunks are stored.

**Acceptance Scenarios**:

1. **Given** the CLI with `github` source type, **When** `wtfoc ingest github owner/repo -c collection` is run, **Then** issues, PRs, and comments are ingested into the collection.
2. **Given** the `--since` flag, **When** `wtfoc ingest github owner/repo -c coll --since 90d`, **Then** only items updated in the last 90 days are fetched.
3. **Given** an invalid repo, **When** the command is run, **Then** a helpful error message is shown (not a stack trace).

---

### User Story 2 - Demo script ingests 7 FOC repos (Priority: P1)

A demo script ingests all 7 FOC ecosystem repos into one collection and shows collection status.

**Why this priority**: The script is the hackathon demo setup.

**Independent Test**: Run the script, verify the collection has segments from all 7 repos.

**Acceptance Scenarios**:

1. **Given** the demo script, **When** it runs, **Then** it ingests issues/PRs/comments from all 7 repos into a single `foc-demo` collection.
2. **Given** completion, **When** `wtfoc status -c foc-demo` is run, **Then** it shows segment count, chunk count, and source types from all repos.

---

### User Story 3 - Demo trace and query across real data (Priority: P1)

An operator runs trace and query commands against the real-data collection and gets meaningful results that span multiple repos.

**Why this priority**: This is the demo moment — showing real cross-repo knowledge tracing.

**Independent Test**: Run trace/query against the ingested collection, verify results reference real GitHub URLs.

**Acceptance Scenarios**:

1. **Given** the foc-demo collection, **When** `wtfoc trace "PDP verification" -c foc-demo` is run, **Then** results include hops from multiple repos with real GitHub URLs.
2. **Given** the foc-demo collection, **When** `wtfoc query "upload timeout" -c foc-demo` is run, **Then** results include content from real issues/PRs ranked by relevance.

---

### Edge Cases

- A repo has zero issues/PRs → no segment created, no error
- Rate limit hit during multi-repo ingest → backoff and continue
- Demo script interrupted mid-run → can be re-run (idempotent collection updates via prevHeadId)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CLI MUST support `wtfoc ingest github <owner/repo>` as a source type, using the `GitHubAdapter`.
- **FR-002**: The CLI MUST pass `--since` flag to the adapter config.
- **FR-003**: A demo script MUST ingest 7 specified FOC ecosystem repos into one collection.
- **FR-004**: The demo script MUST be runnable with `./scripts/demo.sh` from the repo root.
- **FR-005**: The demo script MUST show collection status after ingestion.
- **FR-006**: Trace and query MUST work against the real-data collection and return results with real GitHub URLs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `wtfoc ingest github FilOzone/synapse-sdk -c test` successfully ingests and stores chunks.
- **SC-002**: The demo script completes ingestion of all 7 repos without manual intervention.
- **SC-003**: `wtfoc trace` and `wtfoc query` against the demo collection return results from multiple repos.

## Out of Scope

- Website ingestion (docs.filecoin.cloud — needs website adapter, #32)
- Discord ingestion (needs Discord adapter, #31)
- FOC storage upload (demo uses local storage)
- Caching/incremental updates (follow-on for #33)

## References

- Issue #19: Golden demo: fixtures + smoke test + demo script
- Spec 006: Real Data Demo (original spec)
- Spec 013: GitHub Adapter (just merged)
