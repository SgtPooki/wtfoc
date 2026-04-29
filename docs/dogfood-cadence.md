# Dogfood cadence — flagship corpus regression check

The flagship demo story hinges on the `filoz-ecosystem-2026-04-v12` corpus passing the demo-critical slice of the gold-standard queries every time we run it. This doc pins the baseline, the thresholds, and the cadence we run to catch regressions between now and June 7.

## Baseline

- Corpus: `filoz-ecosystem-2026-04-v12` — 13,477 chunks, 37 segments, 6 source types (code, markdown, slack-message, github-issue, github-pr, github-pr-comment)
- Fixture: `GOLD_STANDARD_QUERIES_VERSION = 1.9.0` (157 base queries + 135 paraphrases = 292 query texts; 12 hard negatives + 24 synthesis-tier)
- Primary corpus baseline: [`dogfood-baselines/filoz-ecosystem-2026-04-v12.json`](dogfood-baselines/filoz-ecosystem-2026-04-v12.json) — hard-gated
- Secondary corpus baseline: [`dogfood-baselines/wtfoc-dogfood-2026-04-v3.json`](dogfood-baselines/wtfoc-dogfood-2026-04-v3.json) — advisory for one cycle
- Captured: 2026-04-23 (v1.6.0); re-baselined 2026-04-28 (v1.8.0) and 2026-04-29 (v1.9.0) per #311.

Pass rates are computed against the **applicable** subset — queries the current corpus can answer at all. Queries with `collectionScopePattern` mismatches or `requiredSourceTypes` the corpus doesn't ingest are reported as skipped, not failed, so the overall rate means the same thing across corpus changes.

Flagship runs enable source-type diversity enforcement (`--diversity-enforce`, #161) so a dominant source type (slack on v12) cannot monopolize top-K / seeds and starve queries of cross-source evidence. Turned on by default in `dogfood-flagship.sh`.

Primary corpus numbers (filoz-ecosystem-2026-04-v12, fixture v1.9.0):

| Slice | Pass rate |
|---|---|
| overall applicable | 87/153 (56.9%) |
| portable | (varies by tier) ~46% |
| applicability rate | 153/157 (97.5%) |
| demo-critical tier | 5/5 (100%) ← original wl-1..wl-5 hand-curated |
| work-lineage | 17/27 (63.0%) ← cursor expanded with hard cross-org queries |
| file-level | 9/12 (75.0%) ← gemini expansion |
| hard-negative | 0/12 (0%) ← retrieval hallucinate-matches all 12 (top scores 0.67–0.75) |
| paraphrase invariance | 80.5% (when WTFOC_CHECK_PARAPHRASES=1) |
| recall@10 (demo-critical mean) | 0.50 ← v1.8.1 broke substring-mirror circularity; lower number is real signal |
| recall@10 (overall mean over 24 graded) | 0.70 |

Skipped on v12: `dl-3`, `syn-1` (wtfoc-self internals), `dl-7` (needs package.json ingest), `cov-8` (needs doc-page ingest).

Secondary corpus numbers (wtfoc-dogfood-2026-04-v3) — advisory only for one cycle:

| Slice | Pass rate |
|---|---|
| overall applicable | 24/44 (54.5%) |
| **portable** | **13/13 (100%)** ← generic retrieval generalizes |
| corpus-specific | 11/31 (35.5%) ← as expected, v12-tuned queries don't cross corpora |
| applicability rate | 44/45 (97.8%) |
| demo-critical tier | 0/5 (0%) ← all five are filoz-specific, expected |

**The key reading:** 100% portable on a *different* corpus is the strongest single signal that generic retrieval is working. Low corpus-specific pass rate on wtfoc-v3 is correct behavior — those queries name filoz artifacts and should not pass on wtfoc.

## Regression thresholds

Enforced by [`scripts/dogfood-check-thresholds.ts`](../scripts/dogfood-check-thresholds.ts). Exit 1 on any violation.

| Slice | Floor | Why |
|---|---|---|
| overall | 55% | Re-baselined for v1.9.0 — fixture expanded 67→157 base queries, many deliberately harder; floor catches systemic regression without flapping |
| portable | 40% | Was 70% on 13 queries; now ~30 portable. Re-baselined for the broader portable set |
| applicability rate | 60% | If <60% of the fixture applies to this corpus, the fixture is too narrow |
| work-lineage | 60% | Was 87.5% on 8/9; now 27 wl queries (cursor expansion). Floor at 60% with one-query buffer |
| demo-critical tier | 100% | Hard floor — original wl-1..wl-5 only |
| file-level | 70% | Was 100% on 4/4; now 12 fl queries (gemini expansion). Floor at 70% |
| hard-negative | 0% | Calibration floor today; tightens with score-ceiling now in place |
| paraphrase invariance | 70% | Brittleness check; canonical-pass + ≥1-paraphrase-fail signals memorization |

The lower-tier categories (cross-source, coverage, synthesis) are intentionally **not** threshold-gated. Their failures are tracked as individual issues (cs-3, cs-5, cov-2, cov-6, syn-*) and tuned separately — we do not want threshold churn blocking the flagship story on unrelated work.

## How to run

One-shot, against the flagship corpus:

```bash
pnpm dogfood:flagship
```

This runs the quality-queries stage using the pinned embedder config (OpenRouter `baai/bge-base-en-v1.5`, Claude-direct-proxy extractor) and writes a timestamped report to `~/.wtfoc/dogfood-reports/`, then runs the threshold check on it. Exit 0 = pass, 1 = regression.

Manual equivalent (when you need different flags):

```bash
OUT=~/.wtfoc/dogfood-reports/v12-qq-$(date +%s).json
pnpm dogfood \
  --collection filoz-ecosystem-2026-04-v12 \
  --stage quality-queries \
  --embedder-url https://openrouter.ai/api/v1 \
  --embedder-model baai/bge-base-en-v1.5 \
  --embedder-key "$OPENROUTER_API_KEY" \
  --extractor-url http://127.0.0.1:4523/v1 \
  --extractor-model haiku \
  --output "$OUT"
pnpm tsx scripts/dogfood-check-thresholds.ts "$OUT"
```

The extractor URL is the local Claude direct proxy — start it first with `node scripts/claude-direct-proxy.mjs` if `curl -s http://127.0.0.1:4523/health` fails. The `$OPENROUTER_API_KEY` env var must be set.

## Cadence

**Weekly, every Monday,** until June 7, 2026. Manual for now — automation can wait until the loop itself is stable. Record the run:

1. Run `pnpm dogfood:flagship`.
2. If it passes: no action. The timestamped report in `~/.wtfoc/dogfood-reports/` is the receipt.
3. If it fails: triage which threshold broke and open a beads issue against the failing category before making other changes. Do not re-baseline to hide a regression.

**Pre-demo (last week of May 2026):** daily runs. The thresholds tighten implicitly because you have no time to recover from a regression.

**Post-commit trigger:** any commit that touches `packages/search/**`, `packages/ingest/**/edges/**`, gold-standard-queries, or the embedder config should be followed by a manual `pnpm dogfood:flagship` before the next commit. Not enforced by hooks yet — discipline-based.

## Re-baselining

Re-baselining is a deliberate act, not a workaround. Do it when:

- A new corpus version supersedes v12 (e.g. filoz-v13 ships).
- The gold fixture version bumps in a way that changes what "the same run" means.
- Extractor/embedder config changes and the old numbers stop being comparable.

Update this doc and `docs/dogfood-baselines/` in the same commit. Include the new capture date and a one-line reason.

## See also

- [`packages/search/src/eval/gold-standard-queries.ts`](../packages/search/src/eval/gold-standard-queries.ts) — the fixture set
- [`.claude/skills/dogfood/SKILL.md`](../.claude/skills/dogfood/SKILL.md) — interactive `/dogfood` runner
- `wtfoc-vlk0` — the bead this doc closes out
- #264 — June 7 conference-ready MVP tracker
