#!/usr/bin/env bash
# Flagship dogfood run (wtfoc-vlk0): quality-queries stage on
# filoz-ecosystem-2026-04-v12 with the pinned embedder/extractor config,
# followed by regression threshold check.
#
# See docs/dogfood-cadence.md for the cadence, thresholds, and manual
# invocation variants.

set -euo pipefail

COLLECTION="${WTFOC_FLAGSHIP_COLLECTION:-filoz-ecosystem-2026-04-v12}"
REPORTS_DIR="${HOME}/.wtfoc/dogfood-reports"
mkdir -p "$REPORTS_DIR"
OUT="$REPORTS_DIR/flagship-$(date +%s).json"

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
	echo "error: OPENROUTER_API_KEY not set" >&2
	exit 2
fi

if ! curl -sf http://127.0.0.1:4523/health >/dev/null; then
	echo "error: Claude direct proxy not running on :4523 (start with 'node scripts/claude-direct-proxy.mjs')" >&2
	exit 2
fi

echo "Flagship dogfood run: $COLLECTION → $OUT"
pnpm dogfood \
	--collection "$COLLECTION" \
	--stage quality-queries \
	--embedder-url https://openrouter.ai/api/v1 \
	--embedder-model baai/bge-base-en-v1.5 \
	--embedder-key "$OPENROUTER_API_KEY" \
	--extractor-url http://127.0.0.1:4523/v1 \
	--extractor-model haiku \
	--diversity-enforce \
	--output "$OUT"

echo ""
pnpm tsx scripts/dogfood-check-thresholds.ts "$OUT"
