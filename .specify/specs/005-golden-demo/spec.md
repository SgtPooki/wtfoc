# Feature Specification: Golden Demo

**Feature Branch**: `005-golden-demo`
**Created**: 2026-03-23
**Status**: Draft

## Overview

Create the golden demo dataset and demo script for the FOC WG Hackathon #2 presentation. Synthetic but realistic data with a curated incident chain: Slack complaint → GitHub issue → PR → code change.

## User Scenarios & Testing

### User Story 1 — Golden dataset (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `fixtures/golden-incident/`, **Then** it contains: slack-export.json, github-issues.json, github-prs.json, code-files/
2. **Given** the Slack export, **Then** it contains messages mentioning "upload failures" and referencing `#142`
3. **Given** the GitHub data, **Then** issue #142 exists, PR #156 exists with "Closes #142", PR has changed files with commit SHA
4. **Given** all fixtures ingested, **Then** `wtfoc trace "upload failures"` produces a complete chain: Slack → Issue → PR → Code

### User Story 2 — Demo smoke test (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `wtfoc demo-smoke`, **Then** it ingests golden dataset, runs the hero trace query, and asserts expected hops and evidence match.
2. **Given** the smoke test passes, **Then** the demo is reliable.

### User Story 3 — Demo script (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `scripts/demo.sh`, **Then** it runs the full demo flow with formatted output suitable for recording.
2. **Given** the demo script, **Then** it completes in under 2 minutes.

## Dependencies

- `@wtfoc/cli` — all commands working
- `@wtfoc/ingest` — Slack + GitHub adapters
- `@wtfoc/search` — trace command
- `@wtfoc/store` — local storage at minimum
