#!/usr/bin/env bash
set -euo pipefail

# agent-loop.sh — Autonomous agent work loop
#
# Usage:
#   ./scripts/agent-loop.sh <agent> [--once]
#
# The agent will:
# 1. Look for an issue assigned to it (assigned-<agent> label)
# 2. If none, look for an unassigned "ready" issue and claim it
# 3. If none, exit (or sleep and retry if not --once)
# 4. Create a worktree for the issue
# 5. Print the prompt the agent should execute
#
# Run this, then pipe the output into your agent CLI:
#   ./scripts/agent-loop.sh cursor
#
# Agents: claude, cursor, codex

REPO="SgtPooki/wtfoc"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_BASE="$(cd "$REPO_ROOT/.." && pwd)/wtfoc-worktrees"
VALID_AGENTS=("claude" "cursor" "codex")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[agent-loop:${AGENT}]${NC} $*" >&2; }
warn() { echo -e "${YELLOW}[agent-loop:${AGENT}]${NC} $*" >&2; }
err() { echo -e "${RED}[agent-loop:${AGENT}]${NC} $*" >&2; exit 1; }

AGENT="${1:-}"
ONCE="${2:-}"

# Validate
if [[ -z "$AGENT" ]]; then
	echo "Usage: agent-loop.sh <agent> [--once]" >&2
	echo "Agents: claude, cursor, codex" >&2
	exit 1
fi

valid=false
for a in "${VALID_AGENTS[@]}"; do
	[[ "$a" == "$AGENT" ]] && valid=true && break
done
[[ "$valid" == "false" ]] && err "Invalid agent: ${AGENT}"

# ─── Check if an issue already has an open PR addressing it ───────────────────
has_open_pr() {
	local issue_num="$1"
	# Search open PRs for any that reference this issue in body (Fixes #N, Closes #N, for #N)
	local pr_count
	pr_count=$(gh pr list --repo "$REPO" --state open --json body,number -q "[.[] | select(.body | test(\"#${issue_num}[^0-9]\|#${issue_num}$\"))] | length" 2>/dev/null || echo "0")
	[[ "$pr_count" -gt 0 ]]
}

# ─── Find next issue to work on ──────────────────────────────────────────────
find_issue() {
	# Priority 1: Issue already assigned to this agent (but NOT blocked, and no open PR)
	local assigned
	assigned=$(gh issue list --repo "$REPO" --label "assigned-${AGENT}" --state open \
		--json number,title,labels -q '[.[] | select(.labels | map(.name) | contains(["blocked"]) | not)] | .[0] // empty')

	if [[ -n "$assigned" ]] && echo "$assigned" | jq -e '.number' >/dev/null 2>&1; then
		local assigned_num
		assigned_num=$(echo "$assigned" | jq -r '.number')
		if ! has_open_pr "$assigned_num"; then
			echo "$assigned"
			return 0
		else
			log "Issue #${assigned_num} already has an open PR — skipping"
		fi
	fi

	# Priority 2: Unassigned "ready" issue — claim it
	local ready
	ready=$(gh issue list --repo "$REPO" --label "ready" --state open \
		--json number,title,labels -q '[.[] | select(.labels | map(.name) | (contains(["assigned-claude"]) or contains(["assigned-cursor"]) or contains(["assigned-codex"])) | not)] | .[0] // empty')

	# Iterate through ready issues, skip any with open PRs
	if [[ -n "$ready" ]] && echo "$ready" | jq -e '.number' >/dev/null 2>&1; then
		# Get all unassigned ready issues (not just first)
		local all_ready
		all_ready=$(gh issue list --repo "$REPO" --label "ready" --state open \
			--json number,title,labels -q '[.[] | select(.labels | map(.name) | (contains(["assigned-claude"]) or contains(["assigned-cursor"]) or contains(["assigned-codex"])) | not)]')

		echo "$all_ready" | jq -c '.[]' 2>/dev/null | while IFS= read -r candidate; do
			local cnum
			cnum=$(echo "$candidate" | jq -r '.number')
			if ! has_open_pr "$cnum"; then
				log "Claiming unassigned ready issue #${cnum}"
				gh issue edit "$cnum" --repo "$REPO" --add-label "assigned-${AGENT}" >/dev/null 2>&1
				echo "$candidate"
				return 0
			else
				log "Issue #${cnum} already has an open PR — skipping"
			fi
		done
		return 1
	fi

	return 1
}

# ─── Determine issue type and build agent prompt ─────────────────────────────
build_prompt() {
	local issue_json="$1"
	local issue_num
	local issue_title
	issue_num=$(echo "$issue_json" | jq -r '.number')
	issue_title=$(echo "$issue_json" | jq -r '.title')

	local labels
	labels=$(echo "$issue_json" | jq -r '.labels[].name' 2>/dev/null || echo "")

	local issue_body
	issue_body=$(gh issue view "$issue_num" --repo "$REPO" --json body -q '.body')

	# Determine branch name
	local branch_name
	branch_name=$(echo "$issue_title" | sed 's/\[spec\] //' | sed 's/\[impl\] //' | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 60)
	branch_name="${issue_num}-${branch_name}"

	# Create worktree
	local worktree_dir="${WORKTREE_BASE}/${branch_name}"
	cd "$REPO_ROOT"
	git fetch origin main 2>/dev/null || true
	git branch "$branch_name" origin/main 2>/dev/null || true
	if [[ ! -d "$worktree_dir" ]]; then
		mkdir -p "$(dirname "$worktree_dir")"
		git worktree add "$worktree_dir" "$branch_name" 2>/dev/null || true
		(cd "$worktree_dir" && pnpm install --frozen-lockfile 2>/dev/null) || true
		log "Worktree ready: ${worktree_dir}"
	fi

	# Build prompt based on issue type
	if echo "$labels" | grep -q "spec"; then
		build_spec_prompt "$issue_num" "$issue_title" "$issue_body" "$worktree_dir" "$branch_name"
	elif echo "$labels" | grep -q "implementation"; then
		build_impl_prompt "$issue_num" "$issue_title" "$issue_body" "$worktree_dir" "$branch_name"
	else
		build_generic_prompt "$issue_num" "$issue_title" "$issue_body" "$worktree_dir" "$branch_name"
	fi
}

build_spec_prompt() {
	local num="$1" title="$2" body="$3" wt="$4" branch="$5"

	cat <<PROMPT
You are working on issue #${num}: ${title}

Working directory: ${wt}
Branch: ${branch}
Repo: ${REPO}

## Task

This is a SPEC task. Follow the spec-kit flow:

1. Read SPEC.md and .specify/memory/constitution.md to understand project rules
2. Run /speckit.specify to create the specification in .specify/specs/${branch}/spec.md
3. Run /speckit.clarify to resolve any ambiguities
4. Commit the spec and push to the branch
5. Open a PR: gh pr create --title "[spec] ${title}" --body "Spec for #${num}. Needs /peer-review before merge."
6. Comment on the PR that it needs cross-review before merge

## Issue Context

${body}

## Rules

- Read SPEC.md and AGENTS.md first
- Every spec follows the spec-kit template format
- Commit atomically — each commit is one logical change
- Push after each meaningful commit
- Do NOT merge the PR — it needs peer review first
- After opening the PR, request review by commenting: "Ready for /peer-review"
PROMPT
}

build_impl_prompt() {
	local num="$1" title="$2" body="$3" wt="$4" branch="$5"

	cat <<PROMPT
You are working on issue #${num}: ${title}

Working directory: ${wt}
Branch: ${branch}
Repo: ${REPO}

## Task

This is an IMPLEMENTATION task. Follow the spec and implement:

1. Read SPEC.md, AGENTS.md, and the ratified spec referenced in the issue
2. Run /speckit.implement or implement manually following the task breakdown
3. Write behavioral tests for all changes (vitest, test .ts files directly)
4. Ensure pnpm test and pnpm lint pass
5. Commit atomically — each commit is one logical change that builds
6. Push after each meaningful commit
7. Open a PR: gh pr create --title "${title}" --body "Fixes #${num}"

## Issue Context

${body}

## Rules

- Read SPEC.md and AGENTS.md first
- All changes must have behavioral tests
- pnpm test must pass (vitest, runs from root)
- pnpm lint must pass (biome)
- Each commit produces a working state
- Push after each meaningful commit
- Do NOT merge the PR — it needs review first
- After opening the PR, request review by commenting: "Ready for /peer-review"
PROMPT
}

build_generic_prompt() {
	local num="$1" title="$2" body="$3" wt="$4" branch="$5"

	cat <<PROMPT
You are working on issue #${num}: ${title}

Working directory: ${wt}
Branch: ${branch}
Repo: ${REPO}

## Task

Read the issue and complete the work described. Follow project conventions in SPEC.md and AGENTS.md.

## Issue Context

${body}

## Rules

- Read SPEC.md and AGENTS.md first
- All changes must have tests
- pnpm test and pnpm lint must pass
- Commit atomically, push after each meaningful commit
- Open a PR when done: gh pr create --title "${title}" --body "Fixes #${num}"
PROMPT
}

# ─── Run the agent ────────────────────────────────────────────────────────────
run_agent() {
	local prompt="$1"
	local worktree_dir="$2"

	# Write prompt to temp file (avoids argv limits for all agents)
	local prompt_file
	prompt_file=$(mktemp /tmp/wtfoc-agent-prompt-XXXXXXXXXXXX)
	mv "$prompt_file" "${prompt_file}.md"
	prompt_file="${prompt_file}.md"
	echo "$prompt" > "$prompt_file"
	log "Prompt written to: ${prompt_file}"

	case "$AGENT" in
		cursor)
			log "Starting Cursor agent in ${worktree_dir}..."
			cursor agent --print --trust \
				--workspace "$worktree_dir" "$(cat "$prompt_file")" || {
				warn "Cursor exited with code $?. Prompt is at: ${prompt_file}"
				return 1
			}
			;;
		codex)
			log "Starting Codex agent in ${worktree_dir}..."
			cat "$prompt_file" | codex exec -C "$worktree_dir" --full-auto - || {
				warn "Codex exited with code $?. Prompt is at: ${prompt_file}"
				return 1
			}
			;;
		claude)
			log "Starting Claude agent in ${worktree_dir}..."
			(cd "$worktree_dir" && claude -p "$(cat "$prompt_file")" --allowedTools Bash,Read,Write,Edit,Glob,Grep) || {
				warn "Claude exited with code $?. Prompt is at: ${prompt_file}"
				return 1
			}
			;;
	esac

	rm -f "$prompt_file" 2>/dev/null || true
}

# ─── Address PR feedback on PRs this agent authored ───────────────────────────
address_pr_feedback() {
	# Find open PRs authored by this agent that have review comments
	local my_prs
	my_prs=$(gh_retry gh pr list --repo "$REPO" --state open \
		--json number,title,headRefName,labels -q '.[]' 2>/dev/null) || return 0

	if [[ -z "$my_prs" ]]; then
		return 0
	fi

	echo "$my_prs" | jq -c '.' 2>/dev/null | while IFS= read -r pr; do
		local pr_num pr_title pr_branch pr_labels
		pr_num=$(echo "$pr" | jq -r '.number')
		pr_title=$(echo "$pr" | jq -r '.title')
		pr_branch=$(echo "$pr" | jq -r '.headRefName')
		pr_labels=$(echo "$pr" | jq -r '.labels[].name' 2>/dev/null || echo "")

		# Only address PRs this agent authored
		if ! echo "$pr_labels" | grep -q "authored-${AGENT}"; then
			# Fallback: check branch name for PRs before label existed
			if ! echo "$pr_branch" | grep -qi "$AGENT"; then
				continue
			fi
		fi

		# Check if there's a changes-requested label or unresolved review comments
		if ! echo "$pr_labels" | grep -q "changes-requested"; then
			# Check for review comments we haven't addressed yet
			local review_comments
			review_comments=$(gh pr view "$pr_num" --repo "$REPO" --json comments \
				-q '[.comments[] | select(.body | test("Review:"; "i")) | select(.body | test("REQUEST_CHANGES"; "i"))] | length' 2>/dev/null || echo "0")

			local has_addressed
			has_addressed=$(gh pr view "$pr_num" --repo "$REPO" --json comments \
				-q '[.comments[] | select(.body | test("Addressed feedback"; "i"))] | length' 2>/dev/null || echo "0")

			if [[ "$review_comments" -eq 0 ]] || [[ "$has_addressed" -ge "$review_comments" ]]; then
				continue
			fi

			# Mark it so we track it
			gh_retry gh issue edit "$pr_num" --repo "$REPO" --add-label "changes-requested" >/dev/null 2>&1 || true
		fi

		log "Addressing feedback on PR #${pr_num}: ${pr_title}"

		# Get the review comments
		local feedback
		feedback=$(gh pr view "$pr_num" --repo "$REPO" --json comments \
			-q '[.comments[] | select(.body | test("Review:"; "i"))] | .[-1].body' 2>/dev/null || echo "")

		if [[ -z "$feedback" ]]; then
			continue
		fi

		# Find or create the worktree for this PR's branch
		local worktree_dir="${WORKTREE_BASE}/${pr_branch}"
		if [[ ! -d "$worktree_dir" ]]; then
			cd "$REPO_ROOT"
			git fetch origin "$pr_branch" 2>/dev/null || true
			git worktree add "$worktree_dir" "$pr_branch" 2>/dev/null || true
			(cd "$worktree_dir" && pnpm install --frozen-lockfile 2>/dev/null) || true
		else
			(cd "$worktree_dir" && git pull origin "$pr_branch" --ff-only 2>/dev/null) || true
		fi

		# Get the current diff for context
		local diff
		diff=$(gh_retry gh pr diff "$pr_num" --repo "$REPO" 2>/dev/null) || diff=""

		local fix_prompt
		fix_prompt="You are addressing review feedback on PR #${pr_num}: ${pr_title}

Working directory: ${worktree_dir}
Branch: ${pr_branch}

## Review Feedback to Address

${feedback}

## Current PR Diff

${diff}

## Instructions

1. Read the review feedback carefully
2. Make the requested changes in the worktree
3. Ensure pnpm test and pnpm lint pass
4. Commit with message: 'fix: address review feedback on #${pr_num}'
5. Push to the branch

Do NOT open a new PR — push to the existing branch.
Do NOT change test scripts or package.json scripts without explicit approval."

		local fix_file
		fix_file=$(mktemp /tmp/wtfoc-fix-XXXXXXXXXXXX)
		mv "$fix_file" "${fix_file}.md"
		fix_file="${fix_file}.md"
		echo "$fix_prompt" > "$fix_file"

		local fix_output=""
		case "$AGENT" in
			cursor)
				fix_output=$(cursor agent --print --trust \
					--workspace "$worktree_dir" "$(cat "$fix_file")" 2>&1) || true
				;;
			codex)
				fix_output=$(cat "$fix_file" | codex exec -C "$worktree_dir" --full-auto - 2>&1) || true
				;;
			claude)
				fix_output=$(cd "$worktree_dir" && cat "$fix_file" | claude -p - --allowedTools Bash,Read,Write,Edit,Glob,Grep 2>&1) || true
				;;
		esac

		rm -f "$fix_file" 2>/dev/null || true

		# Commit and push any changes the agent made
		local has_changes
		has_changes=$(cd "$worktree_dir" && git status --porcelain | wc -l | tr -d ' ')
		if [[ "$has_changes" -gt 0 ]]; then
			(cd "$worktree_dir" && \
				git add -A && \
				git commit -m "fix: address review feedback on #${pr_num}" && \
				git push origin "$pr_branch" 2>&1) || warn "Failed to push feedback fixes"
		fi

		# Comment that feedback was addressed
		gh_retry gh pr comment "$pr_num" --repo "$REPO" \
			--body "**Addressed feedback** (by ${AGENT}). Please re-review." >/dev/null 2>&1 || true

		# Remove changes-requested label
		gh_retry gh issue edit "$pr_num" --repo "$REPO" --remove-label "changes-requested" >/dev/null 2>&1 || true

		log "Addressed feedback on PR #${pr_num}"

		# Only address one PR per loop iteration
		break
	done
}

# ─── Post-agent cleanup: commit, push, PR, remove label ──────────────────────
post_agent_cleanup() {
	local issue_num="$1"
	local issue_title="$2"
	local worktree_dir="$3"

	log "Agent finished work on #${issue_num}. Checking for uncommitted changes..."

	local branch_name
	branch_name=$(cd "$worktree_dir" && git branch --show-current)

	# Check if there are uncommitted changes the agent left behind
	local has_changes
	has_changes=$(cd "$worktree_dir" && git status --porcelain | wc -l | tr -d ' ')

	if [[ "$has_changes" -gt 0 ]]; then
		log "Found ${has_changes} uncommitted changes. Committing on behalf of agent..."
		(cd "$worktree_dir" && \
			git add -A && \
			git commit -m "feat: ${AGENT} work on #${issue_num} — $(echo "$issue_title" | sed 's/\[spec\] //' | sed 's/\[impl\] //')" && \
			git push -u origin "$branch_name" 2>&1) || warn "Failed to commit/push"
	fi

	# Check if PR exists for this branch
	local existing_pr
	existing_pr=$(gh pr list --repo "$REPO" --head "$branch_name" --json number -q '.[0].number // empty' 2>/dev/null || echo "")

	if [[ -z "$existing_pr" ]]; then
		local commits_ahead
		commits_ahead=$(cd "$worktree_dir" && git rev-list --count origin/main..HEAD 2>/dev/null || echo "0")

		if [[ "$commits_ahead" -gt 0 ]]; then
			log "Opening PR for branch ${branch_name}..."
			local new_pr_url
			new_pr_url=$(cd "$worktree_dir" && \
				gh pr create --repo "$REPO" \
					--title "$(echo "$issue_title")" \
					--body "Work by ${AGENT} agent on #${issue_num}. Needs /peer-review before merge." \
					2>&1) || warn "Failed to create PR"
			# Add authored label
			if [[ -n "$new_pr_url" ]]; then
				local new_pr_num
				new_pr_num=$(echo "$new_pr_url" | grep -o '[0-9]*$')
				gh_retry gh issue edit "$new_pr_num" --repo "$REPO" --add-label "authored-${AGENT}" >/dev/null 2>&1 || true
			fi
		else
			log "No commits ahead of main — nothing to PR."
		fi
	else
		log "PR #${existing_pr} already exists for this branch."
		# Ensure authored label is present even if we didn't create the PR
		gh_retry gh issue edit "$existing_pr" --repo "$REPO" --add-label "authored-${AGENT}" >/dev/null 2>&1 || true
	fi

	# Remove agent assignment so we don't pick it up again
	log "Removing assignment from #${issue_num}..."
	gh issue edit "$issue_num" --repo "$REPO" --remove-label "assigned-${AGENT}" >/dev/null 2>&1 || true
}

# ─── GitHub API call with retry ───────────────────────────────────────────────
gh_retry() {
	local attempt=0
	local max_attempts=3
	local delay=5

	while [[ $attempt -lt $max_attempts ]]; do
		if output=$("$@" 2>&1); then
			echo "$output"
			return 0
		fi

		attempt=$((attempt + 1))
		if echo "$output" | grep -qi "rate limit\|api rate\|connection\|connect"; then
			warn "GitHub API error (attempt ${attempt}/${max_attempts}): ${output:0:100}"
			if [[ $attempt -lt $max_attempts ]]; then
				log "Retrying in ${delay}s..."
				sleep "$delay"
				delay=$((delay * 2))
			fi
		else
			# Non-retryable error
			echo "$output"
			return 1
		fi
	done

	warn "GitHub API failed after ${max_attempts} attempts"
	return 1
}

# ─── Review PRs that this agent didn't author ────────────────────────────────
review_prs() {
	local open_prs
	open_prs=$(gh_retry gh pr list --repo "$REPO" --state open \
		--json number,title,headRefName,labels -q '.[]') || return 0

	if [[ -z "$open_prs" ]]; then
		return 0
	fi

	echo "$open_prs" | jq -c '.' 2>/dev/null | while IFS= read -r pr; do
		local pr_num pr_title pr_branch pr_labels
		pr_num=$(echo "$pr" | jq -r '.number')
		pr_title=$(echo "$pr" | jq -r '.title')
		pr_branch=$(echo "$pr" | jq -r '.headRefName')
		pr_labels=$(echo "$pr" | jq -r '.labels[].name' 2>/dev/null || echo "")

		# Skip if this agent authored it
		if echo "$pr_labels" | grep -q "authored-${AGENT}"; then
			continue
		fi
		# Fallback: also check branch name for PRs created before label existed
		if echo "$pr_branch" | grep -qi "$AGENT"; then
			continue
		fi

		# Skip if already being reviewed by another agent
		if echo "$pr_labels" | grep -q "reviewing-"; then
			continue
		fi

		# Skip if this agent already reviewed it (check label)
		if echo "$pr_labels" | grep -q "reviewed-by-${AGENT}"; then
			continue
		fi

		# Count existing reviews via labels (reviewed-by-* + copilot)
		local review_count=0
		for reviewer in claude cursor codex copilot; do
			if echo "$pr_labels" | grep -q "reviewed-by-${reviewer}"; then
				review_count=$((review_count + 1))
			fi
		done

		# Skip if already has 2+ reviews (copilot + one agent = enough)
		if [[ "$review_count" -ge 2 ]]; then
			continue
		fi

		# Claim the review (optimistic lock)
		gh_retry gh issue edit "$pr_num" --repo "$REPO" --add-label "reviewing-${AGENT}" >/dev/null 2>&1 || true

		# Wait a moment then re-check — if another agent also claimed it, back off
		sleep 2
		local all_reviewing
		all_reviewing=$(gh pr view "$pr_num" --repo "$REPO" --json labels \
			-q '[.labels[].name | select(startswith("reviewing-"))]' 2>/dev/null || echo "[]")
		local reviewer_count
		reviewer_count=$(echo "$all_reviewing" | jq 'length' 2>/dev/null || echo "0")

		if [[ "$reviewer_count" -gt 1 ]]; then
			# Another agent also claimed it — check if we should back off
			# Lower alphabetical agent name wins (deterministic tiebreak)
			local first_reviewer
			first_reviewer=$(echo "$all_reviewing" | jq -r 'sort | .[0]' 2>/dev/null || echo "")
			if [[ "$first_reviewer" != "reviewing-${AGENT}" ]]; then
				log "PR #${pr_num} also claimed by another agent — backing off"
				gh_retry gh issue edit "$pr_num" --repo "$REPO" --remove-label "reviewing-${AGENT}" >/dev/null 2>&1 || true
				continue
			fi
		fi

		log "Reviewing PR #${pr_num}: ${pr_title}"

		# Get the diff
		local diff
		diff=$(gh_retry gh pr diff "$pr_num" --repo "$REPO") || {
			warn "Failed to get diff for PR #${pr_num}"
			gh_retry gh issue edit "$pr_num" --repo "$REPO" --remove-label "reviewing-${AGENT}" >/dev/null 2>&1 || true
			continue
		}

		local review_prompt
		review_prompt="You are reviewing PR #${pr_num}: ${pr_title}

Review this diff for:
1. Correctness — does the code do what the spec says?
2. Test coverage — are behavioral tests included?
3. SPEC.md compliance — interfaces, error handling, AbortSignal, no any types
4. Monorepo conventions — test scripts use 'vitest run', no ../.. paths, no node --test
5. Edge cases — anything missing?
6. Check if Copilot already reviewed — don't repeat what Copilot already flagged

Provide a verdict: APPROVE, REQUEST_CHANGES, or COMMENT.
Be specific and actionable.

--- DIFF ---
${diff}
--- END DIFF ---"

		local review_file
		review_file=$(mktemp /tmp/wtfoc-review-XXXXXXXXXXXX)
		mv "$review_file" "${review_file}.md"
		review_file="${review_file}.md"
		echo "$review_prompt" > "$review_file"

		local review_output=""
		case "$AGENT" in
			cursor)
				review_output=$(cursor agent --print --trust \
					--workspace "$REPO_ROOT" "$(cat "$review_file")" 2>&1) || true
				;;
			codex)
				review_output=$(cat "$review_file" | codex exec -C "$REPO_ROOT" - 2>&1) || true
				;;
			claude)
				review_output=$(cd "$REPO_ROOT" && cat "$review_file" | claude -p - --allowedTools Bash,Read,Glob,Grep 2>&1) || true
				;;
		esac

		rm -f "$review_file" 2>/dev/null || true

		if [[ -n "$review_output" ]]; then
			local comment_body="## Review: ${AGENT}

${review_output}"
			gh_retry gh pr comment "$pr_num" --repo "$REPO" --body "$comment_body" >/dev/null 2>&1 && \
				log "Posted review on PR #${pr_num}" || \
				warn "Failed to post review on PR #${pr_num}"
		fi

		# Swap reviewing → reviewed-by label
		gh_retry gh issue edit "$pr_num" --repo "$REPO" \
			--remove-label "reviewing-${AGENT}" \
			--add-label "reviewed-by-${AGENT}" >/dev/null 2>&1 || true

		# Only review one PR per loop iteration
		break
	done
}

# ─── Main loop ────────────────────────────────────────────────────────────────
log "Starting agent loop for ${AGENT}"

while true; do
	# Step 0: Pull latest main to get script/config updates
	(cd "$REPO_ROOT" && git pull origin main --ff-only 2>/dev/null) || true

	# Step 1: Address feedback on my own PRs (highest priority — unblocks merges)
	log "Checking for PR feedback to address..."
	address_pr_feedback

	# Step 2: Review other agents' PRs (unblocks their work)
	log "Checking for PRs to review..."
	review_prs

	# Step 3: Look for implementation work
	log "Looking for work..."

	issue_json=$(find_issue) || true

	if [[ -z "$issue_json" ]]; then
		if [[ "$ONCE" == "--once" ]]; then
			log "No work available. Exiting (--once mode)."
			exit 0
		fi
		log "No work available. Sleeping 60s..."
		sleep 60
		continue
	fi

	issue_num=$(echo "$issue_json" | jq -r '.number')
	issue_title=$(echo "$issue_json" | jq -r '.title')
	log "Picked up issue #${issue_num}: ${issue_title}"

	# Build prompt and determine worktree
	prompt_output=$(build_prompt "$issue_json")

	# Extract worktree dir from prompt (it's in the "Working directory:" line)
	worktree_dir=$(echo "$prompt_output" | grep "Working directory:" | awk '{print $NF}')

	# Run the agent
	run_agent "$prompt_output" "$worktree_dir"

	# After agent finishes, handle git + PR + label cleanup
	post_agent_cleanup "$issue_num" "$issue_title" "$worktree_dir"

	if [[ "$ONCE" == "--once" ]]; then
		log "Exiting (--once mode)."
		exit 0
	fi

	log "Looking for next task in 10s..."
	sleep 10
done
