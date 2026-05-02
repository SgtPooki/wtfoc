#!/usr/bin/env bash
# Phase 4 nightly cron wrapper. Maintainer-only.
#
# Sequence:
#   1. Acquire exclusive lock by atomic `mkdir $LOCK_DIR` (portable;
#      macOS lacks `flock`). Stale-lock recovery: if the PID recorded in
#      $PID_FILE is no longer alive, the lock dir is removed and the run
#      proceeds. Otherwise the run is skipped with status
#      SKIPPED_ALREADY_RUNNING.
#   2. Run preflight; on exit 75, write DEGRADED status, increment
#      consecutive-degraded counter, optionally file cron-health issue,
#      exit 0 (launchd does not retry).
#   3. Run sweep over the production variant for matrix
#      ($WTFOC_NIGHTLY_MATRIX, default `retrieval-baseline`) at stage
#      `nightly-cron`.
#   4. Run regression detector against runs.jsonl.
#   5. If findings non-empty, run file-regression-issue (no --dry-run).
#   6. Rotate logs > 10 MB.
#
# Exit codes: 0 on every non-fatal path. Non-zero only when sweep
# itself crashes (engine bug), so launchd shows the failure.
#
# All endpoint URLs come from env vars — none hardcoded in source.
# Repo path inferred from the script location. WTFOC_AUTORESEARCH_DIR
# overrides the state directory (default ~/.wtfoc/autoresearch).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

# Source repo .env so launchd-spawned cron has access to OPENROUTER_API_KEY
# and the WTFOC_* URLs/models. plist only exports PATH+HOME so without
# this we'd run with a near-empty environment.
if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$REPO_ROOT/.env"
    set +a
fi

STATE_DIR="${WTFOC_AUTORESEARCH_DIR:-$HOME/.wtfoc/autoresearch}"
mkdir -p "$STATE_DIR" "$STATE_DIR/regressions" "$STATE_DIR/reports"
LOCK_DIR="$STATE_DIR/.cron.lock.d"
PID_FILE="$LOCK_DIR/pid"
STATUS_JSON="$STATE_DIR/nightly-status.json"
DEGRADED_COUNTER="$STATE_DIR/consecutive-degraded"
LAST_OK_FILE="$STATE_DIR/last-ok-at"
CRON_HEALTH_MARKER="$STATE_DIR/cron-health-issue"
STDOUT_LOG="$STATE_DIR/cron-stdout.log"
STDERR_LOG="$STATE_DIR/cron-stderr.log"

MATRIX="${WTFOC_NIGHTLY_MATRIX:-retrieval-baseline}"
STAGE="${WTFOC_NIGHTLY_STAGE:-nightly-cron}"
SILENCE_DAYS="${WTFOC_REGRESSION_SILENCE_DAYS:-7}"
CRON_HEALTH_THRESHOLD="${WTFOC_CRON_HEALTH_THRESHOLD:-5}"
CRON_HEALTH_NEED_GAP_DAYS="${WTFOC_CRON_HEALTH_NEED_GAP_DAYS:-7}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[run-nightly $(ts)] $*" >&2; }

rotate_log() {
    local f="$1"
    [ -f "$f" ] || return 0
    local size
    size=$(wc -c < "$f" | tr -d ' ')
    if [ "$size" -gt 10485760 ]; then
        for i in 13 12 11 10 9 8 7 6 5 4 3 2 1; do
            [ -f "$f.$i" ] && mv "$f.$i" "$f.$((i+1))"
        done
        mv "$f" "$f.1"
        : > "$f"
    fi
}

write_degraded_status() {
    local reason="$1"
    cat > "$STATUS_JSON" <<EOF
{
  "checkedAt": "$(ts)",
  "ok": false,
  "status": "DEGRADED",
  "reason": "$reason"
}
EOF
}

write_ok_status() {
    cat > "$STATUS_JSON" <<EOF
{
  "checkedAt": "$(ts)",
  "ok": true,
  "status": "OK"
}
EOF
    : > "$DEGRADED_COUNTER"
    ts > "$LAST_OK_FILE"
    if [ -f "$CRON_HEALTH_MARKER" ]; then
        log "cron health restored — clearing $CRON_HEALTH_MARKER"
        rm -f "$CRON_HEALTH_MARKER"
    fi
}

increment_degraded() {
    local n=0
    if [ -s "$DEGRADED_COUNTER" ]; then
        n=$(cat "$DEGRADED_COUNTER")
    fi
    echo $((n+1)) > "$DEGRADED_COUNTER"
    cat "$DEGRADED_COUNTER"
}

last_ok_age_days() {
    if [ ! -f "$LAST_OK_FILE" ]; then
        echo 9999
        return
    fi
    local last
    last=$(cat "$LAST_OK_FILE" 2>/dev/null || echo "")
    if [ -z "$last" ]; then
        echo 9999
        return
    fi
    local last_epoch now_epoch
    last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$last" "+%s" 2>/dev/null || echo 0)
    now_epoch=$(date "+%s")
    if [ "$last_epoch" -eq 0 ]; then
        echo 9999
        return
    fi
    echo $(( (now_epoch - last_epoch) / 86400 ))
}

maybe_file_cron_health_issue() {
    local count="$1"
    if [ "$count" -lt "$CRON_HEALTH_THRESHOLD" ]; then
        return
    fi
    if [ -f "$CRON_HEALTH_MARKER" ]; then
        log "cron-health issue already filed — skipping"
        return
    fi
    local age
    age=$(last_ok_age_days)
    if [ "$age" -lt "$CRON_HEALTH_NEED_GAP_DAYS" ]; then
        log "consecutive degraded=$count but last OK was $age d ago (< $CRON_HEALTH_NEED_GAP_DAYS) — skipping cron-health"
        return
    fi
    log "filing cron-health issue: $count consecutive degraded, last OK $age d ago"
    local title body
    title="cron-health: autoresearch nightly is degraded ($count consecutive)"
    body=$(cat <<EOF
The autoresearch nightly cron has reported \`DEGRADED\` for $count consecutive scheduled runs. Most recent successful run was approximately $age days ago.

Most recent status: see \`$STATUS_JSON\` on the cron host.

Likely causes:
- Local extractor (Claude direct proxy) is down — restart and retry preflight.
- \`OPENROUTER_API_KEY\` is unset, expired, or rate-limited.
- BGE reranker required by the matrix is not running (\`WTFOC_REQUIRE_RERANKER=1\`).

Clear by:
1. Fix the underlying service.
2. Wait for the next successful nightly run — the wrapper deletes \`$CRON_HEALTH_MARKER\` automatically when preflight passes again.

This issue is filed once; the next nightly run that passes will not re-file it.
EOF
)
    if command -v gh >/dev/null 2>&1; then
        if gh issue create --title "$title" --label "autoresearch,maintenance,P2" --body "$body" >/dev/null; then
            ts > "$CRON_HEALTH_MARKER"
        else
            log "gh issue create failed for cron-health"
        fi
    else
        log "gh not available — cannot file cron-health issue"
    fi
}

# Acquire exclusive lock via atomic `mkdir` (portable; macOS lacks
# `flock` by default). Stale-lock recovery: if PID in lock dir is no
# longer running, override.
acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo $$ > "$PID_FILE"
        return 0
    fi
    return 1
}

if ! acquire_lock; then
    held_pid=""
    [ -f "$PID_FILE" ] && held_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$held_pid" ] && ! kill -0 "$held_pid" 2>/dev/null; then
        log "stale lock holder pid=$held_pid no longer running — overriding"
        rm -rf "$LOCK_DIR"
        if ! acquire_lock; then
            log "lock still busy after override — giving up"
            exit 0
        fi
    else
        log "active run pid=${held_pid:-?} in progress — skipping this fire"
        cat > "$STATUS_JSON" <<EOF
{
  "checkedAt": "$(ts)",
  "ok": false,
  "status": "SKIPPED_ALREADY_RUNNING",
  "heldByPid": ${held_pid:-null}
}
EOF
        exit 0
    fi
fi

cleanup_lock() {
    rm -rf "$LOCK_DIR"
}

# Best-effort GPU mode reset on exit. Only runs when WTFOC_VLLM_AUTOSWAP=1
# (helper short-circuits otherwise). Failures here are non-fatal — the
# idle-revert on the admin side will eventually restore chat.
reset_mode_to_chat() {
    if [ "${WTFOC_VLLM_AUTOSWAP:-0}" = "1" ]; then
        WTFOC_MODE_SWITCH_REASON="cron-cleanup" \
            pnpm exec tsx --tsconfig scripts/tsconfig.json \
            scripts/lib/mode-switch-cli.ts chat 2>&1 | sed 's/^/[mode-reset] /' || true
    fi
}

cleanup_all() {
    reset_mode_to_chat
    cleanup_lock
}
trap cleanup_all EXIT

log "start matrix=$MATRIX stage=$STAGE state=$STATE_DIR"

rotate_log "$STDOUT_LOG"
rotate_log "$STDERR_LOG"

# Step 1: preflight.
log "preflight starting"
pnpm exec tsx --tsconfig scripts/tsconfig.json scripts/autoresearch/cron/preflight.ts
rc=$?
if [ "$rc" -eq 75 ]; then
    log "preflight DEGRADED — exit 75"
    count=$(increment_degraded)
    write_degraded_status "preflight failed (consecutive=$count)"
    maybe_file_cron_health_issue "$count"
    exit 0
fi
if [ "$rc" -ne 0 ]; then
    log "preflight crashed with rc=$rc"
    write_degraded_status "preflight crashed rc=$rc"
    exit 0
fi

# Step 2: sweep — production variant only.
# Resolve the variant id: explicit env override > matrix.productionVariantId.
PROD_VARIANT="${WTFOC_PRODUCTION_VARIANT:-}"
if [ -z "$PROD_VARIANT" ]; then
    PROD_VARIANT=$(pnpm exec tsx --tsconfig scripts/tsconfig.json scripts/autoresearch/cron/resolve-production-variant.ts "$MATRIX" 2>/dev/null | tr -d '[:space:]')
    if [ -z "$PROD_VARIANT" ]; then
        log "no productionVariantId in matrix $MATRIX — refusing to sweep ALL variants (cost-unsafe)"
        log "set WTFOC_PRODUCTION_VARIANT or matrix.productionVariantId to fix"
        write_degraded_status "no productionVariantId resolvable"
        exit 0
    fi
fi
log "sweep starting variant=$PROD_VARIANT"
# Pre-sweep mode swap: set GPU to whatever the matrix needs. No-op when
# matrix is cloud-only or WTFOC_VLLM_AUTOSWAP!=1.
WTFOC_MODE_SWITCH_REASON="cron-pre-sweep" \
    pnpm exec tsx --tsconfig scripts/tsconfig.json \
    scripts/lib/mode-switch-cli.ts --from-matrix "$MATRIX" 2>&1 | sed 's/^/[mode-pre-sweep] /' || true
pnpm autoresearch:sweep "$MATRIX" --stage "$STAGE" --variant-filter "$PROD_VARIANT"
rc=$?
if [ "$rc" -ne 0 ]; then
    log "sweep failed rc=$rc"
    write_degraded_status "sweep failed rc=$rc"
    exit 0
fi

# Step 3: regression detection.
FINDINGS_FILE="$STATE_DIR/last-findings.json"
log "detecting regressions"
DETECT_ARGS=(--matrix "$MATRIX" --stage "$STAGE" --output "$FINDINGS_FILE")
if [ -n "${WTFOC_MIN_BASELINE:-}" ]; then
    DETECT_ARGS+=(--min-baseline "$WTFOC_MIN_BASELINE")
fi
pnpm exec tsx --tsconfig scripts/tsconfig.json scripts/autoresearch/detect-regression.ts \
        "${DETECT_ARGS[@]}"
rc=$?
if [ "$rc" -ne 0 ]; then
    log "detector crashed rc=$rc"
    write_degraded_status "detector crashed rc=$rc"
    exit 0
fi

# Step 4: file issue when findings present, then run autonomous loop.
status=$(grep -m1 '"status"' "$FINDINGS_FILE" | sed -E 's/.*"status": *"([^"]+)".*/\1/')
log "detector status=$status"
case "$status" in
    breach|regression|both)
        # Switch to chat mode for analysis LLM (file-issue + autonomous-loop
        # internal LLM calls). autonomous-loop also swaps internally between
        # chat (analyze) and gpuPhase (materialize), but landing in chat
        # here avoids the first internal swap when the GPU is already idle.
        log "swapping to chat mode for analysis phase"
        WTFOC_MODE_SWITCH_REASON="cron-pre-analyze" \
            pnpm exec tsx --tsconfig scripts/tsconfig.json \
            scripts/lib/mode-switch-cli.ts chat 2>&1 | sed 's/^/[mode-pre-analyze] /' || true
        log "filing issue(s)"
        pnpm exec tsx --tsconfig scripts/tsconfig.json scripts/autoresearch/file-regression-issue.ts \
                --findings "$FINDINGS_FILE" \
                --silence-days "$SILENCE_DAYS"
        rc=$?
        if [ "$rc" -ne 0 ]; then
            log "file-issue crashed rc=$rc"
        fi

        if [ "${WTFOC_AUTONOMOUS_LOOP:-1}" = "1" ]; then
            log "autonomous loop starting"
            pnpm exec tsx --tsconfig scripts/tsconfig.json scripts/autoresearch/autonomous-loop.ts \
                    --findings "$FINDINGS_FILE" \
                    --matrix "$MATRIX"
            rc=$?
            if [ "$rc" -ne 0 ]; then
                log "autonomous-loop crashed rc=$rc"
            fi
        else
            log "WTFOC_AUTONOMOUS_LOOP=0 — skipping autonomous loop"
        fi
        ;;
    ok|insufficient-history|"")
        log "no findings to file"
        ;;
    *)
        log "unknown detector status '$status' — skipping"
        ;;
esac

write_ok_status
log "done"
