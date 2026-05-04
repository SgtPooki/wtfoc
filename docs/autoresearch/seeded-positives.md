# Seeded Positives — Harness Sensitivity Regression Set

Manually crafted retrieval-quality lifts that the autoresearch harness must continue to accept end-to-end. If a future scorer/decision-rule change starts rejecting any of these, that change is breaking harness sensitivity to real lifts.

Run via: `pnpm tsx scripts/autoresearch/gate3-seeded-positive.ts`

Each entry pins:
- The seed (what change creates the lift)
- The baseline + candidate variants in a known sweep
- Expected acceptance signals (trimmed-mean delta, per-corpus bootstrap probability)
- The hard-gate floors used (relaxed when current absolute pass rates can't clear DEFAULT_GATES — gate 3 tests sensitivity, not absolute health)

## SP-1 — autoRoute=off (Phase A gate 3)

- **Issue**: #381 (Phase A exit gate 3); confirms #314 (auto-route harmful)
- **Date validated**: 2026-05-04
- **Seed**: `autoRoute=true → autoRoute=false` (no code change; existing knob flip)
- **Sweep**: `~/.wtfoc/autoresearch/reports/sweep-retrieval-baseline-1777900815204/` (16-variant, 2026-05-04)
- **Baseline variant**: `ar_div_rrOff`
- **Candidate variant**: `noar_div_rrOff`
- **Corpora**: `filoz-ecosystem-2026-04-v12`, `wtfoc-dogfood-2026-04-v3`

### Expected signals

| Metric | filoz | dogfood | Threshold |
|---|---|---|---|
| baseline passRate | 0.352 | 0.519 | — |
| candidate passRate | 0.419 | 0.595 | — |
| Δ passRate | +0.067 | +0.076 | ≥0.04 |
| bootstrap meanDelta | 0.067 | 0.076 | ≥0.04 (`MIN_LIFT`) |
| bootstrap probBgreaterA | 0.981 | 0.984 | ≥0.95 (`MIN_PROBABILITY`) |
| 95% CI | [0.010, 0.133] | [0.013, 0.152] | excludes 0 |

`decideMulti` trimmed-mean delta: 0.0713 (≥0.04). Both corpora accept under per-corpus must-pass floor (default 3pp drop tolerance — neither drops).

### Hard gates (relaxed)

```ts
{ overallMin: 0.35, demoCriticalMin: 0.0, workLineageMin: 0.1,
  fileLevelMin: 0.4, applicableRateMin: 0.5,
  hardNegativeMin: 0, paraphraseInvariantMin: 0 }
```

Floors set just below baseline pass rates so the candidate's lift moves it cleanly above. The post-scorer-hygiene sweep (PRs #376/#377/#379) intentionally lowered absolute pass rates by tightening evidence gates — Phase B (#364) will set absolute floors that match the calibrated scorer.

### Why this is a valid positive control

- Real, independent evidence the lift exists (#314 catalogued auto-route as harmful)
- Reproduces across both corpora (cross-corpus aggregate, not a single-corpus fluke)
- Bootstrap probability and trimmed-mean delta both clear thresholds with margin
- Failure mode would only fire if (a) the scorer breaks signal alignment or (b) decideMulti's aggregation/floor logic regresses

### Failure modes this guards against

- Scorer changes that wash out per-query alignment (would crash bootstrap probability)
- Floor regressions (a future PR raising `MIN_LIFT` or `MIN_PROBABILITY` past these signals)
- Hard-gate inversions (e.g., applicableRate floor pushed above achievable values)
- Per-corpus aggregation changes that break the trimmed mean
