You are being invoked as a reviewer. Provide YOUR OWN review directly. Do NOT invoke other tools, agents, or CLIs (cursor, codex, claude) — you are the reviewer, not a dispatcher.

# Review target: wtfoc autoresearch loop proposal

Repo: https://github.com/SgtPooki/wtfoc — pluggable RAG/knowledge-graph tool. Mission: decentralized, shareable, composable knowledge collections (nodes + edges) backed by Filecoin storage. Pre-v1.

## Context: existing measurement infra

- `pnpm dogfood:flagship` runs a fixture of 45 gold-standard queries against two corpora:
  - `filoz-ecosystem-2026-04-v12` (13,477 chunks, 6 source types — code/markdown/slack/issues/PRs/PR-comments)
  - `wtfoc-dogfood-2026-04-v3` (advisory)
- Tiers: portable (13), corpus-specific (32), demo-critical (5), work-lineage, file-level.
- Hard-gated thresholds in `scripts/dogfood-check-thresholds.ts`. Current floors: overall 80%, portable 70%, demo-critical 100%, work-lineage 87.5%, file-level 100%, applicability 60%.
- Reports written to `~/.wtfoc/dogfood-reports/<timestamp>.json`.
- Embedder pin: OpenRouter `baai/bge-base-en-v1.5`. Extractor pin: claude-direct-proxy haiku.
- Diversity enforcement (`--diversity-enforce`, #161) on by default in flagship.
- Skipped-vs-failed distinction already enforced (queries with mismatched `requiredSourceTypes` skip, don't fail).

## Proposal under review

Build an autoresearch-style continuous-improvement loop over this fixture, modeled loosely on karpathy/autoresearch.

**Headline metric:** geometric mean of portable_pass_rate × overall_applicable_pass_rate, computed across both corpora. One scalar, hard to game by overfitting v12.

**Knob axes (one experiment per axis):**
1. Embedder — bge-base vs nomic vs others (expensive, requires re-ingest).
2. Chunker params — token windows, overlap, AST chunk granularity (cf. #275 preamble context).
3. Edge extractor — model, prompt, temperature, schema strictness.
4. Retrieval — top-K, diversity flag, reranker on/off, edge-aware traversal weights (#283 orderEdgesBy).
5. Concept/similarity layer — once #262/#310 land: threshold, top-K, with-vs-without.

**Loop shape:**
```
for axis in axes:
  for variant in variants[axis]:
    run dogfood:flagship --variant
    log {axis, variant, metrics, cost_usd, wall_time_s, embedder/extractor pin} → ~/.wtfoc/autoresearch/runs.jsonl
    if regress > threshold: prune
    else: keep, propose neighbors
report leaderboard
```

**Cost-adjusted score:** `pass_rate / (cost_usd + wall_time_s × ε)` to prevent drift toward expensive configs.

**Two-corpus guard:** drop variants where v12 gain comes with wtfoc-v3 portable regression (overfit detector).

**Skipped-applicability tracking:** if applicability rate drops, variant broke ingest in a way that changed `requiredSourceTypes` matching — track separately, don't conflate with quality regression.

**Statistical floor:** 45 queries → one-query flip ≈ 2.2%. Either bootstrap CI per metric or treat <5% diffs as noise.

**Phasing:** start with axis 4 (retrieval, no re-ingest) before sweeping axes 1–3 (which require re-ingest = expensive and slow).

**Stretch:** nightly cron over a fixed variant matrix → leaderboard delta to private channel → file issue on threshold breach. Closes the loop autonomously (true autoresearch agent shape).

**Gaps to fill before honest:**
- Token usage / cost capture in dogfood reports (verify presence).
- Wall-time per stage in report.
- Full config serialization in every report so a leaderboard row is reproducible.
- Statistical significance protocol.

## What to review

Give a concrete, opinionated review. Specifically:

1. **Metric design** — Is geo-mean of portable × overall the right headline? What does it miss? Better single-scalar alternatives? Is cost-adjustment formulation sane?
2. **Overfitting / gaming risk** — Two-corpus guard sufficient? How would a sweeper exploit this metric in ways that don't actually improve real-world quality? What's the strongest non-gaming signal the design is missing?
3. **Statistical validity** — 45 queries is small. Is bootstrap CI right? Should we expand fixture before sweeping? How to detect when a "win" is noise?
4. **Knob ordering** — Is retrieval-first the right phase-1 choice for cost reasons, or is there a cheaper axis (e.g., reranker on/off)? Are any axes strongly coupled (e.g., chunker × embedder) where independent sweeping misleads?
5. **Loop pruning policy** — "regress > threshold → prune" is vague. What pruning rule actually works? Beam search? Bandit? Neighbor proposal heuristic?
6. **Missing axes** — What are we NOT measuring that we should? E.g., latency, recall@k separate from final pass, cross-source diversity of evidence in winning answers, hallucination rate on synthesis-tier queries.
7. **Autoresearch parallels** — Is the karpathy/autoresearch framing actually the right model for this, or is something like SWE-bench's harness, OpenAI's evals, or Inspect AI more appropriate? Anything to steal from those instead?
8. **Failure modes** — How will this loop quietly fail? (E.g., cache poisoning across variants, embedder pins drifting, fixture decay as corpus changes, threshold floors discouraging exploration.)

Be terse. Bullets and concrete recommendations preferred over prose. Flag the single biggest risk you see.
