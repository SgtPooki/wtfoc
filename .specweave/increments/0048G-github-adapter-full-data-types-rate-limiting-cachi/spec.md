# [enhancement] GitHub adapter: full data types + rate limiting + caching

**Increment**: 0048G-github-adapter-full-data-types-rate-limiting-cachi
**Type**: feature | **Priority**: P1 | **Labels**: implementation, blocked, scale, P1
**Source**: GitHub #33

## Description

## Enhanced GitHub Adapter

The current GitHub adapter (#11) covers basic issues + PRs. The real-data demo needs the full set.

### Additional Data Types Needed

| Type | sourceType | API | Edge potential |
|------|-----------|-----|---------------|
| Issue comments | `github-issue-comment` | `repos/{owner}/{repo}/issues/{n}/comments` | Contains #refs, URLs, discussion context |
| PR review comments | `github-pr-comment` | `repos/{owner}/{repo}/pulls/{n}/comments` | Inline code feedback, file references |
| PR reviews | `github-pr-review` | `repos/{owner}/{repo}/pulls/{n}/reviews` | Approval/rejection context |
| Discussions | `github-discussion` | GraphQL API (if enabled) | Design context, Q&A |
| Commit messages | `github-commit` | `repos/{owner}/{repo}/commits` | Reference issues, link to code |
| Release notes | `github-release` | `repos/{owner}/{repo}/releases` | Summarize changes, link PRs |

### Rate Limiting

- Monitor `X-RateLimit-Remaining` header on every response
- Pause and warn when below threshold (e.g. 100 remaining)
- Log remaining rate limit between repos
- Estimated budget: ~200-500 requests for 7 repos (bulk paginated)

### Caching

- Cache raw API responses to `~/.wtfoc/cache/{owner}/{repo}/{type}.json`
- Store `last_fetched` timestamp per repo per data type
- `--since <duration>` flag limits fetch window (default: 90 days)
- Incremental: use `?since=<timestamp>` on re-runs for issues/comments
- Skip re-fetch if cache is fresh (configurable max age)

### Data Modeling Considerations

Before implementing, we need to model:
- How issue comments relate to parent issues (thread context)
- How PR review comments map to specific code lines/files
- How to preserve conversation order within a thread
- How cross-repo references are scoped (same org vs different org)
- Whether to create separate chunks per comment or group by thread
- How to handle edited content (latest version vs history)

### Acceptance Criteria

- [ ] All data types listed above can be fetched and chunked
- [ ] Rate limit is monitored and respected
- [ ] Cached responses enable fast re-runs
- [ ] Incremental fetch only gets new/updated items
- [ ] Cross-repo references produce repo-scoped edges
- [ ] Each data type has appropriate sourceType and sourceUrl

Depends on: #11 (basic GitHub adapter)
Blocks: #19 (demo with real data)

### Open Questions

- Should we model comment threads as single chunks or individual messages?
- Should we include bot comments (dependabot, copilot) or filter them out?
- Should commit messages be a separate source type or enrichment on PRs?
- How do we handle repos with thousands of issues (pagination + storage)?

## User Stories

- **US-001**: As a user, I want github adapter full data types rate limiting cachi so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #33 on 2026-04-12.
