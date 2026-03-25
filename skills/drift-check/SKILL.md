---
name: drift-check
description: Detect stale docs and undocumented features by comparing GitHub activity against documentation
allowed-tools: Bash, Read
metadata:
  short-description: Find stale docs and undocumented features
---

# /drift-check

Compare recent GitHub activity against documentation content in a wtfoc collection to find likely-stale docs and undocumented features.

## Arguments

- `-c <collection>` — the collection to analyze (required, must have both doc-page/markdown and github-* source types)

## Steps

### 1. Verify collection has both docs and GitHub data

```bash
npx @wtfoc/cli --json status -c <collection> 2>/dev/null
```

Check that the collection has both documentation (doc-page, markdown) and GitHub (github-issue, github-pr, github-pr-comment) source types. If not, tell the user what's missing and suggest ingest commands.

### 2. Find recent high-activity GitHub topics

Run several queries to find what's been actively discussed/changed recently:

```bash
npx @wtfoc/cli --json query "breaking change migration update" -c <collection> -k 20 2>/dev/null
npx @wtfoc/cli --json query "new feature added implemented shipped" -c <collection> -k 20 2>/dev/null
npx @wtfoc/cli --json query "bug fix resolved fixed patch" -c <collection> -k 20 2>/dev/null
```

From the results, extract the GitHub-sourced results (github-issue, github-pr, github-pr-comment). Group them by topic/feature area. These represent areas where code is actively changing.

### 3. Check each active topic against docs

For each high-activity topic found in step 2, run a trace to see if documentation covers it:

```bash
npx @wtfoc/cli --json trace "<topic extracted from GitHub results>" -c <collection> 2>/dev/null
```

Analyze the results:
- If docs (doc-page, markdown) appear with high scores → docs are likely current
- If only GitHub results appear → docs may be missing or stale
- If docs appear but with low scores or outdated content → docs may need updating

### 4. Produce drift report

Format the results as a structured report:

**Likely Stale Docs** — Documentation pages that reference concepts/APIs that have changed based on recent GitHub activity. For each:
- Doc page URL and what it says
- GitHub evidence of change (issue, PR, or comment)
- Confidence level (high/medium/low)

**Undocumented Features** — Topics with significant GitHub activity but no matching documentation. For each:
- What the feature is (from GitHub issues/PRs)
- Which repo(s) it's in
- Suggested doc page title/location

**Well-Covered Areas** — Topics where docs and GitHub activity align well (brief list, for reassurance).

### 5. Suggest actions

For each finding, suggest a concrete action:
- "Update docs/developer-guides/storage-operations/ to reflect the new partial-success model from synapse-sdk#593"
- "Add documentation for session key permissions (referenced in synapse-sdk#630 but not in docs)"
- Link to relevant GitHub issues/PRs for context
