# Feature Specification: Real Data Demo

**Feature Branch**: `006-demo-real-data`
**Created**: 2026-03-23
**Status**: Draft
**Package**: `@wtfoc/ingest`, `@wtfoc/cli`

## Overview

Ingest real FOC ecosystem data for the hackathon demo. Use public GitHub repos and docs.filecoin.cloud to demonstrate cross-source tracing on actual team artifacts — not synthetic data.

## Data Sources

### GitHub Repos (7 repos)

| Repo | What to ingest | Why |
|------|---------------|-----|
| FilOzone/synapse-sdk | Issues, PRs, PR comments, code | Core SDK — most cross-references |
| FilOzone/dealbot | Issues, PRs | Monitoring tool — cross-refs synapse |
| FilOzone/pdp-explorer | Issues, PRs | Explorer — references PDP/synapse |
| FilOzone/filecoin-services | Issues, PRs | On-chain contracts — referenced by SDKs |
| FIL-Builders/foc-cli | Issues, PRs | CLI — references synapse-sdk |
| filecoin-project/curio | Issues, PRs | SP infrastructure — referenced by services |
| filecoin-project/filecoin-pin | Issues, PRs, code | IPFS bridge — our team built this |

### GitHub Data Types per Repo

| Type | API endpoint | Edge potential |
|------|-------------|---------------|
| Issues | `gh api repos/{owner}/{repo}/issues --paginate` | References other issues, PRs |
| Issue comments | `gh api repos/{owner}/{repo}/issues/{n}/comments` | Contains #refs, URLs, context |
| PRs | `gh api repos/{owner}/{repo}/pulls --paginate` | Closes/fixes issues, changed files |
| PR review comments | `gh api repos/{owner}/{repo}/pulls/{n}/comments` | Inline code feedback |
| PR reviews | `gh api repos/{owner}/{repo}/pulls/{n}/reviews` | Approval/rejection context |
| Discussions | `gh api repos/{owner}/{repo}/discussions` (if enabled) | Design context, Q&A |

### Website

| Source | Method |
|--------|--------|
| docs.filecoin.cloud | Nova crawl or sitemap-based fetch |

## Rate Limit Strategy

GitHub API: 5000 requests/hour with PAT.

- **Bulk fetch**: use `--paginate` to get all items per endpoint in one stream
- **Limit scope**: last 90 days of activity (configurable `--since`)
- **Cache raw responses**: save to `~/.wtfoc/cache/{owner}/{repo}/` as JSON files
- **Incremental updates**: store `last_fetched` timestamp, only request `?since=` on re-runs
- **Batch by repo**: process one repo at a time, log remaining rate limit between repos
- **Estimated budget for 7 repos**: ~200-500 requests total (bulk paginated), well within limits

## User Stories

### User Story 1 — Ingest a GitHub repo with full context (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `wtfoc ingest github FilOzone/synapse-sdk --collection foc`, **When** ingested, **Then** issues, issue comments, PRs, PR reviews, and changed files are all chunked with correct sourceType and cross-references extracted.
2. **Given** an issue comment mentioning `#42` in the synapse-sdk repo, **Then** an edge with `targetId: "FilOzone/synapse-sdk#42"` is extracted (repo-scoped).
3. **Given** a PR in dealbot referencing `FilOzone/synapse-sdk#100`, **Then** a cross-repo edge is extracted.
4. **Given** `--since 90d`, **Then** only items updated in the last 90 days are fetched.
5. **Given** a second run, **Then** only new/updated items since last fetch are requested (incremental).

### User Story 2 — Ingest multiple repos into one collection (Priority: P1)

**Acceptance Scenarios**:

1. **Given** 7 repos ingested into `--collection foc`, **Then** all are searchable together.
2. **Given** `wtfoc trace "PDP verification"`, **Then** results span multiple repos (synapse-sdk issues + curio PRs + filecoin-services code).
3. **Given** rate limit approaching, **Then** the ingester pauses and warns, doesn't crash.

### User Story 3 — Demo-ready trace across real data (Priority: P1)

**Acceptance Scenarios**:

1. **Given** all 7 repos + docs ingested, **When** `wtfoc trace "upload timeout"`, **Then** results show real issue → real PR → real code change chain.
2. **Given** the demo, **Then** every result links back to a real GitHub URL (verifiable by judges).

## Requirements

- **FR-001**: GitHub adapter fetches issues, issue comments, PRs, PR reviews, PR changed files
- **FR-002**: Each data type gets its own sourceType: `github-issue`, `github-issue-comment`, `github-pr`, `github-pr-review`, `github-pr-comment`
- **FR-003**: Cross-repo references extracted with full `owner/repo#N` scope
- **FR-004**: `--since <duration>` flag limits fetch window (default: 90 days)
- **FR-005**: Raw API responses cached locally for incremental re-runs
- **FR-006**: Rate limit monitoring with pause/warn when approaching limit
- **FR-007**: Bulk paginated fetches (not per-item)

## Demo Script Outline

```bash
# One-time ingest (takes ~5 minutes with 7 repos)
wtfoc init foc-demo --local
wtfoc ingest github FilOzone/synapse-sdk --collection foc-demo --since 90d
wtfoc ingest github FilOzone/dealbot --collection foc-demo --since 90d
wtfoc ingest github FIL-Builders/foc-cli --collection foc-demo --since 90d
wtfoc ingest github filecoin-project/filecoin-pin --collection foc-demo --since 90d
wtfoc ingest github FilOzone/pdp-explorer --collection foc-demo --since 90d
wtfoc ingest github filecoin-project/curio --collection foc-demo --since 90d
wtfoc ingest github FilOzone/filecoin-services --collection foc-demo --since 90d

# Live demo (these run fast — just search + trace)
wtfoc status --collection foc-demo
wtfoc trace "upload timeout" --collection foc-demo
wtfoc trace "PDP verification" --collection foc-demo
wtfoc query "how does payment work" --collection foc-demo
wtfoc verify <cid-from-result>
```

## Dependencies

- `@wtfoc/ingest` — GitHub adapter (issue #11, enhanced)
- `@wtfoc/search` — trace + query
- `@wtfoc/cli` — CLI commands
- `@wtfoc/store` — local storage

## Out of Scope (for hackathon)

- Private repo access (all repos above are public)
- Slack/Discord ingest (no export available for demo)
- docs.filecoin.cloud crawl (nice-to-have stretch)
- Real-time webhook ingestion
