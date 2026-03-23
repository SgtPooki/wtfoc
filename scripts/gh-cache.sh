#!/usr/bin/env bash
set -euo pipefail

# gh-cache.sh — Shared GitHub API cache for agent coordination
#
# Usage:
#   source scripts/gh-cache.sh
#   gh_cache_refresh              # force refresh (called by unblock.sh)
#   gh_cache_issues               # get cached open issues JSON
#   gh_cache_prs                  # get cached open PRs JSON
#   gh_cache_age                  # seconds since last refresh
#
# Cache location: .gh-cache/ in repo root (gitignored)
# Refresh interval: controlled by caller (unblock.sh does it every 5 min)

REPO="${REPO:-SgtPooki/wtfoc}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="${REPO_ROOT}/.gh-cache"

mkdir -p "$CACHE_DIR"

gh_cache_refresh() {
	local start
	start=$(date +%s)

	# Fetch all open issues with labels
	gh issue list --repo "$REPO" --state open --limit 200 \
		--json number,title,labels,body,state \
		> "${CACHE_DIR}/issues.json" 2>/dev/null || true

	# Fetch all open PRs with labels and metadata
	gh pr list --repo "$REPO" --state open --limit 100 \
		--json number,title,labels,headRefName,body,comments,reviews \
		> "${CACHE_DIR}/prs.json" 2>/dev/null || true

	# Fetch closed issues (for dependency checking)
	gh issue list --repo "$REPO" --state closed --limit 200 \
		--json number,title,state \
		> "${CACHE_DIR}/closed-issues.json" 2>/dev/null || true

	# Record timestamp
	date +%s > "${CACHE_DIR}/last-refresh"

	local elapsed=$(( $(date +%s) - start ))
	echo "[gh-cache] Refreshed in ${elapsed}s" >&2
}

gh_cache_issues() {
	if [[ -f "${CACHE_DIR}/issues.json" ]]; then
		cat "${CACHE_DIR}/issues.json"
	else
		echo "[]"
	fi
}

gh_cache_prs() {
	if [[ -f "${CACHE_DIR}/prs.json" ]]; then
		cat "${CACHE_DIR}/prs.json"
	else
		echo "[]"
	fi
}

gh_cache_closed_issues() {
	if [[ -f "${CACHE_DIR}/closed-issues.json" ]]; then
		cat "${CACHE_DIR}/closed-issues.json"
	else
		echo "[]"
	fi
}

gh_cache_age() {
	if [[ -f "${CACHE_DIR}/last-refresh" ]]; then
		local last
		last=$(cat "${CACHE_DIR}/last-refresh")
		echo $(( $(date +%s) - last ))
	else
		echo "99999"
	fi
}

# Refresh if cache is stale (older than 5 minutes) or doesn't exist
gh_cache_ensure_fresh() {
	local max_age="${1:-300}"
	local age
	age=$(gh_cache_age)
	if [[ "$age" -gt "$max_age" ]]; then
		gh_cache_refresh
	fi
}
