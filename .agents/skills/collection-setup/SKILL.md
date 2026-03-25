---
user-invocable: true
allowed-tools: Bash, Read
argument-hint: "<project-description>"
description: Interactively set up a wtfoc collection from a project description
---

# /collection-setup

Interactively guide the user through setting up a wtfoc collection for their project.

## Arguments

- `<project-description>` — a brief description of the project or team (e.g., "Filecoin storage SDK and docs")

## Steps

### 1. Understand the project

Ask the user (or infer from the description) what sources their project uses:
- GitHub repos (which orgs/repos?)
- Documentation sites (URLs?)
- Slack workspace (do they have a bot token?)
- Discord server (do they have an export or bot token?)
- Local code repos (paths?)

### 2. Suggest a collection plan

Based on the project description, suggest:
- A collection name (short, descriptive)
- Which sources to ingest and in what order (docs sites first for quick value, then GitHub, then code)
- Estimated chunk counts based on typical sizes
- Whether to use `--since` for GitHub (recommend 90d for first run)
- Recommended `--batch-size` for large repos

Format as a numbered list of commands the user will approve before running.

### 3. Create and populate the collection

After user approval, run the commands:

```bash
./wtfoc init <collection-name> --local

# Docs sites (fast, high value)
./wtfoc ingest website <url> -c <collection-name>

# GitHub issues/PRs (medium speed)
./wtfoc ingest github <org/repo> -c <collection-name> --since 90d

# Source code (slow, use batching)
./wtfoc ingest repo <org/repo> -c <collection-name> --batch-size 200
```

Show progress after each ingest step with `./wtfoc status -c <collection-name>`.

### 4. Validate with a test trace

After ingestion, run a relevant test trace to confirm the collection is working:

```bash
./wtfoc trace "<relevant question about the project>" -c <collection-name> 2>/dev/null
```

Pick a question that should return results from multiple source types.

### 5. Summary

Show the final collection status and suggest next steps:
- How to run traces: `./wtfoc trace "your question" -c <collection-name>`
- How to use trace-analyze: `/trace-analyze <question> -c <collection-name>`
- How to add more sources later (incremental, resumable)
- Remind that re-running ingest is safe (dedup skips existing chunks)
