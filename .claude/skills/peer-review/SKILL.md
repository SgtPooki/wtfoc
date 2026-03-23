---
user-invocable: true
allowed-tools: Bash, Read, Glob, Grep
argument-hint: "[cursor|codex] <prompt>"
description: Get cross-review from Cursor or Codex CLI agents
---

# /peer-review

Get feedback on specs, plans, code changes, or design decisions from Cursor or Codex CLI agents.

**Per the wtfoc constitution:** every spec and significant change must be cross-reviewed by a different agent than the one that created it. Use this skill to run that review.

**Takes arguments:** `[cursor|codex] <prompt>`
- If first word is exactly `cursor` or `codex` (case-insensitive, followed by non-whitespace text), use only that tool
- Otherwise, run both in parallel
- No prompt at all → summarize current conversation context as the review target

Examples:
- `/peer-review cursor Review the 001-store-backend spec for completeness`
- `/peer-review codex What's wrong with this API design?`
- `/peer-review Review this spec` (sends to both in parallel)

## Tools available

| Tool | CLI | Best for |
|------|-----|----------|
| **Cursor** | `cursor agent` | UX review, design feedback, architecture, spec review |
| **Codex** | `codex exec` (plans/designs/arbitrary review) | Arbitrary review prompts with codebase context |
| **Codex** | `codex review --uncommitted` (local code changes only) | Reviewing uncommitted code changes in a repo |

**When to use `codex review` vs `codex exec`:**
- `codex review --uncommitted` — ONLY when reviewing actual uncommitted changes in the current repo
- `codex exec` — for everything else: spec review, plan review, design feedback, reviewing content from conversation/issues, code that isn't in the local diff

## Steps

1. **Parse arguments** — extract tool choice and prompt.
   - Only match `cursor` or `codex` as first word if exactly that word (case-insensitive) AND followed by non-whitespace text
   - `/peer-review cursor` alone (no prompt after tool name) → error, ask user for a prompt
   - `/peer-review` alone → summarize conversation context as prompt, run both tools

2. **Check prerequisites:**
   ```bash
   which cursor 2>/dev/null  # for cursor reviews
   which codex 2>/dev/null   # for codex reviews
   ```
   If a tool is missing, skip it and tell the user. If both missing, error.

3. **Determine workspace path:**
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   ```

4. **Prepare the prompt** — external CLIs do NOT inherit Claude's conversation context. You MUST serialize all relevant content into the prompt:
   - If reviewing a spec, include the full spec text
   - If reviewing a GitHub issue, fetch the body with `gh issue view` and include it
   - If reviewing code, include file paths or diffs
   - Always include relevant context from SPEC.md and the constitution
   - The prompt should specify what kind of feedback you want
   - **For large prompts** (full diffs, long specs): write the prompt to a temp file and reference it:
     ```bash
     PROMPT_FILE=$(mktemp /tmp/peer-review-XXXXXX.md)
     cat > "$PROMPT_FILE" <<'EOF'
     Your long review prompt here...
     EOF
     ```
     Then pass the file content via stdin or command substitution (see step 5).

5. **Run the review(s):**

   **Cursor** (any review type):
   ```bash
   # Short prompts:
   cursor agent --model composer-2 --mode ask --print --trust \
     --workspace "$REPO_ROOT" "Your prompt here"

   # Long prompts (avoid argv limits — write to temp file first):
   cursor agent --model composer-2 --mode ask --print --trust \
     --workspace "$REPO_ROOT" "$(cat "$PROMPT_FILE")"
   ```
   Notes:
   - `--model composer-2` — use Cursor's own model, NOT Claude/GPT pass-through
   - `--mode ask` — Q&A/read-only intent
   - `--print --trust` — non-interactive, no GUI
   - Cursor has no stdin mode — `"$(cat file)"` is the best option for long prompts
   - If prompt exceeds ~100KB, split into a summary + "see file at $PROMPT_FILE for full context"

   **Codex** (plan/design/arbitrary review):
   ```bash
   # Short prompts:
   codex exec "Your prompt here"

   # Long prompts (use stdin):
   cat "$PROMPT_FILE" | codex exec -
   ```
   Notes:
   - `codex exec -` reads prompt from stdin — handles any prompt size cleanly
   - Codex runs from the current working directory, so `cd` to the relevant repo first
   - If not in a git repo, add `--skip-git-repo-check`
   - Do NOT hardcode model — uses configured default

   **Codex** (uncommitted code changes only):
   ```bash
   codex review --uncommitted "Optional custom review instructions"
   ```
   Notes:
   - `--uncommitted` is required to review local changes (without it, scope is ambiguous)
   - Only use this when reviewing actual changes in the working tree, not conversation content

6. **When running both in parallel**, use `run_in_background: true` for both Bash calls. When both complete, present both results. If one fails, still present the other's results.

7. **Handle failures gracefully:**
   - If a tool exits non-zero, show stderr output to the user
   - If a tool takes longer than 5 minutes, note the timeout
   - Never silently swallow errors — surface them

8. **Present results** clearly labeled:
   - In conversation: `## Cursor feedback` and `## Codex feedback`
   - For GitHub issues: post as separate comments with `## Review: Cursor` and `## Review: Codex`

9. **Apply feedback as new comments — never edit the original spec/plan.**
   - The original spec preserves the starting context and must not be modified directly.
   - After each review round, post a **consolidated improvements comment** on the issue thread summarizing what feedback was accepted and how it changes the spec.
   - Each subsequent review round's prompt must include both the **original spec** and **all prior improvement comments** so the reviewer sees the current full state.
   - This creates an auditable trail: original spec → review feedback → improvements applied → ...

## Important

- **Serialize context into prompts** — external CLIs cannot see Claude's conversation
- Both tools may take 1-3 minutes to respond
- The prompt should specify what kind of feedback you want (spec completeness, API design, code quality, etc.)
- **Git repo required for Codex** — `codex exec` fails outside a git repo unless `--skip-git-repo-check` is passed
- **Large prompts** — Cursor has no stdin mode. For large content, write to a temp file first, then use `"$(cat $PROMPT_FILE)"`. Codex supports stdin natively via `codex exec -`.
