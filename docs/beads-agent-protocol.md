# Beads Agent Protocol

This repo uses [beads](https://github.com/steveyegge/beads) (`bd`) as a **local agent execution queue** for multi-agent parallel work. GitHub Issues stays canonical for specs and `fixes #N` commit closure — beads is the claim/coordination layer on top.

Read this document **before** using `bd` in this repo. The root `AGENTS.md` has a short inline section with the dangerous rules; this file is the full protocol.

## When to use bd

- Finding next work: `bd ready`
- Coordinating multiple agents so they don't collide on the same task
- PR-review lifecycle (review queue, address-changes tracking)

**Not for**: storing spec text (GitHub Issues), replacing `fixes #N` commit discipline, tracking ephemeral agent scratch (use conversation/notes).

## Actor identity

Every agent sets `BEADS_ACTOR` before running `bd` so the claim mutex has distinct owners. Convention: `<tool>-<hostname>` — for example:

```bash
export BEADS_ACTOR="claude-$(hostname -s)"
export BEADS_ACTOR="codex-$(hostname -s)"
export BEADS_ACTOR="cursor-$(hostname -s)"
```

Humans can set `BEADS_ACTOR="$USER"` or rely on the default (git `user.name`). If `BEADS_ACTOR` is unset, bd falls back to git user.name, then `$USER`. Multiple agents sharing the same actor defeats the mutex — set it explicitly.

## Finding next work

```bash
bd ready                      # unblocked, unclaimed open beads (excludes in_progress, blocked, deferred, hooked)
bd ready --explain            # shows why each bead is ready or blocked
bd ready --exclude-type epic  # skip epic containers
bd show <id>                  # full details including External: link to GH issue
```

Beads imported from GitHub Issues have their spec in the GH issue (follow `External:` link). Beads-native beads (PR-review, address-changes) have their spec inline.

**Before a long claiming session**, run `bd github sync` to pick up new GH issues and state drift.

## Claim

```bash
bd update <id> --claim
```

- **Atomic mutex.** Sets `status=in_progress`, `assignee=$BEADS_ACTOR`, `started_at=<now>`.
- Errors `"issue already claimed by <X>"` if another actor holds it — skip and pick the next `bd ready` item.
- Idempotent for the same actor (safe to retry).
- A claimed bead disappears from `bd ready` for everyone else.

## Work in an isolated worktree

**Implementation beads: always use a dedicated git worktree.** This prevents two agents from colliding in the filesystem.

```bash
# short-id = last path segment of the bead, e.g. "n6tc.2"
SHORT=$(echo <id> | sed 's/.*-//')
git worktree add ../wtfoc-$SHORT -b beads/$SHORT
cd ../wtfoc-$SHORT
```

**Worktree is OPTIONAL for**: review-only beads with no file edits; tiny docs/config edits where the current worktree is clean and the bead is unlikely to overlap.

**Worktree is REQUIRED for**: any bead that may run formatters, tests with generated output (`pnpm test` produces coverage dirs), package installs, broad search/replace, or touches shared files.

**If you skip the worktree and find unexpected local changes**: stop. Move to a worktree before continuing.

When done, `git worktree remove ../wtfoc-$SHORT` and delete the branch.

## Release

- `bd close <id>` — work is complete. Terminal state.
- `bd update <id> --status open` — giving up / decomposing / blocked on external. Non-terminal; bead goes back to ready queue.

**`bd close` does NOT close the backing GitHub Issue.** The GH Issue closes when a commit with `fixes #N` lands on `main`. For beads-native work (no backing GH issue — e.g., PR-review beads, epic bootstrap), `bd close` alone is sufficient.

## Stale claim recovery

**Force-release is exceptional repair, not queue hygiene.** The stale-claim recovery path (`bd update <id> --status open --assignee ""`) is an unchecked write — any actor can steal any claim. Abuse it and agents will undo each other's work.

### When force-release is appropriate

Only when **all three** are true:

1. `started_at` is at least 4 hours old (for implementation beads) or at least 30 minutes (for review/dispatch beads where title/labels make this clear).
2. No recent git activity from the prior claimant (check `git log --author=<actor> --since='4 hours ago'` on the relevant branches).
3. No active worktree at `../wtfoc-<short-id>` with uncommitted changes.

If all three hold:

```bash
bd audit record --kind tool_call --tool-name bd --issue-id <id> \
  --response "force-release: started_at=<ts>, no recent activity from <prior-actor>, worktree empty"
bd update <id> --status open --assignee ""
```

The `bd audit record` call is **mandatory** for force-release — without it, day-30 debugging becomes folklore.

### What you should NOT do

- Release another agent's claim just because `bd ready` is empty.
- Release a claim just because `started_at` is old — 4 hours is normal for non-trivial work.
- Release without running the audit record call.

## PR-review lifecycle

When an agent opens a PR for an implementation bead `<impl-id>`:

```bash
# 1. Create the review bead (beads-native — no backing GH issue)
REVIEW_ID=$(bd create "review PR #<N>" \
  --type task --priority <same as impl> \
  --parent <impl-id> \
  --external-ref "https://github.com/SgtPooki/wtfoc/pull/<N>" \
  --silent)

# 2. Link: impl bead is BLOCKED by review bead (so impl can't close until review does)
bd link <impl-id> $REVIEW_ID --type blocks

# 3. Record the transition
bd audit record --kind tool_call --tool-name bd --issue-id <impl-id> \
  --response "opened PR #<N>, created review bead $REVIEW_ID"
```

**Implementation bead stays `in_progress`** throughout review. There is no `in-review` status; the `blocked-by-review` dependency expresses the wait.

### On review approved

```bash
bd close $REVIEW_ID  # removes the blocker from <impl-id>
bd audit record --kind tool_call --tool-name bd --issue-id $REVIEW_ID \
  --response "review approved"
# impl bead is now unblocked; claimant merges PR, then bd close <impl-id>
# (the fixes #N in the merge commit closes the GH issue automatically)
```

### On changes requested

```bash
ADDRESS_ID=$(bd create "address review on PR #<N>" \
  --type task --priority <same> \
  --parent <impl-id> \
  --external-ref "https://github.com/SgtPooki/wtfoc/pull/<N>" \
  --silent)
bd link $REVIEW_ID $ADDRESS_ID --type blocks  # review bead blocked by address bead
bd close $REVIEW_ID  # alternate pattern: close review as "completed w/ changes requested", re-open a fresh review bead after address bead closes
bd audit record --kind tool_call --tool-name bd --issue-id $REVIEW_ID \
  --response "changes requested; created address bead $ADDRESS_ID"
```

One bead = one actionable unit. Don't leave an open "review" bead that isn't actually the current actionable item.

## Commits

- `fixes #N` (GitHub Issue number) stays the canonical closure target. Place on its own line at the end of the commit body.
- **Never** put a bead ID in the commit message as a closure reference. Bead IDs may appear in the commit body as context (`"claimed bead wtfoc-n6tc.2"`), but closure is via `fixes #N` only.
- For beads-native work with **no backing GH issue** (bootstrap, PR-review, address-changes): no `fixes` line; describe the work in the subject and reference the bead in the body.
- The `prepare-commit-msg` git hook (installed by `bd hooks install`) adds an agent identity trailer automatically. Don't remove it.

## Reconcile (on-demand, not scheduled)

```bash
bd github sync          # bidirectional pull + push
bd github sync --pull-only
bd github sync --dry-run
```

**GH wins for implementation beads**: if a GH issue state changes (closed, re-opened, label update), beads follows on next sync.

**Beads wins for beads-native beads** (PR-review, address-changes, bootstrap epics): no GH counterpart exists; beads is the only source of truth.

Run reconcile:
- At the start of a long session
- When you suspect state drift (e.g., issues closed on GH via PR merge while agent was offline)
- After importing new GH issues created outside bd

## Audit trail

`bd history <id>` reports Dolt commit author as `"root"` — useless for per-agent forensics. Use `bd audit record` manually at these checkpoints:

| Event | Required audit record |
|---|---|
| Force-releasing another claimant's bead | ✅ mandatory |
| Abandoning a claim (`bd update --status open` after claiming) | ✅ mandatory |
| Creating a PR-review bead | ✅ mandatory |
| Review approved / changes-requested transitions | ✅ mandatory |
| Swarm / gate / merge-slot decisions | ✅ mandatory |
| Manual `bd github sync --prefer-local` resolving drift | ✅ mandatory |
| Normal claim (`bd update --claim`) | ❌ skip — bead state captures ownership |
| Normal close (`bd close`) | ❌ skip |

Records append to `.beads/interactions.jsonl`. Git commit forensics (agent identity per commit) are handled separately by `prepare-commit-msg`.

## Anti-patterns

- **Never `bd edit`** — opens `$EDITOR`, hangs non-interactive agents. Always use `bd update <id> --flag`.
- **Use stdin for tricky content** — `bd create "..." --body-file -` or `--stdin` when the description has backticks, `!`, or nested quotes.
- **Always `--json` for programmatic use** — pretty-print is for humans.
- **Don't auto-steal stale claims** — force-release is exceptional repair (see stale-claim section).
- **Don't run `bd` from inside a worktree you're about to delete** — run bd commands from the primary repo path.
- **Don't skip the audit record** when the table above says it's mandatory.

## Known gaps (day-30 watch list)

These are accepted limitations for v1. Revisit if they bite:

- **No heartbeat primitive** — bd has no way to signal "I'm still working." The 4-hour stale threshold is a compromise; a truly stuck claim may park a bead unnecessarily.
- **Per-agent audit is manual** — `bd audit record` discipline depends on agents actually calling it.
- **Force-release is unchecked** — protected only by convention. A misbehaving agent can steal claims without restraint.
- **Bead IDs for imported issues are ugly** (`wtfoc-1776343791092-186-bde0b040`). Only hand-created beads get short IDs (`wtfoc-n6tc`). Live with it or file upstream.
