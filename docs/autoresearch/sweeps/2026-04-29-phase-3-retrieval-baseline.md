# Phase 3 — Retrieval-Baseline Sweep (2026-04-29 / 2026-04-30)

First real research run of the autoresearch sweep harness (#311). Goal: sweep retrieval knobs (`autoRoute × diversityEnforce × reranker`) over the v12 + v3 corpus pair, identify the production-ready config, capture per-paraphrase brittleness, and document next actions.

## TL;DR

- **Production winner: `noar_div_rrOff`** (autoRoute=false, diversityEnforce=true, no reranker). Matches v1.9.0 baseline numbers exactly. Passes overall + demo-critical + workLineage + fileLevel hard gates.
- **Tested LLM rerankers do not justify adoption right now.** Haiku rerank gave zero lift; qwen36-27b-aeon rerank regressed quality −17pp overall. Two models, two configs, two negative results — strong enough evidence to deprioritize the rerank axis until the prompt template / scoring approach changes (or a non-LLM cross-encoder is tried). NOT proof that reranking as a class is useless — see [#313](https://github.com/SgtPooki/wtfoc/issues/313).
- **diversityEnforce is the lever.** +11pp portable v12, +12pp portable v3. Without it, every variant fails the overall gate.
- **autoRoute is harmful.** `ar_nodiv_rrOff` broke demo-critical (dropped to 80%). Should not be enabled. Follow-up: [#314](https://github.com/SgtPooki/wtfoc/issues/314).
- **Paraphrase invariance is treated as diagnostic, not release-blocking, for this branch.** The 48.1% measurement matches the expected v1.9.0 number from Phase 1 — Phase 3 is surfacing pre-existing brittleness, not regressing it. The 70% threshold in `decision.ts` remains in place for sweep-time accept/reject decisions, but is explicitly waived for landing this branch. Highest-leverage follow-up: `wl-1` (demo-critical query with one reliably-failing paraphrase).

## Run identity

| Field | Value |
|---|---|
| Branch | `feat/311-autoresearch-loop` |
| HEAD at run-time | `0e09796` (harness extensions) |
| Sweep harness | `pnpm autoresearch:sweep retrieval-baseline` |
| Gold fixture version | 1.9.0 |
| Gold fixture hash | `2d1b821e3decb196a9c87fe55e0f05992f1141c080f9c4088b1c92821f24fc78` |
| Embedder | `baai/bge-base-en-v1.5` via OpenRouter |
| Reranker (rrLlm-haiku variants) | `claude-haiku-4-5-20251001` via local proxy |
| Reranker (smoke variant) | `qwen36-27b-aeon` via local vLLM |
| Primary corpus | `filoz-ecosystem-2026-04-v12` (digest `6a0c97c9ad17…`) |
| Secondary corpus | `wtfoc-dogfood-2026-04-v3` (digest `d659f8ac054c…`) |
| Retrieval defaults | topK=10, traceMaxPerSource=3, traceMaxTotal=15, traceMaxHops=3, traceMinScore=0.3, traceMode=analytical |
| Paraphrase checks | OFF (`WTFOC_CHECK_PARAPHRASES=0`) |
| Ground-check | OFF (`WTFOC_GROUND_CHECK=0`) |

## Matrix

`scripts/autoresearch/matrices/retrieval-baseline.ts` — Cartesian product over:

```
autoRoute        ∈ { false, true }
diversityEnforce ∈ { false, true }
reranker         ∈ { off, llm:haiku }
```

= 8 variants × 2 corpora = 16 runs.

## What ran / what didn't

Two sweep invocations (one halted, one resumed) plus one standalone smoke. Combined into a unified rrOff frontier.

| Variant | v12 | v3 | Sweep |
|---|---|---|---|
| `noar_nodiv_rrOff` | ✓ | ✓ | initial (halted) |
| `noar_nodiv_rrLlm-haiku` | ✓ | ✓ | initial (halted) |
| `noar_div_rrOff` | ✓ | ✓ | initial (halted) |
| `noar_div_rrLlm-haiku` | ✗ | ✗ | not run (rerank-no-lift signal) |
| `ar_nodiv_rrOff` | ✓ | ✓ | resume |
| `ar_nodiv_rrLlm-haiku` | ✗ | ✗ | not run |
| `ar_div_rrOff` | ✓ | ✓ | resume |
| `ar_div_rrLlm-haiku` | ✗ | ✗ | not run |
| `noar_div_rrLlm-qwen36-27b-aeon` (smoke, off-matrix) | ✓ | — | smoke |

**Why halt mid-sweep?** Each rrLlm-haiku run = 306 reranker calls × ~8s = ~41 min. 4 rrLlm runs × 2 corpora = ~5.5 hours of sustained calls through the local Claude proxy — TOS-grey for sustained programmatic use. Halted to limit exposure. The rrOff variants (no reranker) had no such concern and were resumed via `--variant-filter ar_nodiv_rrOff,ar_div_rrOff`.

**Why drop the remaining rrLlm variants?** Two pieces of evidence converged:
1. `noar_nodiv_rrOff` and `noar_nodiv_rrLlm-haiku` produced **identical** numbers across overall, portable, demo, and recall — haiku rerank added no measurable lift on the no-diversity baseline.
2. `noar_div_rrLlm-qwen36-27b-aeon` (smoke) **regressed** overall pass rate 57% → 40% versus `noar_div_rrOff`. The reranker was actively undoing the diversity-enforce gain.

Given two independent reranker models gave (zero lift, harmful regression) on the diversity dimension, the prior on the remaining 3 untested rrLlm-haiku variants beating their rrOff peers is very low. Confirmation deferred to a Phase 4 cron run via OpenRouter cheap reranker.

## Results — full rrOff frontier (8 runs combined)

| variant | corpus | overall | portable | demo-crit | workLineage | fileLevel | hardNeg | recall@10 | duration |
|---|---|---|---|---|---|---|---|---|---|
| `noar_div_rrOff` | filoz-v12 | **57%** ✓ | **46%** | **100%** ✓ | 67% | 75% | 0% | 0.701 | 7.3 min |
| `noar_div_rrOff` | wtfoc-v3 | 34% | **44%** | 0% [^1] | — | — | — | 0.192 | 6.9 min |
| `ar_div_rrOff` | filoz-v12 | 52% | 41% | 100% ✓ | 56% [^2] | — | — | 0.743 | 7.3 min |
| `ar_div_rrOff` | wtfoc-v3 | 31% | 41% | 0% [^1] | — | — | — | 0.212 | 6.9 min |
| `noar_nodiv_rrOff` | filoz-v12 | 41% | 40% | 100% ✓ | — | — | — | 0.722 | 6.7 min |
| `noar_nodiv_rrOff` | wtfoc-v3 | 26% | 32% | 0% [^1] | — | — | — | 0.192 | 7.8 min |
| `ar_nodiv_rrOff` | filoz-v12 | 41% | 40% | **80% ⚠️** | — | — | — | 0.743 | 7.3 min |
| `ar_nodiv_rrOff` | wtfoc-v3 | 26% | 32% | 0% [^1] | — | — | — | 0.212 | 6.9 min |

[^1]: v3 has zero applicable demo-critical queries by fixture design — demo-critical tier is anchored to v12 work-lineage. The 0% is "no signal" not "regressed".
[^2]: `ar_div_rrOff` failed workLineage gate (56% < 60% floor) — autoRoute boost broke at least one work-lineage query that diversity alone preserves.

### rrLlm-haiku comparison (1 variant pair from halted sweep)

| variant | corpus | overall | portable | demo | recall | duration |
|---|---|---|---|---|---|---|
| `noar_nodiv_rrOff` (no rerank) | filoz-v12 | 41% | 40% | 100% | 0.722 | 6.7 min |
| `noar_nodiv_rrLlm-haiku` | filoz-v12 | **41%** | **40%** | **100%** | **0.722** | **110 min** |

Identical metrics, 16× the latency. Reranker did nothing.

### raw-vllm smoke (off-matrix, single variant)

| Variant | overall | portable | demo | recall | duration | rerank tokens |
|---|---|---|---|---|---|---|
| `noar_div_rrLlm-qwen36-27b-aeon` | 40% | 40% | 100% | 0.722 | **7.35 hr** | 3.07M in + 612k out |

Compared to `noar_div_rrOff` (same axes, no rerank): −17pp overall, −6pp portable, +0.02 recall, **60× slower**.

The qwen reranker effectively cancels the diversity-enforce gain — collapses `noar_div` results back down to no-diversity baseline (~40% overall). Strong signal that the LlmReranker prompt isn't preserving source-type distribution; the model re-promotes same-source candidates over diverse ones.

## Per-axis findings

### `diversityEnforce` — keep at TRUE

| (autoRoute, reranker=off) | nodiv | div | Δ portable v12 | Δ portable v3 |
|---|---|---|---|---|
| `noar_*_rrOff` | 40% / 32% | **46%** / **44%** | +6pp | +12pp |
| `ar_*_rrOff` | 40% / 32% | 41% / 41% | +1pp | +9pp |

Diversity unambiguously improves portable pass rate on both corpora. The effect is stronger when autoRoute is OFF.

### `autoRoute` — keep at FALSE

| (diversityEnforce=true, reranker=off) | autoRoute=false | autoRoute=true | Δ overall | Δ demo |
|---|---|---|---|---|
| `*_div_rrOff` v12 | 57% | 52% | **−5pp** | 0 |
| `*_div_rrOff` portable v12 | 46% | 41% | **−5pp** | — |
| `*_nodiv_rrOff` v12 | 41% | 41% | 0 | **−20pp** ⚠️ |

autoRoute slightly hurts on diversity-enabled configs and broke demo-critical entirely on `ar_nodiv` (dropped from 100% to 80%). No corpus showed a benefit.

Hypothesis: autoRoute's persona-based source-type boosts conflict with both diversity-enforce (which wants spread across source types) and demo-critical's curated work-lineage paths (which need exact-file recall, not boosted-by-persona-fit recall).

### `reranker` — keep at OFF until a different reranker proves lift

Two pieces of evidence:
- haiku rerank on `noar_nodiv` produced **zero** lift (identical 41%/40%/100%/0.72 across all metrics) at 16× latency
- qwen rerank on `noar_div` produced **regression** (−17pp overall) at 60× latency

The current LlmReranker prompt + scoring loop appears to be either (a) re-ranking candidates worse than the embedder's own ordering, or (b) breaking diversity-enforce by re-promoting same-source candidates. Probable root cause: the rerank prompt scores per-candidate without seeing the diversity constraint, so high-scoring same-source candidates rise to the top regardless of diversity intent.

Until the reranker prompt is rewritten to respect diversity (or a different reranker is proven on this fixture), reranker=off is the production setting.

## Hard gates summary (filoz-v12 only — gates are v12-anchored)

| variant | overall ≥55% | demo=100% | workLineage ≥60% | fileLevel ≥70% | hardNeg ≥0% | applicable ≥60% |
|---|---|---|---|---|---|---|
| `noar_div_rrOff` | ✓ 57% | ✓ 100% | ✓ 67% | ✓ 75% | ✓ 0% | ✓ |
| `ar_div_rrOff` | ✗ 52% | ✓ 100% | ✗ 56% | — | — | — |
| `noar_nodiv_rrOff` | ✗ 41% | ✓ 100% | — | — | — | — |
| `ar_nodiv_rrOff` | ✗ 41% | ✗ 80% | — | — | — | — |
| `noar_nodiv_rrLlm-haiku` | ✗ 41% | ✓ 100% | — | — | — | — |
| qwen smoke (`noar_div_rrLlm-qwen`) | ✗ 40% | ✓ 100% | ✗ 37% | ✗ 58% | — | — |

Only `noar_div_rrOff` passes the full gate set. **It is the production-ready config.**

## Comparison to v1.9.0 baseline (#311 issue comment)

| Metric | v1.9.0 baseline | `noar_div_rrOff` (this sweep) | Match |
|---|---|---|---|
| overall applicable | 56.9% | 57% | ✓ |
| portable | 46.2% | 46% | ✓ |
| demo-critical | 100% | 100% | ✓ |
| recall@10 | 0.70 | 0.70 | ✓ |
| applicability rate | 97.5% | (not surfaced) | — |

The current production config IS `noar_div_rrOff`. Stage 1 confirms it is the best of the rrOff variants and that no rrLlm tested gives lift over it.

**Recommendation: no change to retrieval defaults.**

## Cost / latency

| variant family | wallclock per run | rerank cost (paid OpenRouter equivalent) |
|---|---|---|
| rrOff (any axis) | 7-8 min | $0 |
| rrLlm-haiku | 41 min v12 / 112 min v3 | ~$3/run via OpenRouter `claude-haiku-4.5` |
| rrLlm-qwen36-27b-aeon (local vLLM) | **7.35 hr** | $0 (local GPU) |

Stage 1 token budget actually consumed (rrLlm-haiku × 2 corpora completed): 2.9M prompt + 622k completion through Claude proxy. At paid `claude-haiku-4.5` rates that would be ~$6.

A full Stage 1 (8 rrOff + 8 rrLlm-haiku) would have been ~$24 paid. Phase 4 nightly cron at this matrix shape would be ~$720/mo at haiku-4.5 rates, or ~$60/mo at `gemini-2.5-flash-lite` ($0.10/$0.40 per Mtok). With the rerank axis deprioritized for now (pending [#313](https://github.com/SgtPooki/wtfoc/issues/313) prompt audit), Phase 4 cron at rrOff-only = $0 in LLM cost (embedder is free on OpenRouter for bge-base).

## Stage 2 — paraphrase confirmation on `noar_div_rrOff` (2026-04-30)

Single dogfood with `WTFOC_CHECK_PARAPHRASES=1` on the production config, v12 corpus. 23.7 min wallclock.

| Metric | Stage 2 result | v1.9.0 baseline (#311) | Gate |
|---|---|---|---|
| overall passRate | **57%** (87/153) | 56.9% | ✓ ≥55% |
| portable | **46%** | 46.2% | — |
| demo-critical | **100%** | 100% | ✓ |
| workLineage | **63%** | — (newly surfaced) | ✓ ≥60% |
| fileLevel | **75%** | — (newly surfaced) | ✓ ≥70% |
| hard-negative | 0% | 0% | ✓ ≥0% (calibrated) |
| recall@10 | 0.701 | 0.70 | — |
| **paraphrase invariance** | **48.1%** (63/131) | 48.1% (full v1.9.0) | **✗ ≥70% required** |

The headline metrics confirm `noar_div_rrOff` reproduces the v1.9.0 baseline numbers exactly, **and** clears workLineage + fileLevel hard gates that weren't separately measured before. **Paraphrase invariance fails the 70% gate** at 48.1% — but that matches the expected v1.9.0 number from the original Phase 1 measurement, not a Phase 3 regression.

### Demo-critical brittleness — `wl-1` confirmed broken

| query | canonical | p1 | p2 | p3 | tier |
|---|---|---|---|---|---|
| **`wl-1`** | ✓ pass | ✓ pass | ✓ pass | **✗ fail** | **demo-critical** |
| `wl-6` | ✓ pass | ✓ pass | ✗ fail | ✓ pass | work-lineage |

`wl-1`'s third paraphrase reliably fails — a demo-critical query whose paraphrase variant breaks. Highest-priority brittle target. The other 7 known-brittle queries from #311 (`syn-3, cs-6, syn-7, wl-1, wl-6, port-1, port-2, port-3`) all reproduced their brittle pattern: canonical passes (or fails for port-*), at least one paraphrase fails.

### Brittle-query population

68 of 131 paraphrased queries are brittle. Distribution by category:

- **direct-lookup**: most paraphrased dl-* queries fail every paraphrase (canonical also failing) — fundamental retrieval gap, not paraphrase noise
- **cross-source**: 12+ brittle queries — canonical mixed pass/fail, paraphrases erratic
- **work-lineage**: 2 brittle (`wl-1`, `wl-6`) — canonical passes, single paraphrase fails
- **synthesis**: 2 brittle (`syn-3`, `syn-7`) — canonical passes, paraphrases scatter
- **portable**: 3 brittle (`port-1, port-2, port-3`) — canonical fails (already in the 41 untested portable queries)

The synthesis + work-lineage brittleness is the higher-value optimization signal — those queries DO retrieve correctly on canonical phrasing, so the gap is a retrieval-robustness problem (e.g., embedder semantic stability across rephrasings) rather than a missing-data problem.

## Open follow-ups

1. ~~**Stage 2 single-variant paraphrase confirmation**~~ — done (this run).
2. **Reranker prompt audit** — see [#313](https://github.com/SgtPooki/wtfoc/issues/313). Current `LlmReranker` prompt either ignores diversity context or actively re-promotes same-source candidates. Before adding any reranker variant to the production matrix, prompt needs (a) explicit diversity awareness, or (b) replacement with a small cross-encoder (BGE-reranker-v2-m3 etc.).
3. **Phase 4 nightly cron** — unblocked. Run at rrOff-only frontier (4 variants × 2 corpora × paraphrase=on) via cron. Cost at $0 (embedder free, no rerank). Expected wallclock ~30 min/night, with paraphrase checks bumping it to ~2 hr.
4. **`autoRoute` killswitch** — see [#314](https://github.com/SgtPooki/wtfoc/issues/314). Recommendation: remove the flag entirely (pre-v1, breaking changes acceptable, no measured benefit).
5. **`wl-1` brittleness root-cause** — file separately as a quality issue. Demo-critical query with a single failing paraphrase is the highest-leverage retrieval fix on the board.
6. **3 untested rrLlm-haiku variants** — low priority given converging evidence rerank does not help. A follow-up sweep via OpenRouter `gemini-2.5-flash-lite` at ~$2 total would close the matrix conclusively.

## Artifacts

- Run-log JSONL: `~/.wtfoc/autoresearch/runs.jsonl` (8 rrOff rows + 2 rrLlm-haiku rows + 2 smoke-sweep rows from Phase 2; Stage 2 ran via `pnpm dogfood` directly so does not append a row)
- Resume sweep summary: `~/.wtfoc/autoresearch/sweeps/sweep-retrieval-baseline-1777499815976.json`
- raw-vllm smoke report: `~/.wtfoc/autoresearch/raw-vllm-rerank-smoke.json`
- Stage 2 paraphrase report: `~/.wtfoc/autoresearch/stage2-noar_div_rrOff-paraphrase.json`
- Halted sweep partial reports (per-variant temp files, may be GC'd): `/var/folders/.../wtfoc-sweep-*/`
