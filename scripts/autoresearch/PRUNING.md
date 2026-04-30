# Two-stage pruning (#311 Phase 2d) — design + deferred-implementation note

## Context

The #311 spec calls for successive-halving / Hyperband-style pruning when
sweeping retrieval/embedder/synthesis variants:

> - **Stage A:** cheap screen on portable + demo-critical subset with
>   isolated caches.
> - **Stage B:** full 45-query paired eval on Stage-A survivors.
> - **Stage C:** N=3 replicate runs on Stage-B top-N (cache-busted,
>   seed-varied).
> - Prune when: lower bound of paired-delta CI < -x on any protected
>   tier, OR applicability drops, OR demo-critical/work-lineage
>   regress at all.

The harness shipped in this branch (Phase 2a–c, 2e, 2f) runs **single-
stage**: every variant goes through the full 157-query fixture. Decision
+ Pareto rank + run log all work; Stage A/B/C pruning is **deferred
intentionally**.

## Why deferred

Two reasons:

1. **No win in current pipeline.** Retrieval and the synthesis +
   grader pipeline today both run with `temperature: 0`. Replicates
   (Stage C) produce identical results — there is no variance signal
   to consume. The reviewer requirement was framed in terms of
   `temperature > 0` paths that do not exist yet.

2. **No auto-promotion.** Phase 2 ships as **tooling** (peer-review
   consensus). The harness reports rankings; a maintainer decides
   whether to land any new defaults manually. Stage A's value is
   wallclock savings on long sweeps where 90% of variants are obvious
   losers — useful when sweeps are cheap-but-frequent (nightly cron),
   not when sweeps are run by hand a few times a week.

## When to land Stage A/B

Land Stage A when one of these is true:

- A sweep matrix has ≥ 16 variants AND a single full run takes
  ≥ 5 min (so wallclock savings are measurable).
- A nightly cron over a fixed matrix is being automated (Phase 4 of
  #311).
- A retrieval variant turns on temperature > 0 anywhere (e.g. an
  LLM reranker that samples instead of greedy-decoding).

## Implementation sketch

The smallest version that meets the spec:

1. **Evaluator subset filter.** Add `subsetFilter?: { tiers?: string[];
   portability?: string[] }` to `QualityQueriesContext`. When set, mark
   any non-matching query as skipped with reason `"stage-a-filter"`.
   File touched: `packages/search/src/eval/quality-queries-evaluator.ts`.

2. **Dogfood CLI flag.** Add `--query-subset <name>` to
   `scripts/dogfood.ts`. Pre-defined subsets:
   - `stage-a` → `{ tiers: ["demo-critical"], portability: ["portable"] }`
   - `demo-critical-only` → `{ tiers: ["demo-critical"] }`
   The flag wires into `QualityQueriesContext.subsetFilter`.

3. **Sweep driver Stage A loop.** When `matrix.pruning?.twoStage === true`:
   - Stage A: run every variant with `--query-subset stage-a`.
     Compute `decide(stageABaseline, stageACandidate)` per variant.
     Prune any variant where `decide.accept === false` AND the
     reason is a hard-gate failure (not just a marginal lift). The
     pruning rule MUST NOT prune on Stage A bootstrap-noise — Stage A
     has only 5–35 queries so CIs are wide.
   - Stage B: run survivors with full fixture (no `--query-subset`).
     Same `decide()` flow as today.

4. **Stage C.** Skip until temperature > 0 stages exist. When they do:
   - Stage C: re-run Stage B top-N with cache-busted fingerprint
     (e.g. `WTFOC_FORCE_NONCE` env var the fingerprint includes,
     bumped per replicate). Compute variance across the replicates.
     Drop variants whose between-replicate variance exceeds the
     between-variant gain.

## Run-log support

`RunLogRow` already has `replicateIdx?: number` (Phase 2b). When
Stage C lands, Stage A/B rows leave it unset and Stage C rows tag
`replicateIdx: 0..2`. Readers consuming the log to build summary
tables (Phase 4 cron leaderboard) filter by stage via the
`sweepId` + presence of `replicateIdx`.

## Tracking

`bd` issue tagged `phase-2-pruning` will track the actual
implementation when one of the "when to land" triggers fires.
