# Demo: Drift Analysis — Find Stale Docs and Undocumented Features

Docs drift from code. Features ship without docs. Drift analysis finds both.

## The Point

`/drift-check` compares recent GitHub activity (issues, PRs, code changes) against documentation content in the same collection. It surfaces:

- **Stale docs** — pages referencing concepts that have changed
- **Undocumented features** — features with significant GitHub activity but no matching docs
- **Well-covered areas** — topics where docs and code align (the good news)

No LLM is needed for the data layer — `wtfoc trace` and `query` do the heavy lifting. The skill orchestrates the queries and synthesizes the report.

## Prerequisites

Run the [Quick Start](../quick-start/) demo first to create the `wtfoc-quick-start` collection.

## Run It

### Manual queries (what this script does)

```bash
./docs/demos/drift-analysis/run.sh
```

This runs the same queries that `/drift-check` uses under the hood against an existing collection (default: `wtfoc-quick-start`) — so you can see how the pieces fit together.

Or against a different collection:

```bash
./docs/demos/drift-analysis/run.sh --collection foc-upload-flow
```

### Full automated drift report

In Claude Code, after the collection exists:

```
/drift-check -c wtfoc-quick-start
```

Or against the upload-flow-trace collection:

```
/drift-check -c foc-upload-flow
```

## What Happens

> **Note:** This demo is contrived for speed — it runs queries in seconds on a single-repo collection. For real-world drift analysis comparing docs sites against GitHub activity across multiple repos, use `--collection foc-upload-flow` with a pre-built collection that has both documentation and GitHub sources.

### How drift-check works

1. Verifies collection has both doc-type and GitHub-type sources
2. Queries for high-activity GitHub topics:
   - `"breaking change migration update"`
   - `"new feature added implemented shipped"`
   - `"bug fix resolved fixed patch"`
3. For each active topic, runs `trace` to check if documentation covers it
4. Compares GitHub-side results against doc-side results
5. Produces a structured report

### Real-world findings

When tested on a 15,939-chunk FOC ecosystem collection, drift-check found:

- `presignForCommit()` step is referenced in PRs but missing from the upload docs
- Upload behavior for large files vs small files is documented differently than what the SDK actually does
- Contract upgrade procedures (from curio PRs) have no corresponding documentation page

## The Demo Line

> "I ingested the docs site and 90 days of GitHub activity into the same collection. The drift check found 3 documentation gaps — including a critical upload step that's in the code but not in the docs. No one asked for this; the system found it by comparing what the docs say against what the PRs changed."

## How It Differs from Gap Analysis

| | Gap Analysis | Drift Analysis |
|---|---|---|
| **Finds** | Missing sources (repos/sites not ingested) | Stale content within ingested sources |
| **Method** | Unresolved edges → suggested sources | Compare docs vs GitHub activity |
| **Command** | `suggest-sources` / `unresolved-edges` | `/drift-check` skill |
| **Needs** | Any collection | Collection with both docs and GitHub sources |

They complement each other: gap analysis tells you what to ingest, drift analysis tells you what to update.

## Reproduction

```bash
# Default (uses wtfoc-quick-start collection)
./docs/demos/drift-analysis/run.sh

# Against upload-flow-trace collection (richer results)
./docs/demos/drift-analysis/run.sh --collection foc-upload-flow

# Full automated report (in Claude Code)
/drift-check -c foc-upload-flow
```
