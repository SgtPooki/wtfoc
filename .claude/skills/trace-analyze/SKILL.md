---
user-invocable: true
allowed-tools: Bash, Read
argument-hint: "<question> -c <collection>"
description: Trace a question across sources and synthesize an analysis
---

# /trace-analyze

Run a `wtfoc trace` against a collection, automatically expand the search to fill gaps, and synthesize all results into a structured analysis.

## Arguments

- `<question>` — the natural-language question to trace (required)
- `-c <collection>` — the collection to search (required)
- `--deep` — run automatic follow-up traces to fill gaps (default behavior, use `--shallow` to skip)
- `--max-total <n>` — max total results per trace (default: 15, increase to 50-100 for richer traces)
- `--max-per-source <n>` — max results per source type (default: 3, increase to 10-20 for deeper coverage)
- `--max-hops <n>` — max edge hops to follow (default: 3, increase to 5-8 for longer chains)

Examples:
- `/trace-analyze how does file upload work -c foc-ecosystem`
- `/trace-analyze session key authorization -c foc-ecosystem`

## Steps

### 1. Parse arguments

Extract the question and collection name from the arguments. If `-c` is missing, list available collections by running:

```bash
ls ~/.wtfoc/manifests/ 2>/dev/null | sed 's/\.json$//'
```

and ask the user which collection to use.

### 2. Run the primary trace

```bash
node packages/cli/dist/cli.js --json trace "<question>" -c <collection> --mode analytical --embedder api --embedder-url ollama --embedder-model nomic-embed-text --max-total 50 --max-per-source 10 --max-hops 6 2>/dev/null
```

Also show the human-readable output:
```bash
node packages/cli/dist/cli.js trace "<question>" -c <collection> --mode analytical --embedder api --embedder-url ollama --embedder-model nomic-embed-text --max-total 50 --max-per-source 10 --max-hops 6 2>/dev/null
```

> **Note:** `--mode analytical` adds cross-source insights (convergence, evidence chains, temporal clusters) to the trace output. These help identify patterns across sources that pure retrieval misses.

### 3. Analyze gaps and run expansion traces

After the primary trace, analyze which source types and conceptual areas are missing. A feature trace typically needs coverage across these layers:

- **Documentation** (doc-page, markdown)
- **Implementation** (code)
- **Discussion** (github-issue, github-pr, github-pr-comment)
- **Tests** (code with test patterns)
- **Infrastructure/backend** (related services, contracts, configs)

For each significant gap, construct a targeted follow-up query and run it:

```bash
./wtfoc --json trace "<targeted follow-up query>" -c <collection> --mode analytical 2>/dev/null
```

**Examples of gap-filling queries:**
- If no backend/SP results: trace "what happens on the storage provider side after <topic>"
- If no test results: trace "<topic> test coverage unit test integration"
- If no contract/on-chain results: trace "<topic> smart contract on-chain solidity"
- If only one repo found: trace "<topic> <other-known-repo-name>"

Run up to 3 expansion traces. Collect all unique results (dedup by ID).

### 4. Synthesize the full analysis

Combine results from ALL traces (primary + expansions) and produce a structured report:

**Summary** — A 2-3 sentence answer to the question based on all trace results.

**Evidence Chain** — Walk through the results in logical order (not by source type), reconstructing the narrative. For each key piece of evidence, cite:
- What it says (brief quote or paraphrase)
- Where it came from (source type, file/URL)
- Relevance score
- Which trace found it (primary or which expansion)

**Cross-Source Connections** — Highlight where different source types corroborate or complement each other.

**Open Issues & Friction** — List any GitHub issues, PR comments, or discussions that indicate unresolved problems, DX friction, or known bugs.

**Remaining Gaps** — Note what was still NOT found after expansion traces.

### 5. Suggest follow-up traces

Based on the remaining gaps, suggest 2-3 additional trace queries. Format as runnable commands:

```bash
./wtfoc trace "suggested follow-up" -c <collection>
```

Or suggest running this skill again with a more targeted question:
```
/trace-analyze <more targeted question> -c <collection>
```
