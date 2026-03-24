---
name: peer-review
description: Get cross-review from Cursor, Codex, or Claude CLI agents for specs, plans, code changes, pull requests, or design decisions. Use when work in this repository needs feedback from a different agent, especially to satisfy the constitution requirement that every spec and significant change be cross-reviewed before ratification or merge.
allowed-tools: Bash, Read, Glob, Grep
metadata:
  short-description: Run cross-agent reviews from the repo
---

# Peer Review

Get feedback on specs, plans, code changes, or design decisions from Cursor, Codex, or Claude CLI agents.

Follow the wtfoc constitution: cross-review every spec and significant change with a different agent than the one that created it.

Accept arguments in the form `[cursor|codex|claude] <prompt>`.
- If the first word is exactly `cursor`, `codex`, or `claude` and is followed by non-whitespace text, use only that tool.
- Otherwise, run all available tools in parallel.
- If no prompt is provided, summarize the current conversation context as the review target.

Examples:
- `/peer-review cursor Review the 001-store-backend spec for completeness`
- `/peer-review codex What's wrong with this API design?`
- `/peer-review claude Review this PR for edge cases`
- `/peer-review Review this spec` (sends to all available agents in parallel)

## Tools available

| Tool | CLI | Best for |
|------|-----|----------|
| **Cursor** | `cursor agent` | UX review, design feedback, architecture, spec review |
| **Claude** | `claude -p` | Deep code review, spec review, architecture analysis |
| **Codex** | `codex exec` (plans/designs/arbitrary review) | Arbitrary review prompts with codebase context |
| **Codex** | `codex review --uncommitted` (local code changes only) | Reviewing uncommitted code changes in a repo |

**When to use `codex review` vs `codex exec`:**
- `codex review --uncommitted` — ONLY when reviewing actual uncommitted changes in the current repo
- `codex exec` — for everything else: spec review, plan review, design feedback, reviewing content from conversation/issues, code that isn't in the local diff

## Steps

1. Parse arguments.
   - Match `cursor`, `codex`, or `claude` as the first word only if that exact word is present and followed by non-whitespace text.
   - Treat `/peer-review claude` with no remaining prompt as an error and ask for a prompt.
   - Treat `/peer-review` with no prompt as a request to summarize the current conversation context and run all available tools.

2. Check prerequisites:
   ```bash
   which cursor 2>/dev/null  # for cursor reviews
   which codex 2>/dev/null   # for codex reviews
   which claude 2>/dev/null  # for claude reviews
   ```
   Skip missing tools and report them. If every tool is missing, fail.

3. Determine the workspace path:
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   ```

4. Prepare the prompt. External CLIs do not inherit the current session context, so serialize everything needed for review.
   - **CRITICAL:** Always prepend the following instruction to every prompt sent to an external agent:
     `"You are being invoked as a reviewer. Provide YOUR OWN review directly. Do NOT invoke other tools, agents, or CLIs (cursor, codex, claude) — you are the reviewer, not a dispatcher."`
   - This prevents recursive agent invocation where Codex tries to call Cursor/Claude from within its review.
   - Include the full spec text when reviewing a spec.
   - Fetch and include the GitHub issue body with `gh issue view` when reviewing an issue.
   - Include file paths or diffs when reviewing code.
   - Include relevant context from `SPEC.md` and the constitution.
   - State the kind of feedback required.
   - For large prompts such as full diffs or long specs, write the prompt to a temp file:
     ```bash
     PROMPT_FILE=$(mktemp /tmp/peer-review-XXXXXXXXXXXX)
     mv "$PROMPT_FILE" "${PROMPT_FILE}.md"
     PROMPT_FILE="${PROMPT_FILE}.md"
     cat > "$PROMPT_FILE" <<'EOF'
     Your long review prompt here...
     EOF
     ```
   - Pass the file content via stdin or command substitution as described in step 5.

5. Run the review:

   **Cursor** (any review type):
   ```bash
   # Short prompts:
   cursor agent --print --trust \
     --workspace "$REPO_ROOT" "Your prompt here"

   # Long prompts (avoid argv limits — write to temp file first):
   cursor agent --print --trust \
     --workspace "$REPO_ROOT" "$(cat "$PROMPT_FILE")"
   ```
   Notes:
   - Use `--print --trust` for non-interactive execution without the GUI.
   - Use `"$(cat "$PROMPT_FILE")"` for long prompts because Cursor has no stdin mode.
   - If the prompt exceeds about 100 KB, send a summary plus a pointer to the temp file.

   **Claude** (any review type):
   ```bash
   # Short prompts:
   cd "$REPO_ROOT" && claude -p "Your prompt here" --allowedTools Bash,Read,Glob,Grep

   # Long prompts (use stdin):
   cd "$REPO_ROOT" && cat "$PROMPT_FILE" | claude -p - --allowedTools Bash,Read,Glob,Grep
   ```
   Notes:
   - Use `claude -p` for non-interactive execution.
   - Restrict review runs to `Bash,Read,Glob,Grep`.
   - Change into the repo root before invoking Claude.
   - Let Claude read files with its tools when needed for code review.

   **Codex** (plan/design/arbitrary review):
   ```bash
   # Short prompts:
   codex exec "Your prompt here"

   # Long prompts (use stdin):
   cat "$PROMPT_FILE" | codex exec -
   ```
   Notes:
   - Use `codex exec -` for stdin-based prompts of any size.
   - Change into the relevant repo before invoking Codex.
   - Add `--skip-git-repo-check` only when not in a git repo.
   - Do not hardcode a model.

   **Codex** (uncommitted code changes only):
   ```bash
   codex review --uncommitted "Optional custom review instructions"
   ```
   Notes:
   - Require `--uncommitted` for working tree review.
   - Use this only for real local diffs, not for conversation content.

6. When running multiple reviews in parallel, use background execution for all Bash calls. Present every completed result even if one review fails.

7. Handle failures explicitly.
   - Show stderr output when a tool exits non-zero.
   - Report timeouts after 5 minutes.
   - Never swallow errors silently.

8. Present results with clear labels.
   - In conversation, use `## Cursor feedback`, `## Claude feedback`, and `## Codex feedback`.
   - For GitHub issues, post separate comments headed `## Review: Cursor`, `## Review: Claude`, and `## Review: Codex`.

9. Apply feedback as new comments rather than editing the original spec or plan.
   - Preserve the original spec as the starting context.
   - After each review round, post a consolidated improvements comment describing accepted feedback and resulting changes.
   - Include both the original spec and prior improvement comments in later review prompts so the reviewer sees the current state.
   - Maintain an auditable trail from original spec to accepted improvements.

## Important

- Serialize context into prompts because external CLIs cannot see the current session conversation.
- All tools may take 1-5 minutes to respond
- Specify the feedback type clearly, such as spec completeness, API design, or code quality.
- `codex exec` requires a git repo unless `--skip-git-repo-check` is passed.
- Cursor has no stdin mode, so use a temp file for large prompts. Claude and Codex support stdin.
- Keep the reviewer different from the authoring agent. If Claude wrote the work, review with Cursor or Codex. If Cursor wrote it, review with Claude or Codex.
