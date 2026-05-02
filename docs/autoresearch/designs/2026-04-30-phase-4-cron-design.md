# Phase 4 — Autonomous Nightly Autoresearch Cron (Design, pre-implementation)

**Status:** DRAFT v2 — peer review consensus incorporated (codex + cursor + gemini, 2026-04-30)
**Tracks:** [#318](https://github.com/SgtPooki/wtfoc/issues/318) (parent: [#311](https://github.com/SgtPooki/wtfoc/issues/311))
**Author:** claude-code (handing to maintainer)
**Date:** 2026-04-30

## 1. Goal

Run the existing `pnpm autoresearch:sweep retrieval-baseline` harness on a nightly schedule, detect threshold breaches and statistically significant regressions against a running baseline, and auto-file a GitHub issue per regression — without paying for any AI API call in the recurring path.

## 2. Hard constraints

- **Local-first.** Cron host must run on the maintainer's Mac (Apple Silicon) with access to:
  - Native BGE-reranker sidecar at `http://localhost:8386` (started via `./services/bge-reranker/run-native.sh`) — currently OUT OF MATRIX (production = `noar_div_rrOff`, no reranker), but the host must be able to reach it for future variants.
  - Local LLM endpoints (extractor: `http://127.0.0.1:4523/v1` haiku via Claude direct proxy).
  - OpenRouter for embedder (`baai/bge-base-en-v1.5` is $0).
- **No paid AI API keys in the recurring path.** Maintainer-only on-demand verification using paid models is acceptable; nightly is not.
- **No private-infrastructure runtime artifacts.** No private image registries, no private URLs in committed source, no parsing of private-cluster output. All endpoints from env vars. (`feedback_wtfoc_runtime_independence.md`.)
- **Don't false-positive on outages.** BGE down / local LLM down / OpenRouter rate-limited must NOT be reported as a quality regression.
- **Pre-v1.** Breaking changes to `runs.jsonl` shape acceptable.

## 3. Cron host — options + decision

| # | Option | Pros | Cons |
|---|--------|------|------|
| 1 | **launchd LaunchAgent** (Mac native) | Native; survives reboot; logs go to file natively; trivial enable/disable (`launchctl bootstrap`/`bootout`); plist checks into repo | Doesn't run while Mac asleep/closed; missed-run delivery requires explicit handling |
| 2 | macOS `cron` | Familiar | Deprecated path on modern macOS; no advantage over launchd |
| 3 | GHA cron + self-hosted runner on Mac | Audit trail in GHA; artifact upload free | Extra surface (runner registration, auth, runner uptime); GHA workflow file leaks runner identity |
| 4 | Long-running node script (`node-cron` / `setInterval`) | Single process, no plist | No supervisor; one crash = no runs until restart; no native log rotation |
| 5 | beads scheduler | Consistent with repo's beads usage | beads is an issue tracker, not a scheduler; mis-fit |
| 6 | systemd-style `pm2` / launchd-via-pm2 | Process supervision | Adds dep; we already get supervision from launchd directly |

**Decision: launchd LaunchAgent.** Native, no extra deps, plist+wrapper checks into repo, easy on/off. Missed-run delivery handled by `StartCalendarInterval` + an opportunistic on-wake hook (see §6).

A maintainer who prefers a single `node` process can run the wrapper script under `pm2` or by hand; the design accommodates both via the same wrapper entry point.

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│ launchd: com.wtfoc.autoresearch.nightly.plist                  │
│   StartCalendarInterval { hour: 3, minute: 0 }                 │
│   StandardOutPath/StandardErrorPath → ~/.wtfoc/autoresearch/   │
│                                       cron-{stdout,stderr}.log │
└──────────────────────────────┬─────────────────────────────────┘
                               │ exec
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ scripts/autoresearch/cron/run-nightly.sh                       │
│   1. preflight (bge? embedder? extractor? OPENROUTER_API_KEY?) │
│      ↳ any FAIL → write status=DEGRADED, exit 0 (no issue)     │
│   2. exec: pnpm autoresearch:sweep retrieval-baseline \        │
│            --variant-filter <production-only-list>             │
│            --stage nightly-cron                                │
│   3. exec: pnpm autoresearch:detect-regression                 │
│   4. exec: pnpm autoresearch:post-leaderboard (optional)       │
└──────────────────────────────┬─────────────────────────────────┘
                               │ runs.jsonl rows + sweep summary
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ ~/.wtfoc/autoresearch/                                         │
│   runs.jsonl                       (existing, append-only)     │
│   sweeps/<sweepId>.json            (existing)                  │
│   cron-stdout.log / cron-stderr.log                            │
│   nightly-status.json              (latest preflight + result) │
│   regressions/<sweepId>-<variant>.fingerprint   (dedupe seen)  │
└────────────────────────────────────────────────────────────────┘
```

## 4a. Peer-review revisions (2026-04-30)

Codex + Cursor + Gemini reviewed the v1 draft. Consensus changes folded in below; full review log archived in `/tmp/phase4-{codex,cursor,gemini}.log`. Highest-impact deltas:

- **Detector data dependency.** v1 implied detector reads `runs.jsonl` only. That row schema lacks per-query `scores` (needed for paired bootstrap) and lacks `workLineage` / `fileLevel` gate metrics. **Fix:** sweep wrapper archives the full `ExtendedDogfoodReport` JSON per (sweepId, variantId, corpus) to `~/.wtfoc/autoresearch/reports/<sweepId>/<variantId>__<corpus>.json` and a new `RunLogRow.reportPath` (additive, optional) points at it. Detector reads the full report; aggregates in `runs.jsonl` are kept only for fast filtering.
- **Dedupe key.** v1 mixed sweepId into the fingerprint, which broke cross-night dedupe. **Fix:** stable incident key = `(variantId, corpusId, findingType, primaryMetric, fingerprintVersion)`. Per-incident state file stores `firstSeenAt`, `lastNotifiedAt`, `issueNumber`. 7-day silence applies between notifications for the same incident.
- **Bootstrap direction.** v1 wrote "probAgreaterB ≥ 0.95 AND meanΔ ≤ −0.04" with baseline=old, candidate=new — that is internally inconsistent (with that mapping, probBgreaterA would be near 0.05 for a clear regression, not 0.95). **Fix:** detector calls `pairedBootstrap` with **A = new (latest), B = old (baseline)**. Flag a regression when `probBgreaterA ≥ 0.95 AND meanDelta ≥ 0.04` — semantically: "old convincingly beats new by ≥4pp." Mirrors promotion thresholds.
- **`decide()` reuse.** v1 was vague. Codex pointed out `evaluateGates` always evaluates `input.candidate` and the reasons strings are improvement-oriented. **Fix:** detector does NOT call `decide()`. It calls `buildFamilyResults` + `pairedBootstrap` directly for the bootstrap, and a NEW `evaluateGatesAgainstFloors(report, gates)` (extracted from the existing private helper in `decision.ts`) for breach detection.
- **Comparability rule.** v1 said "same fingerprintVersion + same corpus." That allows fixture / paraphrase / threshold drift to pollute the baseline. **Fix:** baseline window requires **exact `runConfigFingerprint` match** with the latest run. Any change → reset to `insufficient-history` for that fingerprint. Stored as part of the per-fingerprint regression-state directory.
- **Aggregation across baseline window.** v1 said "compare to each" without a rule. **Fix:** flag regression iff **a majority** (`floor(N/2) + 1`) of comparable baseline runs convincingly beat the new run by the bootstrap+lift criteria. Avoids one lucky old night triggering an alarm.
- **Concurrency lock.** v1 missed it. **Fix:** wrapper takes an exclusive flock on `~/.wtfoc/autoresearch/.cron.lock` with stale-lock recovery (>6h old PID is dead). On lock contention writes `nightly-status.json` `{status:"SKIPPED_ALREADY_RUNNING"}` and exits 0.
- **Exit-code reconciliation.** v1 §4 said "preflight fail → exit 0," §5.2 said "exit 75." **Fix:** preflight exits 75; wrapper interprets 75 as "DEGRADED" — wrapper itself exits 0 on degraded, so launchd does not treat it as a failure that warrants restart. Diagram updated.
- **Cron-health visibility.** v1 said "no issue ever filed for outages." **Fix:** if preflight fails on **5 consecutive scheduled runs** AND the most recent successful run is >7 days ago, file a single `cron-health: autoresearch nightly is degraded` issue (label `autoresearch,maintenance`). Deduped by a `~/.wtfoc/autoresearch/cron-health-issue` marker file; cleared on next successful run.
- **Production-variant lock.** v1 proposed a side file. Cursor + Gemini suggested matrix metadata. **Fix:** add `productionVariantId?: string` to the `Matrix` interface; `retrieval-baseline.ts` sets `productionVariantId: "noar_div_rrOff"`. Wrapper reads from the matrix (via `scripts/autoresearch/cron/resolve-production-variant.ts`), not a side file. Override via `WTFOC_PRODUCTION_VARIANT` for dev runs.
- **Multi-corpus regression detection** (v3 — post-v2 maintainer feedback). Original v2 detector watched only the primary corpus. **Fix:** detector public API now takes `corpora: string[]` and emits per-corpus `CorpusSummary` + flat findings list (each finding tagged with corpus). CLI auto-resolves all corpora from the matrix (primary + optional secondary). Aggregate top-level status is worst-of across corpora. A regression that only shows up on the secondary corpus is now first-class — it is a wtfoc generalization bug, NOT a corpus quality issue.
- **No baseline seeding from v1.9.0 numbers.** Codex was firm: hand-curated numbers are not run-config-identical and would silently bias the comparison. **Fix:** keep the "insufficient history" behaviour. Lower the threshold from 7 → **3 comparable nightly runs** to shorten the cold-start window. Document this in the maintainer how-to.
- **Log rotation.** v1 missed it. **Fix:** wrapper rotates `cron-stdout.log` / `cron-stderr.log` on each run when over 10 MB (move to `.1`, `.2`, ..., keep last 14). Plain `mv` — no logrotate dependency.
- **plist hardening.** Plist sets `EnvironmentVariables` with explicit `PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` and `WorkingDirectory` set to repo root. Don't depend on interactive shell PATH.

## 5. Components to build

### 5.1 Wrapper script `scripts/autoresearch/cron/run-nightly.sh`

Bash. Loads `~/.wtfoc/autoresearch/.env` if present (env-var seam — never commit secrets). Runs preflight, then sweep, then detector. Exits 0 on all failure modes that are NOT "we found a regression" — launchd should not retry.

### 5.2 Preflight check `scripts/autoresearch/cron/preflight.ts`

- `curl -sf "$EMBEDDER_URL"` (HEAD or `/models`) — fail if no 2xx.
- `curl -sf "$EXTRACTOR_URL/models"` — fail if no 2xx.
- BGE: only required if matrix uses reranker. retrieval-baseline production variant doesn't, so skip.
- `OPENROUTER_API_KEY` set + non-empty.
- Output: JSON status `{ ok, degraded: string[], checkedAt }` to `nightly-status.json`.

If degraded: log to stderr, write status, exit code 75 (EX_TEMPFAIL). Wrapper interprets 75 as "skip, not a regression".

### 5.3 Regression detector `scripts/autoresearch/detect-regression.ts`

Reads `runs.jsonl`. For the production variant id (`noar_div_rrOff`) on the primary corpus (`filoz-ecosystem-2026-04-v12`):

1. **Baseline window:** last N (default 7) successful runs at stage=`nightly-cron`, fingerprintVersion-aligned, excluding the latest. If fewer than N available, fall back to the last 3; if fewer than 3, exit 0 with `status=insufficient-history`.
2. **Hard-gate breach:** any of `passRate / demoCriticalPassRate / workLineagePassRate / fileLevelPassRate / hardNegativePassRate / applicableRate` below the floors in `decision.ts:DEFAULT_GATES` ⇒ flag `breach`. Always uses absolute floors, not deltas.
3. **Statistical regression:** rebuild paired bootstrap from the latest run's report vs each baseline-window run (same fingerprintVersion + same corpus). If `probAgreaterB ≥ 0.95 AND meanΔ ≤ -0.04` (i.e. the OLD run is convincingly better than the new one), flag `regression`.

   - Reuses `decide()` from `scripts/autoresearch/decision.ts` with baseline=latest-old, candidate=latest. We're already computing this primitive — Phase 4 just inverts the question ("did we get worse?" instead of "did we get better?").

4. Emits to stdout: JSON `{ status: "ok" | "breach" | "regression" | "both", findings: [...] }`. Exit code 0 (always — the auto-issue creator handles findings; we don't want launchd to surface this as a script failure).

5. **Dedupe.** For each finding, hash `(sweepId, variantId, findingType, primaryMetric, fingerprintVersion)` → write fingerprint file under `~/.wtfoc/autoresearch/regressions/`. If file exists, skip filing. (sweepId is unique per run, so dedupe on metric+type within a single run; the design's real dedupe is one-issue-per-finding-per-day, achieved via "one sweepId per night".)

### 5.4 Auto-issue creator `scripts/autoresearch/file-regression-issue.ts`

Given findings JSON from §5.3, calls `gh issue create --label autoresearch,regression,P2 --title ...`. Body templated:

```
Variant: <id>  Corpus: <name>  Sweep: <sweepId>
Date: <ISO>

## Finding: <breach|regression>
- Metric: <name>
- Latest: <value>
- Floor / baseline: <value>
- Δ: <abs> / <rel%>
- probBgreaterA (if regression): <0.000>
- bootstrap meanΔ: <0.000>

## Run identity
- runConfigFingerprint: <hash>  (fingerprintVersion <n>)
- runs.jsonl row (line-grep by sweepId+variantId)

## Reproduce locally
  pnpm autoresearch:sweep retrieval-baseline --variant-filter <id> --stage repro
```

Dry-run mode (`--dry-run`) prints the body and exits — used in tests + by maintainer for verification.

### 5.5 Leaderboard delta poster (optional, Phase 4.1)

Just commenting on the parent tracking issue (or appending to a markdown file in repo) is fine. Skip in v1; revisit if maintainer wants visibility. Hard requirement is `auto-files an issue on regression`; leaderboard delta is bonus.

### 5.6 Bootstrap installer `scripts/autoresearch/cron/install.sh`

```bash
bash scripts/autoresearch/cron/install.sh   # writes plist, bootstraps
bash scripts/autoresearch/cron/uninstall.sh # bootouts, removes plist
```

Plist template lives at `scripts/autoresearch/cron/com.wtfoc.autoresearch.nightly.plist.in`. Installer substitutes `$HOME` and the absolute path of the wrapper, writes to `~/Library/LaunchAgents/`, and runs `launchctl bootstrap gui/$(id -u) <path>`.

### 5.7 Production-variant filter

The cron only sweeps the production variant (`noar_div_rrOff`) on both corpora. That's ~14 minutes of runs/night. If/when a non-LLM cross-encoder reranker proves out (#319), the cron grows another variant via the matrix file and `--variant-filter`.

## 6. Behaviour under failure

| Condition | Action |
|---|---|
| Mac asleep at 03:00 | launchd defers to next wake (default behaviour). No backfill. Documented as known limitation. |
| Embedder unreachable | preflight exits 75; wrapper writes `nightly-status.json` with `status=DEGRADED, reason=embedder`; no issue filed. |
| Extractor unreachable | Same, `reason=extractor`. |
| BGE not running but matrix doesn't need it | Skip — preflight only checks services the matrix declares. |
| Sweep crashes mid-run | wrapper captures non-zero exit; writes `nightly-status.json` with `status=SWEEP_FAILED, exitCode, lastStderrTail`; no issue filed (engine bug, not regression). |
| OpenRouter rate-limit (429) | Sweep retries inside dogfood; on persistent failure, propagates as sweep crash → as above. |
| Detector finds breach AND regression | Single issue, both findings in one body. |
| Detector finds same regression two nights running | Second night's fingerprint matches first night's → skip filing. (Different sweepIds but same variant+metric+type+fingerprintVersion.) |
| Maintainer disables: | `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.wtfoc.autoresearch.nightly.plist` |

## 7. Open questions for peer review

1. **launchd vs node-cron-in-pm2.** Is launchd genuinely the right call? It loses the pure-JS audit trail. node-cron under pm2 keeps everything in-process but adds a runtime dep.
2. **Baseline window.** Last 7 nightly runs as the baseline window — is 7 right? Trade-off: longer = stabler baseline but slower to detect a sustained regression; shorter = noisier but more responsive. Phase 3 only has ~5 sweep runs total in `runs.jsonl`. We may need to seed the baseline window manually or accept "insufficient history" for the first week.
3. **Regression direction in `decide()`.** `decide()` answers "is candidate better than baseline?" (probBgreaterA). For Phase 4 we want "is candidate worse than baseline?" — we can call `decide({baseline: latest, candidate: old})` and read `accept` as "old beat new" but the gate logic and reasons string will be wrong-facing. Cleaner: extend `decide()` with a `direction: "improvement" | "regression"` param, or write a sibling `detectRegression()` that wraps `pairedBootstrap()` directly. **Recommend:** sibling function. Keep `decide()` semantically focused on accept-improvement; reuse the bootstrap primitive only.
4. **Multi-corpus failures.** Per-corpus regression detection — file one issue or two when both v12 and v3 regress on the same metric? **Recommend:** one issue per (variant, metric) pair, listing affected corpora as a list inside the body. Avoids issue spam.
5. **Production-variant lock.** Cron tracks `noar_div_rrOff` only. If maintainer changes production defaults later, the cron must be updated. **Recommend:** read the variant id from a single-source-of-truth env var or a config file at `scripts/autoresearch/PRODUCTION_VARIANT.txt`. CI lints this against the matrix.
6. **Dedupe scope.** Within one sweepId, dedupe is trivial. Across sweeps (consecutive nights), should a still-regressed metric re-file? **Recommend:** silent for 7 days, then re-file with a "still regressed" prefix. Maintainer can override.
7. **Stop rules.** Should consecutive sweep crashes trigger an issue? Three crashes in a week probably warrants a one-time `autoresearch-cron is down` issue. Bikeshed: implement now or wait until it bites?

## 8. Out of scope

- Auto-promotion of variants to production defaults. Phase 4 reports; maintainer decides.
- Slack ingestion. The leaderboard delta is bonus, not core.
- Reranker variants in the cron matrix. They follow #319.
- Multi-host distribution. Single Mac. (Future: GHA self-hosted runner becomes viable when there's a second host.)

## 9. Files this PR adds / changes

| Path | Add/Change |
|---|---|
| `docs/autoresearch/designs/2026-04-30-phase-4-cron-design.md` | NEW (this doc) |
| `scripts/autoresearch/cron/run-nightly.sh` | NEW |
| `scripts/autoresearch/cron/preflight.ts` | NEW |
| `scripts/autoresearch/cron/install.sh` | NEW |
| `scripts/autoresearch/cron/uninstall.sh` | NEW |
| `scripts/autoresearch/cron/com.wtfoc.autoresearch.nightly.plist.in` | NEW |
| `scripts/autoresearch/detect-regression.ts` | NEW |
| `scripts/autoresearch/detect-regression.test.ts` | NEW (synthetic-bad-row + noise tests) |
| `scripts/autoresearch/file-regression-issue.ts` | NEW |
| `scripts/autoresearch/file-regression-issue.test.ts` | NEW (dry-run body shape) |
| `scripts/autoresearch/PRODUCTION_VARIANT.txt` | NEW |
| `package.json` scripts | `autoresearch:detect-regression`, `autoresearch:file-issue`, `autoresearch:nightly` |
| `docs/autoresearch/cron-howto.md` | NEW (one-page maintainer guide) |

No changes to existing autoresearch source files. (Possible exception: extracting the bootstrap primitive from `decide()` if peer reviewers prefer that over a sibling function — open question §7.3.)
