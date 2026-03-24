---
user-invocable: true
allowed-tools: Bash, Read
argument-hint: "<question> -c <collection>"
description: Trace a question across sources and synthesize an analysis
---

# /trace-analyze

Run a `wtfoc trace` against a collection and synthesize the results into a structured analysis.

## Arguments

- `<question>` — the natural-language question to trace (required)
- `-c <collection>` — the collection to search (required)

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

### 2. Run the trace

Run wtfoc trace with JSON output for structured data, and human output for display:

```bash
TRACE_JSON=$(./wtfoc --json trace "<question>" -c <collection> 2>/dev/null)
./wtfoc trace "<question>" -c <collection> 2>/dev/null
```

Show the human-readable trace output to the user first so they can see the raw results.

### 3. Synthesize the analysis

Analyze the JSON trace results and produce a structured report with these sections:

**Summary** — A 2-3 sentence answer to the question based on the trace results.

**Evidence Chain** — Walk through the results in logical order (not by source type), reconstructing the narrative. For each key piece of evidence, cite:
- What it says (brief quote or paraphrase)
- Where it came from (source type, file/URL)
- Relevance score

**Cross-Source Connections** — Highlight where different source types corroborate or complement each other (e.g., "the docs describe the three-phase upload pipeline, and the SDK types.ts defines the exact interfaces for each phase").

**Open Issues & Friction** — List any GitHub issues, PR comments, or discussions found in the trace that indicate unresolved problems, DX friction, or known bugs related to the question.

**Gaps** — Note what the trace did NOT find that you might expect (e.g., "no test coverage found for this flow" or "no results from the SP backend code").

### 4. Suggest follow-up traces

Based on the analysis, suggest 2-3 follow-up trace queries that would deepen understanding. Format as runnable commands:

```bash
./wtfoc trace "suggested follow-up" -c <collection>
```
