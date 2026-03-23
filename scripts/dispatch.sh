#!/usr/bin/env bash
set -euo pipefail

# dispatch.sh — Orchestrate spec-kit flow across multiple agents
#
# Usage:
#   ./scripts/dispatch.sh spec "Store Backend" "Implement @wtfoc/store with local + FOC backends"
#   ./scripts/dispatch.sh implement <issue-number> <agent>
#   ./scripts/dispatch.sh status
#
# Agents: claude, cursor, codex
# Labels: assigned-claude, assigned-cursor, assigned-codex, spec, implementation

REPO="SgtPooki/wtfoc"
VALID_AGENTS=("claude" "cursor" "codex")

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[dispatch]${NC} $*"; }
warn() { echo -e "${YELLOW}[dispatch]${NC} $*"; }
err() { echo -e "${RED}[dispatch]${NC} $*" >&2; }

ensure_labels() {
	for label in spec implementation assigned-claude assigned-cursor assigned-codex blocked ready; do
		gh label create "$label" --repo "$REPO" 2>/dev/null || true
	done
}

# ─── spec: Create a spec issue + branch ───────────────────────────────────────
cmd_spec() {
	local title="$1"
	local description="${2:-}"
	local agent="${3:-claude}"

	validate_agent "$agent"
	ensure_labels

	# Create spec number (next available)
	local spec_num
	spec_num=$(printf "%03d" "$(( $(gh issue list --repo "$REPO" --label spec --json number -q 'length') + 1 ))")
	local branch_name="${spec_num}-$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')"
	local full_title="[spec] ${spec_num}: ${title}"

	log "Creating spec issue: ${full_title}"
	local issue_url
	issue_url=$(gh issue create --repo "$REPO" \
		--title "$full_title" \
		--label "spec,assigned-${agent}" \
		--body "$(cat <<EOF
## Spec: ${title}

${description}

### Workflow

- [ ] \`/speckit.specify\` — create specification
- [ ] \`/speckit.clarify\` — resolve ambiguities
- [ ] \`/peer-review\` — cross-review by different agent
- [ ] Address review feedback
- [ ] \`/speckit.plan\` — create implementation plan
- [ ] \`/speckit.tasks\` — generate task breakdown
- [ ] PR merged with ratified spec

### Agent Assignment

Assigned to: **${agent}**
Branch: \`${branch_name}\`

### Instructions for assigned agent

1. Check out branch \`${branch_name}\`
2. Run the spec-kit flow (specify → clarify → peer-review → plan → tasks)
3. Commit spec artifacts to \`.specify/specs/${branch_name}/\`
4. Open a PR back to main
5. After PR merge, implementation issues will be created from tasks
EOF
)")

	local issue_num
	issue_num=$(echo "$issue_url" | grep -o '[0-9]*$')
	log "Issue created: ${issue_url}"

	# Create branch + worktree for isolation
	local worktree_dir="../wtfoc-worktrees/${branch_name}"
	git fetch origin main 2>/dev/null || true
	git branch "$branch_name" origin/main 2>/dev/null || git branch "$branch_name" main 2>/dev/null || true

	mkdir -p "$(dirname "$worktree_dir")"
	git worktree add "$worktree_dir" "$branch_name" 2>/dev/null || true
	log "Worktree created: ${worktree_dir}"

	# Bootstrap the worktree
	if [[ -d "$worktree_dir" ]]; then
		log "Installing dependencies in worktree..."
		(cd "$worktree_dir" && pnpm install --frozen-lockfile 2>/dev/null) || true
	fi

	echo ""
	log "Next steps for ${agent}:"
	echo "  cd ${worktree_dir}"
	echo "  # Run /speckit.specify, /speckit.clarify, /peer-review, /speckit.plan, /speckit.tasks"
	echo "  # Commit and push, then open PR"
	echo ""
	echo "Or to start the agent directly:"
	echo "  cd ${worktree_dir} && claude  # or cursor, or codex"
}

# ─── implement: Create implementation issues from a merged spec ───────────────
cmd_implement() {
	local spec_issue="$1"
	local agent="${2:-}"

	ensure_labels

	# Get spec issue title
	local spec_title
	spec_title=$(gh issue view "$spec_issue" --repo "$REPO" --json title -q '.title' | sed 's/\[spec\] //')

	log "Creating implementation issues from spec #${spec_issue}: ${spec_title}"

	# If no specific agent, create unassigned
	local label_arg=""
	if [[ -n "$agent" ]]; then
		validate_agent "$agent"
		label_arg="--label assigned-${agent}"
	fi

	# Create branch name for implementation
	local impl_branch="impl-$(echo "$spec_title" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | head -c 50)"

	local impl_url
	impl_url=$(gh issue create --repo "$REPO" \
		--title "[impl] ${spec_title}" \
		--label "implementation" \
		${label_arg} \
		--body "$(cat <<EOF
## Implementation: ${spec_title}

Spec: #${spec_issue}
Branch: \`${impl_branch}\`

### Instructions

1. Check out the worktree: \`cd ../wtfoc-worktrees/${impl_branch}\`
2. Read the ratified spec in \`.specify/specs/\` (linked from #${spec_issue})
3. Follow \`/speckit.implement\` to execute the task breakdown
4. Commit changes, push, open PR referencing this issue (\`Fixes #<this-issue>\`)

### Rules

- All changes must have behavioral tests
- \`pnpm test\` and \`pnpm lint\` must pass
- Each commit is atomic and produces a working state
- Follow SPEC.md and AGENTS.md conventions
EOF
)")

	local impl_num
	impl_num=$(echo "$impl_url" | grep -o '[0-9]*$')
	log "Implementation issue created: ${impl_url}"

	# Create worktree for the implementation
	git fetch origin main 2>/dev/null || true
	git branch "$impl_branch" origin/main 2>/dev/null || git branch "$impl_branch" main 2>/dev/null || true

	local worktree_dir="../wtfoc-worktrees/${impl_branch}"
	mkdir -p "$(dirname "$worktree_dir")"
	git worktree add "$worktree_dir" "$impl_branch" 2>/dev/null || true

	if [[ -d "$worktree_dir" ]]; then
		log "Worktree created: ${worktree_dir}"
		(cd "$worktree_dir" && pnpm install --frozen-lockfile 2>/dev/null) || true
	fi

	if [[ -n "$agent" ]]; then
		log "Assigned to: ${agent}"
		echo ""
		echo "Start the agent:"
		echo "  cd ${worktree_dir} && claude  # or cursor, or codex"
	else
		warn "No agent assigned. Assign with:"
		echo "  ./scripts/dispatch.sh assign ${impl_num} <agent>"
	fi
}

# ─── status: Show current work across all agents ─────────────────────────────
cmd_status() {
	echo ""
	log "=== wtfoc dispatch status ==="
	echo ""

	for agent in "${VALID_AGENTS[@]}"; do
		local count
		count=$(gh issue list --repo "$REPO" --label "assigned-${agent}" --state open --json number -q 'length')
		if [[ "$count" -gt 0 ]]; then
			echo -e "${BLUE}${agent}${NC} (${count} open):"
			gh issue list --repo "$REPO" --label "assigned-${agent}" --state open --json number,title -q '.[] | "  #\(.number) \(.title)"'
		else
			echo -e "${BLUE}${agent}${NC}: idle"
		fi
		echo ""
	done

	local unassigned
	unassigned=$(gh issue list --repo "$REPO" --state open --json labels,number,title -q '[.[] | select(.labels | map(.name) | (contains(["assigned-claude"]) or contains(["assigned-cursor"]) or contains(["assigned-codex"])) | not)] | length')
	if [[ "$unassigned" -gt 0 ]]; then
		warn "Unassigned issues: ${unassigned}"
		gh issue list --repo "$REPO" --state open --json labels,number,title -q '[.[] | select(.labels | map(.name) | (contains(["assigned-claude"]) or contains(["assigned-cursor"]) or contains(["assigned-codex"])) | not)] | .[] | "  #\(.number) \(.title)"'
	fi

	echo ""
	log "Open PRs:"
	gh pr list --repo "$REPO" --state open --json number,title,author -q '.[] | "  #\(.number) \(.title) (@\(.author.login))"' || echo "  (none)"
}

# ─── assign: Assign an existing issue to an agent ────────────────────────────
cmd_assign() {
	local issue_num="$1"
	local agent="$2"

	validate_agent "$agent"

	# Remove any existing agent labels
	for a in "${VALID_AGENTS[@]}"; do
		gh issue edit "$issue_num" --repo "$REPO" --remove-label "assigned-${a}" 2>/dev/null || true
	done

	gh issue edit "$issue_num" --repo "$REPO" --add-label "assigned-${agent}"
	log "Issue #${issue_num} assigned to ${agent}"
}

validate_agent() {
	local agent="$1"
	local valid=false
	for a in "${VALID_AGENTS[@]}"; do
		if [[ "$a" == "$agent" ]]; then
			valid=true
			break
		fi
	done
	if [[ "$valid" == "false" ]]; then
		err "Invalid agent: ${agent}. Must be one of: ${VALID_AGENTS[*]}"
		exit 1
	fi
}

# ─── cleanup: Remove merged worktrees ─────────────────────────────────────────
cmd_cleanup() {
	log "Pruning stale worktrees..."
	git worktree prune

	local worktree_base="../wtfoc-worktrees"
	if [[ -d "$worktree_base" ]]; then
		for wt in "$worktree_base"/*/; do
			local branch
			branch=$(basename "$wt")
			# Check if the branch has been merged to main
			if git branch --merged main 2>/dev/null | grep -q "$branch"; then
				log "Removing merged worktree: ${wt}"
				git worktree remove "$wt" --force 2>/dev/null || true
				git branch -d "$branch" 2>/dev/null || true
			else
				warn "Keeping unmerged worktree: ${wt}"
			fi
		done
	fi

	log "Cleanup complete"
}

# ─── main ────────────────────────────────────────────────────────────────────
case "${1:-}" in
	spec)
		shift
		cmd_spec "${1:-}" "${2:-}" "${3:-claude}"
		;;
	implement)
		shift
		cmd_implement "${1:-}" "${2:-}"
		;;
	status)
		cmd_status
		;;
	assign)
		shift
		cmd_assign "${1:-}" "${2:-}"
		;;
	cleanup)
		cmd_cleanup
		;;
	*)
		echo "Usage:"
		echo "  dispatch.sh spec <title> [description] [agent]  — Create spec issue + worktree"
		echo "  dispatch.sh implement <spec-issue> [agent]      — Create impl issue + worktree from spec"
		echo "  dispatch.sh assign <issue> <agent>               — Assign issue to agent"
		echo "  dispatch.sh status                                — Show work across all agents"
		echo "  dispatch.sh cleanup                               — Remove merged worktrees"
		echo ""
		echo "Agents: claude, cursor, codex"
		echo ""
		echo "Each agent gets an isolated git worktree at ../wtfoc-worktrees/<branch>/"
		echo "so multiple agents can work in parallel without conflicts."
		;;
esac
