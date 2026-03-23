# Implementation Plan: GitHub Adapter

**Branch**: `013-github-adapter` | **Date**: 2026-03-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `.specify/specs/013-github-adapter/spec.md`

## Summary

Add a `GitHubAdapter` implementing `SourceAdapter` that ingests issues, PRs, PR review comments, and discussions from GitHub repos via `gh api`. Includes exponential backoff for rate limits, pagination, `--since` filtering, and cross-reference edge extraction. Tests mock the `gh` CLI subprocess.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM only, Node >=24
**Primary Dependencies**: `@wtfoc/common` (SourceAdapter interface, Chunk, Edge types), `gh` CLI (external, invoked via `execFile`)
**Storage**: N/A — adapter produces chunks, doesn't store them
**Testing**: vitest with mocked `execFile` calls returning fixture JSON
**Target Platform**: Node.js CLI
**Project Type**: Library module in `@wtfoc/ingest`
**Performance Goals**: Ingest 100+ issue repo in under 60 seconds (excluding rate limit waits)
**Constraints**: `gh` CLI must be installed and authenticated; rate limit backoff with configurable max retries
**Scale/Scope**: Repos with hundreds to low thousands of issues/PRs

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Credible Exit at Every Seam | PASS | Implements existing `SourceAdapter` interface |
| II. Standalone Packages | PASS | Lives in `@wtfoc/ingest`, no new package |
| III. Backend-Neutral Identity | N/A | Adapter produces chunks, doesn't assign storage IDs |
| IV. Immutable Data | N/A | Adapter is stateless |
| V. Edges Are First-Class | PASS | Extracts cross-reference edges from GitHub content |
| VI. Test-First | PASS | Tests with mocked gh output |
| VII. Bundle Uploads | N/A | Adapter doesn't upload |
| VIII. Hackathon-First | PASS | Unlocks real-data demo |

No violations.

## Project Structure

### Documentation

```text
.specify/specs/013-github-adapter/
├── plan.md
├── spec.md
├── research.md
└── checklists/
    └── requirements.md
```

### Source Code

```text
packages/ingest/src/
├── adapters/
│   └── github.ts          # CREATE: GitHubAdapter + GitHubAdapterConfig
├── adapters/
│   └── github.test.ts     # CREATE: tests with mocked gh output
└── index.ts                # MODIFY: export GitHubAdapter
```

## Phase 0: Research (COMPLETED)

**gh api invocation**: Use `gh api repos/{owner}/{repo}/issues --paginate -q '.[]'` for paginated JSON. Rate limit detected via exit code + stderr parsing. Retry-after from response headers or default 60s backoff.

**Chunk identity**: All issue/PR/comment chunks use `{owner}/{repo}#{N}` as source identifier. Comments use parent PR's source format for edge resolution. Discussions use `{owner}/{repo}/discussions/{N}`.

**Edge extraction**: Reuse `RegexEdgeExtractor` for `#N`, `owner/repo#N`, `Refs`, `Closes` patterns. Comment chunks get edge resolution via parent PR source format. Discussions don't participate in `#N` resolution.

**Rate limit detection**: `gh api` returns exit code 1 with "API rate limit exceeded" in stderr. Use `Retry-After` header or `x-ratelimit-reset` timestamp when available, otherwise exponential backoff starting at 5s. Max total wait: 5 minutes. Throw `GitHubRateLimitError` when exhausted.

## Complexity Tracking

No violations. No complexity justifications needed.
