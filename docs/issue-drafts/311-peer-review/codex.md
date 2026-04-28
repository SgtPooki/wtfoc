2026-04-28T20:57:57.058436Z ERROR codex_core::skills::loader: failed to stat skills entry /Users/sgtpooki/.codex/skills/peer-review (symlink): No such file or directory (os error 2)
OpenAI Codex v0.110.0 (research preview)
--------
workdir: /Users/sgtpooki/code/sgtpooki/homelab-system/wtfoc
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR, /Users/sgtpooki/.codex/memories]
reasoning effort: medium
reasoning summaries: none
session id: 019dd5e2-6634-79a2-acd7-5e030acf37c8
--------
user
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

mcp: betterstack starting
mcp: betterstack ready
mcp startup: ready: betterstack
codex
**Findings**

1. **Biggest risk: the loop optimizes an under-instrumented end metric and will select for brittle retrieval behavior, not durable product quality.**
   - `portable_pass_rate × overall_applicable_pass_rate` is too collapsed for phase 1.
   - It hides whether gains came from retrieval recall, answer synthesis, source-type coverage, or applicability churn.
   - A sweeper can win by improving a few already-near-threshold portable cases while quietly degrading evidence quality, latency, or corpus-specific usefulness.
   - Recommendation: do not use a single scalar as the optimizer until you log at least:
     - per-corpus portable pass
     - per-corpus overall applicable pass
     - applicability rate
     - retrieval recall proxy
     - latency/cost
     - evidence diversity / source-type spread

2. **Geo-mean is directionally right for anti-overfitting, but the proposed components are wrong.**
   - Portable is the right anchor.
   - `overall_applicable_pass_rate` is too broad and too sensitive to corpus composition.
   - It also rewards variants that shrink applicability if you are not careful about denominator handling.
   - Better headline scalar:
     - `sqrt(portable_pass_rate_v12 * portable_pass_rate_v3)` for generalization
     - Then gate on `overall_applicable_pass_rate`, applicability, and demo-critical instead of folding them in.
   - If you insist on one scalar, use:
     - `sqrt(portable_v12 * portable_v3) * demo_critical_gate * applicability_gate`
     - where gates are `0/1` or sharp penalties below floors.

3. **The cost-adjusted score is not sane as written.**
   - `pass_rate / (cost_usd + wall_time_s × ε)` is unstable and easy to tune arbitrarily via `ε`.
   - It also over-rewards tiny quality deltas when denominator shifts slightly.
   - Better:
     - primary objective: quality
     - secondary Pareto ranking: cost and wall time
   - If you need one scalar for ranking neighbors:
     - `quality_score - λ_cost * normalized_cost - λ_time * normalized_time`
   - Even better: only compare cost among variants within a small quality band, e.g. within 1 CI overlap or within 2-3 points.

4. **Two-corpus guard is necessary but not sufficient.**
   - It only catches one overfit shape: “v12 up, v3 portable down.”
   - It misses:
     - both corpora improving on easy queries while hard synthesis/file-lineage cases regress
     - answer quality degrading while binary pass remains unchanged
     - retrieval narrowing to repeated source types or duplicated evidence
     - improvements driven by metadata leakage or cached artifacts
   - Stronger missing anti-gaming signal:
     - evidence quality metrics: distinct source count, source-type diversity, edge-use diversity, and citation relevance
   - Also stratify wins by tier; do not accept a variant that gains overall while losing demo-critical or work-lineage.

5. **45 queries is too small for autonomous sweeping claims.**
   - One flip is ~2.2%; many plausible “wins” will be noise.
   - Bootstrap CI is fine, but only if you bootstrap at the query level and report paired deltas versus baseline, not independent CIs.
   - Recommendation:
     - use paired bootstrap on per-query pass deltas
     - require minimum effect size, e.g. `>4-5%` absolute on the optimized metric
     - require consistency across both corpora and no regression on protected tiers
   - Before broad sweeps, expand the fixture, especially portable and synthesis-heavy cases. Right now the harness is useful for screening, not strong enough for unattended hill-climbing.

6. **Independent axis sweeping will mislead because the axes are coupled.**
   - Strong couplings:
     - embedder × chunker
     - chunker × retrieval top-K
     - extractor schema/prompt × edge-aware traversal
     - concept layer × diversity/reranking
   - Retrieval-first is still the correct phase 1 because it is cheap and reversible.
   - But phase 1 should be limited to:
     - top-K
     - diversity on/off and parameters
     - reranker on/off
     - edge traversal weights
   - Do not infer anything global from chunker-only or embedder-only wins without a follow-up joint sweep.

7. **Pruning rule needs to be conservative and paired, not threshold folklore.**
   - “regress > threshold” is underspecified.
   - Use staged pruning:
     - Stage 1: quick screen on a stable subset with caches disabled or isolated
     - Stage 2: full 45-query paired eval
   - Prune when:
     - lower bound of paired delta CI is below `-x` on any protected metric, or
     - applicability drops, or
     - demo-critical/work-lineage regress at all
   - Search policy:
     - phase 1 grid search for cheap retrieval knobs
     - then beam search over top `N` configs
     - avoid neighbor proposal unless the parameter space is truly smooth; many of these knobs are not.

8. **You are missing intermediate metrics, which are what make autoresearch useful rather than opaque.**
   - Add:
     - retrieval recall proxy: did gold-supporting chunk/source appear in top-K?
     - answer grounding quality: citation/source correctness
     - evidence diversity: count of distinct docs/source types used in passing answers
     - hallucination / unsupported synthesis rate
     - latency by stage: ingest, retrieve, rerank, synthesize
     - cache hit rates
   - Without these, you will know a variant changed outcomes but not why.

9. **The “autoresearch” framing is only partially right.**
   - Karpathy-style autoresearch fits the “closed-loop optimizer over a harness” idea.
   - But for this repo, the stronger patterns to steal are:
     - SWE-bench/evals: fixed harness, exact config capture, strict reproducibility
     - OpenAI evals / Inspect-style: dataset versioning, per-sample traces, regression dashboards
   - Use autoresearch for orchestration, not for methodology. Your methodology should look like a disciplined eval harness first.

10. **Quiet failure modes are plentiful here.**
   - Variant cache contamination across runs
   - Reusing stale ingest artifacts when config changed
   - Silent provider/model drift behind the same model name
   - Corpus drift causing fixture decay while leaderboard looks “better”
   - Hard floors preventing exploration of configs that temporarily regress one metric but enable larger gains later
   - Applicability changes caused by ingest breakage masquerading as quality shifts
   - Cost data missing or incomparable across providers/stages

**Direct answers**

1. **Metric design**
   - Geo-mean: acceptable idea, wrong operands.
   - Better single scalar:
     - `sqrt(portable_v12 * portable_v3)` as the headline.
   - Keep these as hard gates, not blended inputs:
     - demo-critical
     - applicability
     - work-lineage
     - file-level
   - Cost-adjustment:
     - do not divide by a hand-tuned denominator.
     - use quality-first, Pareto-second, or linear penalties on normalized cost/time.

2. **Overfitting / gaming**
   - Two-corpus guard: insufficient.
   - Exploitable by improving easy portable cases and degrading evidence quality or hard tiers.
   - Strongest missing signal:
     - grounding/evidence quality, especially source diversity and support correctness.

3. **Statistical validity**
   - Bootstrap CI: yes, but paired bootstrap on deltas.
   - Require:
     - minimum effect size
     - protected-tier non-regression
     - repeated runs for unstable model-based stages if temperature > 0
   - Expand fixture before claiming autonomous improvement.

4. **Knob ordering**
   - Retrieval-first is right.
   - Cheapest useful sub-axis is probably reranker on/off plus top-K/diversity settings.
   - Independent sweeps beyond retrieval will mislead because of coupling.

5. **Pruning policy**
   - Use a two-stage beam search:
     - cheap screen
     - full paired eval
   - Prune on CI-backed regression of protected metrics, not raw thresholds.
   - Keep top `N` by headline score subject to gates.

6. **Missing axes**
   - Latency by stage
   - Retrieval recall proxy
   - Evidence diversity / source-type spread
   - Citation correctness / grounding
   - Hallucination rate on synthesis queries
   - Variance/stability across reruns

7. **Autoresearch parallels**
   - Use autoresearch as the loop shell.
   - Use eval-harness discipline from SWE-bench / OpenAI evals / Inspect for the measurement core.

8. **Failure modes**
   - Cache poisoning
   - Config under-serialization
   - Provider/model drift
   - Fixture decay
   - Thresholds discouraging exploration
   - Hidden ingest breakage lowering applicability

**Concrete recommendations**
- Make `sqrt(portable_v12 * portable_v3)` the only optimized scalar.
- Treat demo-critical, applicability, work-lineage, and file-level as hard gates.
- Add paired-bootstrap delta CIs and a minimum effect-size rule before accepting wins.
- Instrument retrieval recall proxy, evidence diversity, grounding quality, latency, and exact config serialization before building the loop.
- Restrict phase 1 to retrieval knobs with isolated caches and reproducible artifacts.
- Do not call it “continuous improvement” until the fixture is larger and the intermediate metrics exist.
tokens used
20,957
**Findings**

1. **Biggest risk: the loop optimizes an under-instrumented end metric and will select for brittle retrieval behavior, not durable product quality.**
   - `portable_pass_rate × overall_applicable_pass_rate` is too collapsed for phase 1.
   - It hides whether gains came from retrieval recall, answer synthesis, source-type coverage, or applicability churn.
   - A sweeper can win by improving a few already-near-threshold portable cases while quietly degrading evidence quality, latency, or corpus-specific usefulness.
   - Recommendation: do not use a single scalar as the optimizer until you log at least:
     - per-corpus portable pass
     - per-corpus overall applicable pass
     - applicability rate
     - retrieval recall proxy
     - latency/cost
     - evidence diversity / source-type spread

2. **Geo-mean is directionally right for anti-overfitting, but the proposed components are wrong.**
   - Portable is the right anchor.
   - `overall_applicable_pass_rate` is too broad and too sensitive to corpus composition.
   - It also rewards variants that shrink applicability if you are not careful about denominator handling.
   - Better headline scalar:
     - `sqrt(portable_pass_rate_v12 * portable_pass_rate_v3)` for generalization
     - Then gate on `overall_applicable_pass_rate`, applicability, and demo-critical instead of folding them in.
   - If you insist on one scalar, use:
     - `sqrt(portable_v12 * portable_v3) * demo_critical_gate * applicability_gate`
     - where gates are `0/1` or sharp penalties below floors.

3. **The cost-adjusted score is not sane as written.**
   - `pass_rate / (cost_usd + wall_time_s × ε)` is unstable and easy to tune arbitrarily via `ε`.
   - It also over-rewards tiny quality deltas when denominator shifts slightly.
   - Better:
     - primary objective: quality
     - secondary Pareto ranking: cost and wall time
   - If you need one scalar for ranking neighbors:
     - `quality_score - λ_cost * normalized_cost - λ_time * normalized_time`
   - Even better: only compare cost among variants within a small quality band, e.g. within 1 CI overlap or within 2-3 points.

4. **Two-corpus guard is necessary but not sufficient.**
   - It only catches one overfit shape: “v12 up, v3 portable down.”
   - It misses:
     - both corpora improving on easy queries while hard synthesis/file-lineage cases regress
     - answer quality degrading while binary pass remains unchanged
     - retrieval narrowing to repeated source types or duplicated evidence
     - improvements driven by metadata leakage or cached artifacts
   - Stronger missing anti-gaming signal:
     - evidence quality metrics: distinct source count, source-type diversity, edge-use diversity, and citation relevance
   - Also stratify wins by tier; do not accept a variant that gains overall while losing demo-critical or work-lineage.

5. **45 queries is too small for autonomous sweeping claims.**
   - One flip is ~2.2%; many plausible “wins” will be noise.
   - Bootstrap CI is fine, but only if you bootstrap at the query level and report paired deltas versus baseline, not independent CIs.
   - Recommendation:
     - use paired bootstrap on per-query pass deltas
     - require minimum effect size, e.g. `>4-5%` absolute on the optimized metric
     - require consistency across both corpora and no regression on protected tiers
   - Before broad sweeps, expand the fixture, especially portable and synthesis-heavy cases. Right now the harness is useful for screening, not strong enough for unattended hill-climbing.

6. **Independent axis sweeping will mislead because the axes are coupled.**
   - Strong couplings:
     - embedder × chunker
     - chunker × retrieval top-K
     - extractor schema/prompt × edge-aware traversal
     - concept layer × diversity/reranking
   - Retrieval-first is still the correct phase 1 because it is cheap and reversible.
   - But phase 1 should be limited to:
     - top-K
     - diversity on/off and parameters
     - reranker on/off
     - edge traversal weights
   - Do not infer anything global from chunker-only or embedder-only wins without a follow-up joint sweep.

7. **Pruning rule needs to be conservative and paired, not threshold folklore.**
   - “regress > threshold” is underspecified.
   - Use staged pruning:
     - Stage 1: quick screen on a stable subset with caches disabled or isolated
     - Stage 2: full 45-query paired eval
   - Prune when:
     - lower bound of paired delta CI is below `-x` on any protected metric, or
     - applicability drops, or
     - demo-critical/work-lineage regress at all
   - Search policy:
     - phase 1 grid search for cheap retrieval knobs
     - then beam search over top `N` configs
     - avoid neighbor proposal unless the parameter space is truly smooth; many of these knobs are not.

8. **You are missing intermediate metrics, which are what make autoresearch useful rather than opaque.**
   - Add:
     - retrieval recall proxy: did gold-supporting chunk/source appear in top-K?
     - answer grounding quality: citation/source correctness
     - evidence diversity: count of distinct docs/source types used in passing answers
     - hallucination / unsupported synthesis rate
     - latency by stage: ingest, retrieve, rerank, synthesize
     - cache hit rates
   - Without these, you will know a variant changed outcomes but not why.

9. **The “autoresearch” framing is only partially right.**
   - Karpathy-style autoresearch fits the “closed-loop optimizer over a harness” idea.
   - But for this repo, the stronger patterns to steal are:
     - SWE-bench/evals: fixed harness, exact config capture, strict reproducibility
     - OpenAI evals / Inspect-style: dataset versioning, per-sample traces, regression dashboards
   - Use autoresearch for orchestration, not for methodology. Your methodology should look like a disciplined eval harness first.

10. **Quiet failure modes are plentiful here.**
   - Variant cache contamination across runs
   - Reusing stale ingest artifacts when config changed
   - Silent provider/model drift behind the same model name
   - Corpus drift causing fixture decay while leaderboard looks “better”
   - Hard floors preventing exploration of configs that temporarily regress one metric but enable larger gains later
   - Applicability changes caused by ingest breakage masquerading as quality shifts
   - Cost data missing or incomparable across providers/stages

**Direct answers**

1. **Metric design**
   - Geo-mean: acceptable idea, wrong operands.
   - Better single scalar:
     - `sqrt(portable_v12 * portable_v3)` as the headline.
   - Keep these as hard gates, not blended inputs:
     - demo-critical
     - applicability
     - work-lineage
     - file-level
   - Cost-adjustment:
     - do not divide by a hand-tuned denominator.
     - use quality-first, Pareto-second, or linear penalties on normalized cost/time.

2. **Overfitting / gaming**
   - Two-corpus guard: insufficient.
   - Exploitable by improving easy portable cases and degrading evidence quality or hard tiers.
   - Strongest missing signal:
     - grounding/evidence quality, especially source diversity and support correctness.

3. **Statistical validity**
   - Bootstrap CI: yes, but paired bootstrap on deltas.
   - Require:
     - minimum effect size
     - protected-tier non-regression
     - repeated runs for unstable model-based stages if temperature > 0
   - Expand fixture before claiming autonomous improvement.

4. **Knob ordering**
   - Retrieval-first is right.
   - Cheapest useful sub-axis is probably reranker on/off plus top-K/diversity settings.
   - Independent sweeps beyond retrieval will mislead because of coupling.

5. **Pruning policy**
   - Use a two-stage beam search:
     - cheap screen
     - full paired eval
   - Prune on CI-backed regression of protected metrics, not raw thresholds.
   - Keep top `N` by headline score subject to gates.

6. **Missing axes**
   - Latency by stage
   - Retrieval recall proxy
   - Evidence diversity / source-type spread
   - Citation correctness / grounding
   - Hallucination rate on synthesis queries
   - Variance/stability across reruns

7. **Autoresearch parallels**
   - Use autoresearch as the loop shell.
   - Use eval-harness discipline from SWE-bench / OpenAI evals / Inspect for the measurement core.

8. **Failure modes**
   - Cache poisoning
   - Config under-serialization
   - Provider/model drift
   - Fixture decay
   - Thresholds discouraging exploration
   - Hidden ingest breakage lowering applicability

**Concrete recommendations**
- Make `sqrt(portable_v12 * portable_v3)` the only optimized scalar.
- Treat demo-critical, applicability, work-lineage, and file-level as hard gates.
- Add paired-bootstrap delta CIs and a minimum effect-size rule before accepting wins.
- Instrument retrieval recall proxy, evidence diversity, grounding quality, latency, and exact config serialization before building the loop.
- Restrict phase 1 to retrieval knobs with isolated caches and reproducible artifacts.
- Do not call it “continuous improvement” until the fixture is larger and the intermediate metrics exist.
