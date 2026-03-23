#!/usr/bin/env bash
set -euo pipefail

# unblock.sh — Check blocked issues and mark them ready when dependencies are met
#
# Usage:
#   ./scripts/unblock.sh              # run once
#   ./scripts/unblock.sh --loop [interval]  # run continuously (default: 60s)
#
# Reads each 'blocked' issue, extracts "Depends on #X" references from the body,
# checks if all referenced issues are closed, and moves blocked → ready.

REPO="SgtPooki/wtfoc"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[unblock]${NC} $*"; }
warn() { echo -e "${YELLOW}[unblock]${NC} $*"; }

# Also check: ready issues that already have an open PR should be marked in-progress (not picked up again)
check_ready_with_prs() {
	local ready_issues
	ready_issues=$(gh issue list --repo "$REPO" --label "ready" --state open \
		--json number,title -q '.[]' 2>/dev/null) || return 0

	echo "$ready_issues" | jq -c '.' 2>/dev/null | while IFS= read -r issue; do
		local num title
		num=$(echo "$issue" | jq -r '.number')
		title=$(echo "$issue" | jq -r '.title')

		# Check if there's an open PR referencing this issue
		local pr_count
		pr_count=$(gh pr list --repo "$REPO" --state open --json body,number -q "[.[] | select(.body | test(\"#${num}[^0-9]\|#${num}$\"))] | length" 2>/dev/null || echo "0")

		if [[ "$pr_count" -gt 0 ]]; then
			log "#${num} (${title}): has open PR — removing 'ready' label"
			gh issue edit "$num" --repo "$REPO" --remove-label "ready" >/dev/null 2>&1
		fi
	done
}

check_blocked_issues() {
	local blocked_issues
	blocked_issues=$(gh issue list --repo "$REPO" --label "blocked" --state open \
		--json number,title,body -q '.[]' 2>/dev/null) || return 0

	if [[ -z "$blocked_issues" ]]; then
		log "No blocked issues."
		return 0
	fi

	# Process each blocked issue
	echo "$blocked_issues" | jq -c '.' | while IFS= read -r issue; do
		local num title body
		num=$(echo "$issue" | jq -r '.number')
		title=$(echo "$issue" | jq -r '.title')
		body=$(echo "$issue" | jq -r '.body')

		# Extract dependency references: "Depends on: #X" or "Depends on #X" or "depends on #X, #Y"
		local deps
		deps=$(echo "$body" | grep -ioE '(depends on|blocked by|requires)[: ]*#[0-9]+([ ,]+#[0-9]+)*' | grep -oE '#[0-9]+' | tr -d '#' | sort -u)

		if [[ -z "$deps" ]]; then
			# No explicit dependencies found — check for "Depends on:" with issue references in next line
			deps=$(echo "$body" | grep -ioE '#[0-9]+' | head -20 | tr -d '#' | sort -u)
			# If there are issue refs but we can't determine they're deps, skip
			if [[ -z "$deps" ]]; then
				warn "#${num} (${title}): no dependencies found — needs manual review"
				continue
			fi
		fi

		# Check if all dependencies are closed
		local all_met=true
		local unmet=""
		for dep in $deps; do
			# Skip self-references
			[[ "$dep" == "$num" ]] && continue

			local dep_state
			dep_state=$(gh issue view "$dep" --repo "$REPO" --json state -q '.state' 2>/dev/null || echo "UNKNOWN")

			if [[ "$dep_state" != "CLOSED" ]]; then
				all_met=false
				unmet="${unmet} #${dep}(${dep_state})"
			fi
		done

		if [[ "$all_met" == "true" ]]; then
			log "#${num} (${title}): all deps met → marking ready"
			gh issue edit "$num" --repo "$REPO" --remove-label "blocked" --add-label "ready" >/dev/null 2>&1
		else
			echo -e "  ${BLUE}#${num}${NC} (${title}): waiting on${unmet}"
		fi
	done
}

# ─── Main ────────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--loop" ]]; then
	interval="${2:-300}"
	log "Running in loop mode (every ${interval}s). Ctrl+C to stop."
	while true; do
		check_ready_with_prs
		check_blocked_issues
		sleep "$interval"
	done
else
	check_ready_with_prs
	check_blocked_issues
fi
