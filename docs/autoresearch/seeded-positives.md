# Seeded Positives — Harness Sensitivity Regression Set

Manually crafted retrieval-quality lifts that the autoresearch harness must continue to accept end-to-end. If a future scorer/decision-rule change rejects any of these, that change is breaking harness sensitivity to real lifts.

Run via: `pnpm tsx scripts/autoresearch/gate3-seeded-positive.ts`

Each entry pins:
- The synthetic patch (real code change, not a sweep-axis flip)
- Same-config A/B baseline + candidate reports (only the patch differs)
- Expected acceptance signals (decideMulti + per-corpus bootstrap)
- The hard-gate floors used (bridge floors when DEFAULT_GATES are stale post-scorer-hygiene; see Phase B / #364)

## SP-1 — TOPK 10→30 (Phase A gate 3)

- **Issue**: #381 (Phase A exit gate 3)
- **Date validated**: 2026-05-04
- **Branch validated**: `feat/381-gate3-v2`

### Synthetic patch (1 LoC)

```diff
 // packages/search/src/eval/quality-queries-evaluator.ts (line 843)
-const TOPK = overrides.topK ?? 10;
+const TOPK = overrides.topK ?? 30;
```

Monotonic retrieval lift: more candidates per query → more chances rubric thresholds met. Cannot reduce pass rate. Reverted on main; lives in candidate runs only.

### Configuration (held constant across A/B)

- Variant: `noar_div_rrOff` (autoRoute=off, diversity-enforce=on, no rerank)
- Embedder: OpenRouter `baai/bge-base-en-v1.5`
- Extractor: vLLM `qwen3-32b`
- Fixture: gold-standard-queries v2.0.0 (157 queries)
- Scorer: post-hygiene (PRs #376/#377/#379)

### Reports

- **Baseline (cached)**: `~/.wtfoc/autoresearch/reports/sweep-retrieval-baseline-1777900815204/noar_div_rrOff__{filoz-ecosystem-2026-04-v12,wtfoc-dogfood-2026-04-v3}.json` (git SHA `1ae735f`, equivalent to main HEAD pre-squash)
- **Candidate (committed)**: `docs/autoresearch/seeded-positives/sp1-candidate-{filoz,dogfood}.json`

### Expected signals

| Metric | filoz (primary, 105 applicable) | dogfood (auxiliary, 79 applicable) | Threshold |
|---|---|---|---|
| baseline passRate | 0.419 | 0.595 | — |
| candidate passRate | 0.476 | 0.620 | — |
| Δ passRate | +0.057 | +0.025 | — |
| bootstrap meanDelta | 0.057 | 0.025 | ≥0.04 (`MIN_LIFT`) on primary |
| bootstrap probBgreaterA | 0.998 | 0.867 | ≥0.95 (`MIN_PROBABILITY`) on primary |
| 95% CI | [0.019, 0.105] | [0.000, 0.063] | excludes 0 on primary |

`decideMulti` trimmedMeanDelta: 0.0412 (≥0.04). Both corpora directional positive; primary corpus bootstrap clears confidence + lift thresholds; auxiliary corpus underpowered (small applicable subset, +2 query lift can't clear bootstrap 95% threshold but is real signal).

### Bridge gates (relaxed pending Phase B / #364)

```ts
{
  overallMin: 0.40,
  demoCriticalMin: 0,        // dogfood has no demo-critical queries
  workLineageMin: 0.30,
  fileLevelMin: 0.65,
  applicableRateMin: 0.50,
  hardNegativeMin: 0,
  paraphraseInvariantMin: 0,
}
```

`DEFAULT_GATES` (`overallMin: 0.55`, `demoCriticalMin: 1.0`, etc.) were calibrated against the pre-hygiene scorer. Post-PRs #376/#377/#379 the scorer is stricter and floors are stale — `demoCriticalMin: 1.0` is mathematically unreachable on current state (3 demo-crit queries, max 1/3 currently passes). Phase B (#364) recalibrates from empirical post-hygiene pass rates and re-runs SP-1 with new defaults.

### Acceptance criteria (this gate)

1. `decideMulti` accepts the cross-corpus aggregate (`trimmedMeanDelta ≥ MIN_LIFT`)
2. Primary corpus (`filoz-ecosystem-2026-04-v12`) bootstrap clears `probBgreaterA ≥ MIN_PROBABILITY` and `meanDelta ≥ MIN_LIFT`
3. Auxiliary corpus (`wtfoc-dogfood-2026-04-v3`) shows directional positive lift (sample-size limited, no bootstrap requirement)
4. Bridge gates pass on all relevant tiers

All four held: gate 3 PASS.

### Failure modes this guards against

- Scorer changes that wash out per-query alignment (would crash bootstrap probability)
- Floor regressions (a future PR raising `MIN_LIFT` past these signals)
- Per-corpus aggregation changes that break the trimmed mean
- Hard-gate inversions (a Phase B recalibration that pushes a floor above achievable rates)
- Patch-routing changes that fail to apply a synthetic patch end-to-end

### Why TOPK 10→30 is a valid synthetic positive

- Real, single-line code change (not a sweep-axis flip)
- Monotonic — additional candidates can only increase pass rate, never decrease
- Independent of the 04-30 audit's known retrieval bugs (no overlap with #314/#327 territory)
- Cheap to verify (~3-5 min per corpus run)
- Easy to revert (1 LoC numeric)

### Phase B work tracked

- Recalibrate `DEFAULT_GATES` from empirical post-hygiene pass rates (#364)
- Re-run SP-1 with calibrated defaults; require pass under production gates as part of #364 acceptance
- Investigate why dogfood lift was small (synthesis tier moved +2, all other tiers flat) — most failures are not topK-bound; tracking note for future Tier-1 candidates
