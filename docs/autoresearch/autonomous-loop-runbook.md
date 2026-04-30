# Autonomous improvement loop — runbook

Operational guide for running and monitoring the autoresearch closed-loop. Audience: maintainer + future agents (Claude / Codex / Cursor) starting fresh sessions and needing to pick up where prior work left off.

## What the loop is

A nightly closed-loop that detects regressions in wtfoc's retrieval/synthesis quality, has a local LLM propose a fix, A/B tests the fix against production, and (on accept) opens a draft PR for the maintainer to review.

**The wtfoc thing being optimized.** wtfoc is an evidence-backed **trace engine with explicit, typed edges across any content type**. NOT a RAG, NOT FOC-only, NOT engineering-only. Read [`docs/vision.md`](vision.md) and [`docs/why.md`](why.md) for the authoritative framing — RAG is one of four collection use cases (Extend / RAG / Share / Drift-detection), and FOC is the *default* StorageBackend, not a requirement. Collections can hold any domain (engineering artifacts, customer support data, financial time-series, audio metadata — anything).

The loop optimizes the **pipeline quality on whatever corpus is configured** — chunking, embedding, retrieval, edge extraction, traversal, synthesis. The goal is "wtfoc generalizes across content types," NOT "this corpus is good." Diverse corpora are stress-tests, not subjects under test (#328 tracks growing the corpus matrix).

## Metrics to optimize (and explicitly drop)

**Optimize:**
- `passRate` (overall)
- `demoCriticalPassRate` (hard floor 100%)
- `workLineagePassRate` (hard floor 60%)
- `fileLevelPassRate` (hard floor 70%)
- `hardNegativePassRate` (hard floor 0% — must NOT degrade)
- `applicableRate` (hard floor 60%)
- `paraphraseInvariantFraction` (hard floor 70% — currently waived; aspirational)
- `recallAtKMean`
- `latencyP95Ms`
- (future) hallucination rate (when grader is on)

**Explicitly NOT optimized:** `costUsdTotal`. Local LLM = $0 by definition. Cost gate is commented out in `decide()` (TODO #331). Re-enable only if a paid-LLM path is ever introduced.

## Architecture (one-line per component)

```
launchd LaunchAgent (com.wtfoc.autoresearch.nightly) at 03:00 local
  └─ scripts/autoresearch/cron/run-nightly.sh         wrapper, lock, log rotation
      ├─ scripts/autoresearch/cron/preflight.ts        probe local LLM + embedder + (optional) reranker
      ├─ pnpm autoresearch:sweep                       runs production variant on configured corpora
      ├─ scripts/autoresearch/detect-regression.ts     paired bootstrap vs baseline window
      ├─ scripts/autoresearch/file-regression-issue.ts dedupe, gh issue create
      └─ scripts/autoresearch/autonomous-loop.ts       (when WTFOC_AUTONOMOUS_LOOP=1)
          ├─ explain-finding.ts                        flipped-queries + gold-proximity for LLM
          ├─ planner.ts                                deterministic queue ahead of LLM
          ├─ analyze-and-propose.ts                    local LLM → { axis, value, rationale }
          ├─ materialize-variant.ts                    sweep candidate, decide() vs window
          ├─ tried-log.ts                              persistent memory across cycles
          └─ promote-via-pr.ts                         branch + commit + draft PR
```

**State:** all under `~/.wtfoc/autoresearch/` — out of repo, never committed. `runs.jsonl` (run log), `tried.jsonl` (proposal history), `nightly-status.json` (last run), `reports/<sweepId>/<variant>__<corpus>.json` (full archived reports), `proposals/<id>/matrix.ts` (synthetic single-variant matrix files), `regressions/<key>.json` (incident dedupe).

## Hard constraints (preserve forever)

1. **No paid AI in recurring path.** Local LLM only (`WTFOC_ANALYSIS_LLM_URL`).
2. **No homelab2 URLs in committed source.** All endpoints from env vars.
3. **No silent merge.** Every accepted variant ships as a `--draft` PR. Maintainer reviews.
4. **Collection bytes never enter commits.** Reports / runs.jsonl / tried.jsonl / proposal worktrees live under `~/.wtfoc/autoresearch/`.
5. **Code-patch proposals restricted to allowlist** (`packages/search/src/` default, `DEFAULT_MAX_DIFF_LINES=200`). See `patch-proposal.ts`.

## Run / inspect / disable

```bash
# Install the cron once
bash scripts/autoresearch/cron/install.sh

# Run on demand (no cron)
launchctl kickstart -p gui/$(id -u)/com.wtfoc.autoresearch.nightly
# OR
bash scripts/autoresearch/cron/run-nightly.sh

# Just the detector (no sweep)
pnpm exec tsx --tsconfig scripts/tsconfig.json \
  scripts/autoresearch/detect-regression.ts \
  --matrix retrieval-baseline --stage nightly-cron

# Just the loop on existing findings
pnpm exec tsx --tsconfig scripts/tsconfig.json \
  scripts/autoresearch/autonomous-loop.ts \
  --findings ~/.wtfoc/autoresearch/last-findings.json \
  --matrix retrieval-baseline --dry-run

# Disable
bash scripts/autoresearch/cron/uninstall.sh
# OR just the autonomous part:
launchctl setenv WTFOC_AUTONOMOUS_LOOP 0
```

### What to inspect

```bash
# Last run status
cat ~/.wtfoc/autoresearch/nightly-status.json

# Live tail
tail -f ~/.wtfoc/autoresearch/cron-stderr.log

# Current run log (sweep history)
wc -l ~/.wtfoc/autoresearch/runs.jsonl
tail -1 ~/.wtfoc/autoresearch/runs.jsonl | jq .summary

# What the loop has tried (cross-cycle memory)
cat ~/.wtfoc/autoresearch/tried.jsonl | jq -c '{axis: .proposal.axis, value: .proposal.value, verdict: .verdict, when: .loggedAt}'

# Last detector findings
cat ~/.wtfoc/autoresearch/last-findings.json | jq .

# Open draft PRs from the loop
gh pr list --search "head:autoresearch/" --draft
```

## Required env

| Var | Purpose | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | embedder (bge-base via OpenRouter, $0) | — required |
| `WTFOC_EMBEDDER_URL` | OpenRouter base | `https://openrouter.ai/api/v1` |
| `WTFOC_EXTRACTOR_URL` | local LLM proxy | `http://127.0.0.1:4523/v1` |
| `WTFOC_ANALYSIS_LLM_URL` | LLM for the proposer | falls back to `WTFOC_EXTRACTOR_URL` default |
| `WTFOC_ANALYSIS_LLM_MODEL` | proposer model | `haiku` |
| `WTFOC_RERANKER_URL` | only when matrix includes reranker | `http://127.0.0.1:8386` |
| `WTFOC_REQUIRE_RERANKER` | `1` to enforce preflight probe | unset |
| `WTFOC_GOLD_PROXIMITY` | `1` to compute top-50 gold rank diagnostics | unset |
| `WTFOC_AUTONOMOUS_LOOP` | `0` disables loop, alarm still files issue | `1` |
| `WTFOC_NIGHTLY_MATRIX` | matrix name | `retrieval-baseline` |
| `WTFOC_NIGHTLY_STAGE` | stage tag | `nightly-cron` |
| `WTFOC_AUTORESEARCH_DIR` | state dir | `~/.wtfoc/autoresearch` |

## Loop status states (read from `nightly-status.json` + `last-findings.json`)

| `nightly-status.json` status | Meaning |
|---|---|
| `OK` | Sweep + detector ran clean. No regressions. Lock released. |
| `DEGRADED` | Preflight failed. Local service down. Counter incremented. No issue filed. |
| `SKIPPED_ALREADY_RUNNING` | Concurrent run held lock. Skipped this fire. |

| `last-findings.json` status | Loop next step |
|---|---|
| `ok` | Skip autonomous-loop. Done. |
| `insufficient-history` | Skip. Need more nightly runs to fill baseline window (≥3). |
| `breach` | File issue + (if enabled) trigger autonomous-loop. |
| `regression` | File issue + (if enabled) trigger autonomous-loop. |
| `both` | File issue + autonomous-loop. |

## Loop outcome states (autonomous-loop.ts emits)

| Status | Meaning | Action |
|---|---|---|
| `no-finding` | Detector found nothing | Done |
| `llm-unavailable` | LLM endpoint down | Check `WTFOC_ANALYSIS_LLM_URL`. Issue still filed by file-regression-issue. |
| `no-proposal` | LLM + planner both empty | Search space exhausted. Time to plumb new knobs OR file a code-change manually. |
| `already-tried` | Proposal in tried-log within silence window | Loop self-correcting. Wait next cycle. |
| `materialize-failed` | Sweep against candidate crashed | Check tried-log row's `reasons`. Often a service issue. |
| `rejected` | decide() rejected vs majority of baselines | Tried-log row persists for next-cycle context. |
| `accepted-no-pr` | Accept but PR creation skipped | Check status notes |
| `accepted-pr-created` | Draft PR exists | **Maintainer review required.** |

## Where the human comes in

1. **Daily glance:** `cat ~/.wtfoc/autoresearch/nightly-status.json`. If `DEGRADED` for >5 days, a `cron-health` GH issue self-files.
2. **Per-finding:** GH issue with label `autoresearch,regression` (or `breach`). Autoresearch may auto-comment with rationale.
3. **Per-accepted-variant:** Draft PR with branch `autoresearch/<proposalId>`. Body has LLM rationale + bootstrap verdict + per-corpus deltas. Read the diff, run locally if uncertain, merge or close.

## Where to start a new session

If you (the agent) are picking this up cold:

1. Read this runbook (you are here).
2. Read [`project_mission_and_value`](../../) (auto-memory).
3. Read [`feedback_wtfoc_runtime_independence`](../../) (auto-memory) — collection privacy + no-homelab2 rule.
4. Check current state: `cat ~/.wtfoc/autoresearch/nightly-status.json`, `wc -l ~/.wtfoc/autoresearch/runs.jsonl`, `wc -l ~/.wtfoc/autoresearch/tried.jsonl`.
5. Check open PRs: `gh pr list --search "head:autoresearch/"`. Each one is a candidate variant awaiting maintainer review.
6. Check open autoresearch issues: `gh issue list --label autoresearch --state open`.

## Open follow-ups

- **#335** — wire LLM patch-proposer (infra ready in #334, prompt + parse path missing).
- **#330** — LLM-driven analysis attached to regression issues (extends the same proposer infrastructure).
- **#328** — slack-only + code-only corpora to broaden pipeline stress.
- **#319** — BGE cross-encoder reranker. Once running, `reranker=bge` becomes a real proposal target.

## Non-goals (for the loop)

- **Auto-merge.** Forever maintainer-gated.
- **Cost optimization.** Dropped (#331 TODO).
- **Multi-file refactors via patch proposals.** MVP is single-file targeted change.
- **Tree-sitter / AST patches.** Peer-review consensus said unified-diff is enough.
- **Code changes outside `packages/search/src/`.** Allowlist guarded.
