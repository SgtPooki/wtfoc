---
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: "[retro|next]"
description: Find next highest-ROI task and follow spec-kit flow
---

# /next-task

Find the next highest-ROI action item and execute it through the spec-kit flow. No skipping steps.

**Arguments:**
- `/next-task` — find and work on the next highest-ROI task
- `/next-task retro` — write retroactive specs for unspecced work
- `/next-task next` — find next unimplemented task from existing specs

## Steps

### 1. Assess current state

```bash
# Check open issues by priority
gh issue list --repo SgtPooki/wtfoc --state open --json number,title,labels -q '.[] | "#\(.number) [\(.labels | map(.name) | join(", "))] \(.title)"' | sort -t'#' -k2 -n

# Check what has specs vs what doesn't
ls .specify/specs/*/spec.md 2>/dev/null

# Check what's implemented but unspecced
git log --oneline --since="today" | head -20
```

### 2. If `retro` — write retroactive specs for unspecced work

For each feature that was implemented without a spec:
1. Create a spec directory: `.specify/specs/NNN-feature-name/`
2. Write `spec.md` documenting what was ACTUALLY built (not aspirational)
3. Mark status as "Implemented (retroactive spec)"
4. Run `/peer-review` on the spec
5. Commit

### 3. If `next` — find highest-ROI unimplemented task

Priority order:
1. **Demo blockers** — anything that prevents the hackathon demo from working
2. **Architecture gaps** — schema/interface issues that become harder to fix later
3. **Ready issues** — GitHub issues labeled `ready` with all deps met
4. **Blocked issues** — check if any blockers were resolved

### 4. Execute the spec-kit flow (NON-NEGOTIABLE)

For the selected task:

1. **Check for existing spec** — does `.specify/specs/` have one?
2. **If no spec exists:**
   - `/speckit.specify` — write the spec
   - `/speckit.clarify` — resolve ambiguities
   - `/peer-review` — cross-review by different agent
   - Address feedback
3. **If spec exists but no plan:**
   - `/speckit.plan` — create implementation plan
4. **If plan exists but no tasks:**
   - `/speckit.tasks` — generate task breakdown
5. **Implement** — follow the task breakdown
6. **Test** — `pnpm test` must pass
7. **Lint** — `pnpm lint:fix`
8. **Commit** — atomic, conventional commit
9. **Push** — to branch, open PR if not on main

### 5. Report

After completing, report:
- What was done
- What spec was created/updated
- What's next in the priority queue

## Important

- **NEVER skip the spec step.** If there's no spec, write one first.
- **NEVER implement without a plan.** The plan prevents wasted work.
- **Retroactive specs are better than no specs.** If work was already done, document it.
- **Cross-review is required.** Use `/peer-review` on every spec.
- **One task at a time.** Don't start the next task until the current one is committed.
