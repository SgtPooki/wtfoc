# Autoresearch nightly cron — maintainer how-to

One-page guide for the autoresearch nightly cron (Phase 4 of #311). Tracking issue: [#318](https://github.com/SgtPooki/wtfoc/issues/318). Design rationale: [`docs/autoresearch/designs/2026-04-30-phase-4-cron-design.md`](designs/2026-04-30-phase-4-cron-design.md).

## What it does

Every night at 03:00 local, the cron:

1. Probes local services (extractor, embedder, optional reranker). If any are down, marks the night `DEGRADED` and exits without filing a quality issue.
2. Runs `pnpm autoresearch:sweep retrieval-baseline --stage nightly-cron` over the production variant on both corpora.
3. Compares the latest run against a baseline window (last ≥3 nightly runs with the same `runConfigFingerprint`).
4. Files a GitHub issue when:
   - any hard gate is breached (overall, demoCritical, workLineage, fileLevel, hardNegative, applicableRate, paraphraseInvariant), OR
   - a majority of comparable baseline runs convincingly beat the latest by paired bootstrap (probBgreaterA ≥ 0.95 ∧ meanΔ ≥ 0.04).
5. Suppresses duplicate issues with a 7-day silence window keyed on `(variantId, corpus, findingType, metric, fingerprintVersion)`.

## Install

```bash
bash scripts/autoresearch/cron/install.sh
```

Substitutes the plist template, writes to `~/Library/LaunchAgents/com.wtfoc.autoresearch.nightly.plist`, bootstraps it under launchd. Idempotent — re-running rewrites + reloads.

Required env on the cron host (set in the user's shell environment OR a launchd-loaded plist override):

| Var | Purpose | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | embedder calls (BGE-base via OpenRouter, $0) | — required |
| `WTFOC_EMBEDDER_URL` | OpenRouter base | `https://openrouter.ai/api/v1` |
| `WTFOC_EXTRACTOR_URL` | local Claude direct proxy | `http://127.0.0.1:4523/v1` |
| `WTFOC_RERANKER_URL` | only checked when reranker required | `http://127.0.0.1:8386` |
| `WTFOC_REQUIRE_RERANKER` | `1` enables reranker preflight probe | unset |
| `WTFOC_NIGHTLY_MATRIX` | matrix file under `scripts/autoresearch/matrices/` | `retrieval-baseline` |
| `WTFOC_NIGHTLY_STAGE` | stage tag in run-log rows | `nightly-cron` |
| `WTFOC_PRODUCTION_VARIANT` | override matrix `productionVariantId` | (read from matrix) |
| `WTFOC_AUTORESEARCH_DIR` | state directory | `~/.wtfoc/autoresearch` |
| `WTFOC_REGRESSION_SILENCE_DAYS` | silence window between re-files | `7` |

## Inspect

```bash
# Recent run status
cat ~/.wtfoc/autoresearch/nightly-status.json

# Live tail
tail -f ~/.wtfoc/autoresearch/cron-stderr.log

# Last detector findings
cat ~/.wtfoc/autoresearch/last-findings.json

# Listed under launchd
launchctl list | grep com.wtfoc.autoresearch.nightly
```

## Run on demand

```bash
launchctl kickstart -p gui/$(id -u)/com.wtfoc.autoresearch.nightly
```

OR (no plist required):

```bash
bash scripts/autoresearch/cron/run-nightly.sh
```

OR just the detector against existing runs.jsonl:

```bash
pnpm exec tsx --tsconfig scripts/tsconfig.json scripts/autoresearch/detect-regression.ts \
    --matrix retrieval-baseline --stage nightly-cron
```

## Disable

```bash
bash scripts/autoresearch/cron/uninstall.sh
```

State is preserved so re-install picks up where it left off.

## Known limitations

- **Mac sleep**: launchd defers a missed `StartCalendarInterval` until next wake; if the Mac is asleep at 03:00, the run shifts later. There is no backfill — one missed night means one missed run, not a catch-up storm.
- **Cold start**: first ~3 nightly runs sit at `insufficient-history`. No regression detection until the baseline window fills. Manual seeding from historical numbers is intentionally not supported (would mix incomparable run configs into the bootstrap).
- **Production-variant lock**: the cron tracks `noar_div_rrOff` only. If production defaults change (e.g. cross-encoder reranker lands), update `productionVariantId` in `scripts/autoresearch/matrices/retrieval-baseline.ts`.
- **No leaderboard delta posting**: skipped from v1. Read sweep summaries directly: `ls -t ~/.wtfoc/autoresearch/sweeps | head -1`.

## Cron-health visibility

If preflight fails on **5 consecutive scheduled runs** AND the last successful run was ≥7 days ago, the wrapper files one `cron-health: autoresearch nightly is degraded` issue (label `autoresearch,maintenance,P2`). The next successful run clears the marker and the next nightly that fails again will re-file.

## When findings come in

Each filed issue carries:

- `variantId`, `corpus`, `corpusDigest`, `runConfigFingerprint`, `latestSweepId`, `latestLoggedAt`.
- For breaches: the metric, the actual value, the floor, and the gap.
- For regressions: bootstrap meanΔ, probBgreaterA, list of baseline sweepIds that beat the latest.
- A `pnpm autoresearch:sweep ... --variant-filter <id> --stage repro` command for local repro.
- A `grep` command to find the matching `runs.jsonl` row.

To investigate, start with the repro command + the archived report at `~/.wtfoc/autoresearch/reports/<sweepId>/`.
