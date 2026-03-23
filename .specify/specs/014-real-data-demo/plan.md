# Implementation Plan: Real Data Demo

**Branch**: `014-real-data-demo` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `.specify/specs/014-real-data-demo/spec.md`

## Summary

Wire `GitHubAdapter` into the CLI's `ingest` command as the `github` source type, then create a demo shell script that ingests 7 real FOC ecosystem repos and runs demo trace/query commands.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >=24
**Primary Dependencies**: `@wtfoc/ingest` (GitHubAdapter), `@wtfoc/cli` (ingest command)
**Testing**: Manual — demo against real GitHub repos (requires gh auth)
**Project Type**: CLI integration + shell script
**Constraints**: Requires `gh` CLI authenticated, network access

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| All | PASS | CLI wiring + demo script, no architectural changes |

## Project Structure

```text
packages/cli/src/
└── cli.ts                  # MODIFY: add github source type to ingest command
scripts/
└── demo.sh                 # CREATE: demo script for 7 repos
```

## Phase 0: Research (COMPLETED)

No unknowns. GitHubAdapter exists and is exported from `@wtfoc/ingest`. CLI ingest command currently only supports `repo` source type. Need to add `github` case.

## Complexity Tracking

None.
