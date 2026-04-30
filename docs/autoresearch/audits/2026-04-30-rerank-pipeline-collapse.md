# Rerank pipeline pool-collapse audit (2026-04-30)

Read-only investigation into why `LlmReranker` regressed quality −17pp on `noar_div` (qwen36-27b-aeon) in Phase 3 Stage 1. Cross-reviewer convergence (gemini+cursor+codex, 2026-04-30) flagged H1 (pre-trim before diversity-enforce) as the dominant root cause. This audit confirms H1 quantitatively from existing report data — no new sweep runs.

## TL;DR

The reranker is doing its primary job correctly (lifting recall@10 +0.02) and structurally breaking a different invariant the scoring rubric requires (source-type diversity, average **−1.7** distinct types per passing query, **−32%**). Net effect: 26 queries flip pass→fail, 0 queries flip fail→pass.

This is **not a model-quality verdict** on `qwen36-27b-aeon`. It is a pipeline-order bug: rerank trims `fetchK = topK*10` candidates down to `topK` BEFORE `diversityEnforce` gets a chance to operate on the wider pool.

## Reports compared

Same axes (autoRoute=false, diversityEnforce=true), same corpus (`filoz-ecosystem-2026-04-v12`), same fixture (v1.9.0, 157 queries), same paraphrase setting (off). Only difference: reranker.

| run | reranker | overall | portable | demo | recall@10 | passingAvg distinctSourceTypes |
|---|---|---|---|---|---|---|
| `noar_div_rrOff` (no rerank, killed sweep) | off | 57% | 46% | 100% | 0.701 | **5.36** |
| `noar_div_rrLlm-qwen36-27b-aeon` (smoke) | qwen | **40%** ↓ | **40%** ↓ | 100% | **0.722** ↑ | **3.66** ↓ |

Recall@10 went UP. Pass rate went DOWN. Source-type diversity collapsed.

## Per-query flip analysis (157 paired queries)

| outcome | count |
|---|---|
| both passed | 61 |
| both failed | 70 |
| **passed without rerank, FAILED with rerank** | **26** |
| failed without rerank, passed with rerank | **0** |
| skipped (either side) | 4 |

**The reranker recovered zero queries and damaged 26.** Pure damage on the `passed` rubric.

## The 26 flipped queries — distinct-source-type collapse

Every query that flipped pass→fail lost source-type diversity. Mean drop: **−2.2 distinct source types** (range −1 to −4).

| drop | n queries |
|---|---|
| −1 | 5 |
| −2 | 13 |
| −3 | 6 |
| −4 | 2 |

Full per-query data:

| id | category | src_no_rerank | src_qwen | src_drop | docs_no | docs_qwen | recall_no | recall_qwen |
|---|---|---|---|---|---|---|---|---|
| `cov-11` | coverage | 6 | 5 | **−1** | 11 | 9 | — | — |
| `cov-16` | coverage | 5 | 1 | **−4** | 9 | 7 | — | — |
| `cov-19` | coverage | 6 | 3 | **−3** | 11 | 9 | — | — |
| `cov-6` | coverage | 5 | 3 | **−2** | 12 | 8 | 0.50 | 0.00 |
| `cov-7` | coverage | 5 | 3 | **−2** | 12 | 11 | 0.33 | 0.33 |
| `cs-13` | cross-source | 6 | 4 | **−2** | 11 | 10 | — | — |
| `cs-16` | cross-source | 6 | 5 | **−1** | 18 | 18 | — | — |
| `cs-17` | cross-source | 6 | 5 | **−1** | 14 | 14 | — | — |
| `cs-18` | cross-source | 6 | 4 | **−2** | 14 | 12 | — | — |
| `cs-19` | cross-source | 6 | 3 | **−3** | 9 | 7 | — | — |
| `cs-6` | cross-source | 6 | 4 | **−2** | 16 | 16 | 1.00 | 1.00 |
| `fl-12` | file-level | 5 | 3 | **−2** | 13 | 12 | — | — |
| `fl-6` | file-level | 5 | 3 | **−2** | 14 | 15 | — | — |
| `syn-22` | synthesis | 6 | 5 | **−1** | 21 | 21 | — | — |
| `syn-24` | synthesis | 6 | 3 | **−3** | 13 | 13 | — | — |
| `syn-4` | synthesis | 6 | 4 | **−2** | 11 | 10 | — | — |
| `syn-6` | synthesis | 6 | 4 | **−2** | 23 | 20 | 0.50 | 0.50 |
| `syn-7` | synthesis | 6 | 3 | **−3** | 14 | 12 | **0.50** | **1.00 ↑** |
| `syn-9` | synthesis | 5 | 3 | **−2** | 8 | 8 | — | — |
| `wl-11` | work-lineage | 6 | 4 | **−2** | 10 | 9 | — | — |
| `wl-14` | work-lineage | 6 | 4 | **−2** | 13 | 10 | — | — |
| `wl-17` | work-lineage | 6 | 4 | **−2** | 17 | 16 | — | — |
| `wl-19` | work-lineage | 6 | 5 | **−1** | 10 | 10 | — | — |
| `wl-20` | work-lineage | 6 | 3 | **−3** | 11 | 9 | — | — |
| `wl-21` | work-lineage | 6 | 2 | **−4** | 11 | 8 | — | — |
| `wl-23` | work-lineage | 6 | 3 | **−3** | 10 | 7 | — | — |

### The cleanest single-query proof

**`syn-7`**:
- recall@10: 0.50 → **1.00** (reranker found the gold-supporting docs)
- distinctSourceTypes: 6 → **3** (reranker stripped half the source-type variety)
- canonical: passed → **failed**

The reranker found the right canonical-file paths AND simultaneously removed the cross-source supporting evidence the scoring rubric requires. `syn-7` is a synthesis-tier query (cross-cutting question that benefits from multi-source corroboration). The reranker promoted lexically-similar same-source candidates to the top-K, even though the gold canonical paths were lower-scoring.

## Categories most affected

| category | flipped pass→fail |
|---|---|
| work-lineage | 7 (wl-11, 14, 17, 19, 20, 21, 23) |
| synthesis | 6 (syn-4, 6, 7, 9, 22, 24) |
| cross-source | 6 (cs-6, 13, 16, 17, 18, 19) |
| coverage | 5 (cov-6, 7, 11, 16, 19) |
| file-level | 2 (fl-6, fl-12) |

The categories hit hardest are exactly the ones that *require* multi-source evidence by design. cs-* (cross-source) and syn-* (synthesis) are explicit multi-source queries; wl-* (work-lineage) traces commit/PR/issue chains across source types; cov-* (coverage) requires breadth across the corpus.

## Why this is happening — code path

`packages/search/src/query.ts:144-181`:

1. `fetchK = topK * 3` (default) or `topK * 10` (when `diversityEnforce` is on).
2. `vectorIndex.search(queryVector, fetchK)` returns the wide pool.
3. `reranker.rerank(...)` is called with `{ topN: topK }` — **the reranker pre-trims the pool to topK before returning** (line 178).
4. Line 187 filter: `rerankedScores.has(m.entry.storageId)` drops every candidate not in the trimmed top-K.
5. `diversityEnforce` (line 240) runs on the remaining ~topK candidates — but the reranker already homogenized the pool. The diversity rescue has nothing to rescue from.

Same pattern in `packages/search/src/trace/trace.ts:269` for trace-stage rerank: `topN: maxTotal` pre-trims before any downstream selector.

## Why the reranker prompt is also part of the problem

`packages/search/src/rerankers/llm.ts:25-30` (system prompt):

```
You are a relevance scoring assistant. Given a search query and a list of candidate documents,
score each candidate's relevance to the query on a scale of 0.0 to 1.0.
...
Score 1.0 = perfectly relevant, 0.0 = completely irrelevant.
```

The prompt:
- Pointwise scoring (each candidate independently, no comparison)
- Pure relevance objective — no source-type, no diversity, no structural signal
- Sees `c.text.slice(0, 400)` per candidate (line 62) — ~80 tokens, far less than the embedder sees

A diversity-aware prompt with comparative ranking would change the scoring behavior even if the pre-trim bug were unfixed. But the pre-trim bug eliminates the diversity-enforce safety net entirely; prompt work alone cannot recover it.

## Verdict

The Stage 1 conclusion **"reranker doesn't help"** is correct as a *production decision under the current pipeline*. It is **not a fair verdict on qwen36-27b-aeon as a reranker model**. The reranker's behavior is consistent with a model correctly executing a misframed task in a structurally broken pipeline.

## Recommended next steps

1. **Fix H1**: in `query.ts` and `trace.ts`, pass `topN: fetchK` (or omit the `topN` parameter) to `reranker.rerank()`. Let `diversityEnforce` operate on the full reranked pool.
2. **Fix H5**: bump `c.text.slice(0, 400)` → `slice(0, 2000)` in `llm.ts` so the reranker has comparable context to what the embedder used.
3. **Targeted small rerun**: 10-20 queries (mix of the 26 flipped queries + already-saturated controls) on raw-vllm post-fix. ~30-45 min instead of 7.35 hr.
4. **Only if (1)+(2)+(3) recovers quality**: redesign the prompt for comparative ranking with diversity awareness ([#313](https://github.com/SgtPooki/wtfoc/issues/313)).
5. **Defer**: graph/edge audit, model swap. Both are downstream of fixing the structural bug.

## Artifacts

- Per-query flip data: `/tmp/flipped-queries.json` (session-scoped — 26 row JSON array, key fields: id, category, distinctSourceTypes before/after, distinctDocs before/after, recallAtK before/after)
- No-rerank report: `/var/folders/.../wtfoc-sweep-D8klz3/noar_div_rrOff-filoz-ecosystem-2026-04-v12.json` (session-scoped temp, may GC)
- Qwen rerank report: `~/.wtfoc/autoresearch/raw-vllm-rerank-smoke.json` (persistent)
