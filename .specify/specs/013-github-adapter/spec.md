# Feature Specification: GitHub Adapter

**Feature Branch**: `013-github-adapter`
**Created**: 2026-03-23
**Status**: Draft
**Input**: User description: "GitHub adapter for ingesting issues, PRs, PR comments, and discussions from GitHub repos via the gh CLI. Must handle API rate limits with exponential backoff and respect AbortSignal. Produces typed chunks with cross-reference edges. Refs issue #11."

## Clarifications

### Session 2026-03-23

- Q: How should the adapter invoke GitHub — gh CLI subcommands, gh api, or both? → A: Use `gh api` for simplicity and full control. This is the quick path; a future iteration may add direct GitHub API/SDK support for users who prefer token-based auth without the gh CLI dependency.

### Cross-review 2026-03-23 (Cursor)

- RegexEdgeExtractor only resolves bare `#N` for `github-issue`/`github-pr` sourceTypes. PR comment and discussion chunks must use the parent issue/PR's `owner/repo#N` source format so edge resolution works.
- GitHub issues endpoint includes PRs — adapter must filter or deduplicate.
- Parent PR linking from comments uses `references` edge type (existing), not a custom type.
- SC-004 perf target should be measured against fixture data, not live API.
- gh execution should be injectable for testing (wrap execFile in a small helper).

### Cross-review 2026-03-23 (Codex)

- Source ID model: use `{owner}/{repo}#{N}` for all GitHub chunks (issues, PRs, comments). No `github:` prefix or `!` separator. Comment chunks use parent PR's source format for edge resolution. Discussion chunks use `{owner}/{repo}/discussions/{N}`.
- Rate limit: use `Retry-After` header or `x-ratelimit-reset` timestamp when available. Fallback to exponential backoff. Max elapsed wait of 5 minutes (not just 3 retries). Exhaustion = typed error.
- `--since`: uses `since` query param with ISO 8601 date on the GitHub API (`updated_at` field). Server-side filtering for issues/PRs. Client-side filtering for comments (no `since` param on comments endpoint).
- Metadata encoding: `Chunk.metadata` is `Record<string, string>`. Arrays (labels) encoded as comma-separated strings. Booleans (merged) encoded as "true"/"false" strings.
- Adding errors to `@wtfoc/common` is a public contract change. SPEC.md error list should be updated.

## Overview

Add a `GitHubAdapter` that implements the `SourceAdapter` interface and ingests issues, pull requests, PR review comments, and discussions from GitHub repositories. Uses `gh api` for data fetching (simple, paginated JSON). Produces typed chunks with rich metadata and extracts cross-reference edges between issues, PRs, and repos.

Rate limiting is handled with exponential backoff and retry — the adapter detects GitHub's rate limit responses and waits before retrying. All async operations respect `AbortSignal` for cancellation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ingest issues and PRs from a GitHub repo (Priority: P1)

An operator runs `wtfoc ingest github owner/repo` and the system fetches all issues and PRs, chunks them, and produces segments with cross-reference edges linking related issues and PRs.

**Why this priority**: Issues and PRs are the richest source of cross-references in the FOC ecosystem. This is the minimum viable GitHub adapter.

**Independent Test**: Ingest issues/PRs from a known repo, verify chunks have correct sourceType, source identifiers, and that edges link cross-referenced issues.

**Acceptance Scenarios**:

1. **Given** a GitHub repo with issues and PRs, **When** the adapter ingests it, **Then** each issue and PR becomes one or more chunks with sourceType distinguishing issues from PRs.
2. **Given** an issue body containing "Refs #42" or "closes #15", **When** edges are extracted, **Then** the edges have correct type (references/closes), source, target, and evidence fields.
3. **Given** a repo with many items, **When** the adapter paginates through results, **Then** all items are ingested without data loss.
4. **Given** a `--since` duration filter, **When** the adapter ingests, **Then** only items updated within the specified window are fetched.

---

### User Story 2 - Ingest PR review comments (Priority: P1)

An operator ingests PR review comments alongside PRs, capturing the discussion context that often contains the most detailed technical reasoning.

**Why this priority**: PR comments contain the "why" behind decisions — critical for trace evidence.

**Independent Test**: Ingest a PR with review comments, verify comments become separate chunks linked to the parent PR via edges.

**Acceptance Scenarios**:

1. **Given** a PR with review comments, **When** the adapter ingests it, **Then** each comment becomes a chunk with sourceType "github-pr-comment" linked to the parent PR.
2. **Given** a review comment referencing another issue, **When** edges are extracted, **Then** edges connect the comment to the referenced issue.

---

### User Story 3 - Ingest discussions (Priority: P2)

An operator ingests GitHub Discussions (if the repo has them enabled), capturing Q&A and design threads.

**Why this priority**: Discussions are less common but contain valuable design rationale. Lower priority than issues/PRs.

**Independent Test**: Ingest discussions from a repo that has them, verify chunks with sourceType "github-discussion".

**Acceptance Scenarios**:

1. **Given** a repo with discussions enabled, **When** the adapter ingests, **Then** discussions become chunks with sourceType "github-discussion".
2. **Given** a repo without discussions, **When** the adapter ingests, **Then** it skips discussions gracefully without error.

---

### User Story 4 - Rate limit handling (Priority: P1)

The adapter respects GitHub API rate limits and retries with exponential backoff instead of failing.

**Why this priority**: Rate limits are guaranteed to hit when ingesting multiple repos. Failing on rate limit makes the tool unusable for real workloads.

**Independent Test**: Simulate a rate limit response, verify the adapter waits and retries.

**Acceptance Scenarios**:

1. **Given** the GitHub API returns a rate limit response, **When** the adapter encounters it, **Then** it waits with exponential backoff and retries the request.
2. **Given** rate limits are hit repeatedly, **When** retries are exhausted, **Then** the adapter throws a typed error with the rate limit details.
3. **Given** an AbortSignal is fired during a backoff wait, **When** the adapter is waiting, **Then** it cancels immediately without completing the retry.

---

### Edge Cases

- Repo does not exist or is private without auth → typed error
- Issue/PR body is empty or null → skip without error
- Very long issue/PR bodies → chunked correctly by the markdown chunker
- gh CLI not installed → typed error with helpful message
- GitHub API returns malformed JSON → typed error
- Pagination returns empty page → stop pagination
- Rate limit retry-after header is missing → use default backoff

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The adapter MUST implement the `SourceAdapter` interface from `@wtfoc/common`.
- **FR-002**: The adapter MUST ingest issues, pull requests, and PR review comments via `gh api`. The issues endpoint includes PRs — the adapter MUST filter them out (by checking `pull_request` field) to avoid duplicate chunks with the separate pulls endpoint.
- **FR-003**: The adapter MUST produce chunks with sourceType values: "github-issue", "github-pr", "github-pr-comment", "github-discussion".
- **FR-004**: The adapter MUST extract cross-reference edges from issue/PR bodies and comments using the existing `RegexEdgeExtractor` plus GitHub-specific patterns (owner/repo#N, #N).
- **FR-005**: The adapter MUST handle GitHub API rate limits by: (1) using `Retry-After` header or `x-ratelimit-reset` timestamp when available, (2) falling back to exponential backoff starting at 5s, (3) capping total wait at 5 minutes, (4) throwing typed `GitHubRateLimitError` when exhausted.
- **FR-006**: The adapter MUST respect AbortSignal on all async operations including backoff waits.
- **FR-007**: The adapter MUST support a `--since` duration filter. For issues and PRs, this maps to the `since` query param (ISO 8601, filters by `updated_at`) on the GitHub API — server-side filtering. For PR comments, filtering is client-side (skip comments older than the threshold).
- **FR-008**: The adapter MUST paginate through all results without data loss.
- **FR-009**: The adapter MUST throw typed errors for: repo not found, gh CLI not installed, rate limit exhausted, malformed API response.
- **FR-010**: Discussion ingestion is optional — the adapter MUST skip gracefully if discussions are not enabled on the repo.

### Key Entities

- **GitHub Issue Chunk**: sourceType `github-issue`, source `{owner}/{repo}#{N}`. Metadata: `number`, `state`, `labels` (comma-separated), `author`, `createdAt`, `updatedAt`. All metadata values are strings.
- **GitHub PR Chunk**: sourceType `github-pr`, source `{owner}/{repo}#{N}`. Metadata: `number`, `state`, `merged` ("true"/"false"), `author`, `createdAt`, `updatedAt`.
- **GitHub PR Comment Chunk**: sourceType `github-pr-comment`, source `{owner}/{repo}#{prN}` (same format as parent PR for edge resolution). Metadata: `commentId`, `parentPr`, `author`, `createdAt`.
- **GitHub Discussion Chunk**: sourceType `github-discussion`, source `{owner}/{repo}/discussions/{N}`. Metadata: `number`, `author`, `category`, `createdAt`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The adapter successfully ingests all issues and PRs from a test repo and produces chunks with correct sourceType and metadata.
- **SC-002**: Cross-reference edges between issues/PRs are extracted with evidence fields.
- **SC-003**: Rate limit simulation triggers backoff and retry without data loss.
- **SC-004**: The adapter processes 100+ fixture issues/PRs in under 5 seconds (measured against mocked gh output, not live API).

## Out of Scope

- Direct GitHub API HTTP calls (use gh CLI only)
- GitHub Actions/workflow data
- Repository file contents (already handled by RepoAdapter)
- Webhook-based real-time ingestion (#2)
- OAuth token management

## References

- Issue #11: Ingest: GitHub adapter
- Issue #33: GitHub adapter: full data types + rate limiting + caching (follow-on)
- Spec 002: Ingest Pipeline (original adapter spec)
- Spec 006: Real Data Demo (depends on this adapter)
