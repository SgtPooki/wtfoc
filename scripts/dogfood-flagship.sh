#!/usr/bin/env bash
# Flagship dogfood run (wtfoc-vlk0): quality-queries stage against a
# primary demo corpus + one secondary corpus. Primary hits the
# threshold-check with hard-fail semantics; secondary runs advisory
# (reports + warns but does not exit 1) per peer-review (codex: let a
# new second-corpus baseline settle for one cycle before hard-gating).
#
# Env overrides:
#   WTFOC_FLAGSHIP_COLLECTION     primary corpus (default filoz-v12)
#   WTFOC_SECONDARY_COLLECTION    secondary corpus, advisory (default wtfoc-dogfood-v3)
#   WTFOC_SKIP_SECONDARY=1        run primary only
#
# See docs/dogfood-cadence.md for the cadence, thresholds, and manual
# invocation variants.

set -euo pipefail

PRIMARY="${WTFOC_FLAGSHIP_COLLECTION:-filoz-ecosystem-2026-04-v12}"
SECONDARY="${WTFOC_SECONDARY_COLLECTION:-wtfoc-dogfood-2026-04-v3}"
REPORTS_DIR="${HOME}/.wtfoc/dogfood-reports"
mkdir -p "$REPORTS_DIR"
STAMP=$(date +%s)

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
	echo "error: OPENROUTER_API_KEY not set" >&2
	exit 2
fi

if ! curl -sf http://127.0.0.1:4523/health >/dev/null; then
	echo "error: Claude direct proxy not running on :4523 (start with 'node scripts/claude-direct-proxy.mjs')" >&2
	exit 2
fi

run_corpus() {
	local collection="$1"
	local out="$REPORTS_DIR/flagship-${collection}-${STAMP}.json"
	echo ""
	echo "=== Dogfood: $collection → $out ==="
	pnpm dogfood \
		--collection "$collection" \
		--stage quality-queries \
		--embedder-url https://openrouter.ai/api/v1 \
		--embedder-model baai/bge-base-en-v1.5 \
		--embedder-key "$OPENROUTER_API_KEY" \
		--extractor-url http://127.0.0.1:4523/v1 \
		--extractor-model haiku \
		--diversity-enforce \
		--output "$out"
	echo "$out"
}

PRIMARY_OUT=$(run_corpus "$PRIMARY" | tail -1)
echo ""
echo "=== Threshold check (primary, hard-fail) ==="
pnpm exec tsx scripts/dogfood-check-thresholds.ts "$PRIMARY_OUT"

if [[ "${WTFOC_SKIP_SECONDARY:-0}" != "1" ]]; then
	SECONDARY_OUT=$(run_corpus "$SECONDARY" | tail -1)
	echo ""
	echo "=== Threshold check (secondary, advisory) ==="
	pnpm exec tsx scripts/dogfood-check-thresholds.ts --advisory "$SECONDARY_OUT"
fi
