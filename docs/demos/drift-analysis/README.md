# Demo: Drift Analysis — Find Stale Docs and Undocumented Features

Docs drift from code. Features ship without docs. Drift analysis finds both.

## The Point

`/drift-check` compares recent GitHub activity (issues, PRs, code changes) against documentation content in the same collection. It surfaces:

- **Stale docs** — pages referencing concepts that have changed
- **Undocumented features** — features with significant GitHub activity but no matching docs
- **Well-covered areas** — topics where docs and code align (the good news)

No LLM is needed for the data layer — `wtfoc trace` and `query` do the heavy lifting. The skill orchestrates the queries and synthesizes the report.

## Run It

### Automated setup + manual queries

```bash
./docs/demos/drift-analysis/run.sh
```

This builds a collection with both docs and GitHub sources, then runs the same queries that `/drift-check` uses under the hood — so you can see how the pieces fit together.

### Full automated drift report

In Claude Code, after the collection exists:

```
/drift-check -c drift-analysis-demo
```

Or against the upload-flow-trace collection:

```
/drift-check -c foc-upload-flow
```

## What Happens

### Collection setup

The quick demo ingests this repo (which has both code and markdown docs):

```bash
./wtfoc init drift-analysis-demo --local
./wtfoc ingest repo SgtPooki/wtfoc -c drift-analysis-demo
```

> **Note:** This demo is contrived for speed (~2 min). For real-world drift analysis comparing docs sites against GitHub activity across multiple repos, use `--collection foc-upload-flow` with a pre-built collection that has both documentation and GitHub sources.

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
# Full setup + manual queries
./docs/demos/drift-analysis/run.sh

# Manual queries only (collection must exist)
./docs/demos/drift-analysis/run.sh --skip-ingest

# Against upload-flow-trace collection
./docs/demos/drift-analysis/run.sh --collection foc-upload-flow

# Full automated report (in Claude Code)
/drift-check -c foc-upload-flow
```
