# Research: GitHub Adapter

## Decision 1: gh api vs gh issue list

**Decision**: Use `gh api` with `--paginate` for all data fetching.

**Rationale**: `gh api` returns raw GitHub API JSON, giving full control over field selection and pagination. `gh issue list --json` is higher-level but has limited field support and inconsistent pagination. `gh api --paginate` handles Link header pagination automatically.

**Alternatives considered**:
- `gh issue list --json`: simpler but less control over fields, pagination behavior varies
- Direct HTTP with tokens: more flexible but adds auth management complexity
- Octokit SDK: would be the "right" long-term solution but adds a dependency

## Decision 2: Rate limit detection and backoff

**Decision**: Parse stderr from `gh api` for "rate limit" messages. Use exponential backoff starting at 5 seconds, doubling each retry, max 3 retries. If `x-ratelimit-reset` header is available (via `--include` flag), use that for precise wait time.

**Rationale**: `gh api` exits with code 1 on rate limit and prints the error to stderr. Exponential backoff is the standard approach. 3 retries with 5/10/20s delays covers most transient rate limits without hanging indefinitely.

**Alternatives considered**:
- Fixed delay: too aggressive or too slow depending on the rate limit window
- No retry (fail immediately): makes the tool unusable for multi-repo ingestion
- Infinite retry: could hang forever on sustained rate limits

## Decision 3: Chunk source identifiers

**Decision**: Use `{owner}/{repo}#{N}` for all issue/PR/comment chunks:
- Issues: `{owner}/{repo}#{N}` (e.g., `FilOzone/synapse-sdk#42`)
- PRs: `{owner}/{repo}#{N}` (same format, distinguished by sourceType)
- PR comments: `{owner}/{repo}#{prN}` (parent PR's source format — required for RegexEdgeExtractor edge resolution of bare `#N`)
- Discussions: `{owner}/{repo}/discussions/{N}` (different format, no `#` — discussions aren't cross-referenced via `#N`)

**Rationale**: RegexEdgeExtractor only resolves bare `#N` to `owner/repo#N` for `github-issue` and `github-pr` sourceTypes. PR comment chunks MUST use the parent PR's source format so edge resolution works. Using a different format (like `!N` or `github:` prefix) would break edge extraction.

**Alternatives considered**:
- Full URLs: too long for source field, redundant with sourceUrl
- Numeric IDs only: not human-readable, lose repo context

## Decision 4: Testability

**Decision**: Mock `execFile` at the module level in tests. Provide fixture JSON files for issues, PRs, comments. Tests verify chunk shape, edge extraction, pagination handling, and rate limit retry behavior.

**Rationale**: The adapter is a thin wrapper around `gh api` — the interesting behavior is in parsing, chunking, and error handling. Mocking `execFile` isolates that behavior without requiring gh CLI or network access.

**Alternatives considered**:
- Integration tests with real gh CLI: slow, requires auth, flaky
- HTTP mocking: doesn't apply since we use gh CLI, not HTTP
