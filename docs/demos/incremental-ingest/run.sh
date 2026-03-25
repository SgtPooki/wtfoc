#!/usr/bin/env bash
set -euo pipefail

# incremental-ingest.sh — Show that collections grow over time, not start over
#
# Usage:
#   ./docs/demos/incremental-ingest/run.sh                       # full demo (~2 min)
#   ./docs/demos/incremental-ingest/run.sh --embedder-url lmstudio --embedder-model mxbai-embed-large-v1
#
# Prerequisites: run the quick-start demo first to create the collection:
#   ./docs/demos/quick-start/run.sh
#
# This demo is contrived for speed — it adds GitHub activity to the existing
# wtfoc-quick-start collection, then re-ingests to show dedup. In practice,
# incremental ingestion shines with multiple repos and source types added
# over days/weeks.
#
# See docs/demos/incremental-ingest/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="wtfoc-quick-start"
EMBEDDER_ARGS=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		lmstudio) EMBEDDER_ARGS="--embedder-url lmstudio --embedder-model mxbai-embed-large-v1"; shift ;;
		--embedder-url|--embedder-model|--embedder-key|--embedder)
			EMBEDDER_ARGS="$EMBEDDER_ARGS $1 $2"; shift 2 ;;
		*) shift ;;
	esac
done

CLI="$REPO_ROOT/wtfoc"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  wtfoc — Incremental Ingestion                      ║"
echo "║  Collections grow over time, not start over          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Verify collection exists
if ! $CLI status -c "$COLLECTION" >/dev/null 2>&1; then
	echo "❌ Collection '$COLLECTION' not found."
	echo ""
	echo "Run the quick-start demo first:"
	echo "  ./docs/demos/quick-start/run.sh"
	exit 1
fi

# ─── Baseline ─────────────────────────────────────────────
echo "Baseline: existing collection from quick-start"
echo "────────────────────────────────────────────────────"
echo ""

echo "📊 Current status:"
$CLI status -c "$COLLECTION"
echo ""

echo "🔍 Trace: \"how does ingest work?\""
$CLI trace "how does ingest work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

# ─── Round 1: Add GitHub activity ─────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "Round 1: Add GitHub activity to the SAME collection"
echo "────────────────────────────────────────────────────"
echo ""

echo "🐙 Ingesting GitHub issues/PRs (last 90 days)..."
echo "   → SgtPooki/wtfoc"
$CLI ingest github SgtPooki/wtfoc -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|Ingested|skipped)" || true
echo ""

echo "📊 Status after Round 1 (should be MORE chunks):"
$CLI status -c "$COLLECTION"
echo ""

echo "🔍 Same trace, richer results (now has issues + PRs):"
$CLI trace "how does ingest work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

# ─── Round 2: Re-ingest to show dedup ─────────────────────
echo "═══════════════════════════════════════════════════════"
echo "Round 2: Re-ingest the same repo — dedup in action"
echo "────────────────────────────────────────────────────"
echo ""

echo "📄 Re-ingesting SgtPooki/wtfoc (should skip duplicates)..."
$CLI ingest repo SgtPooki/wtfoc -c "$COLLECTION" $EMBEDDER_ARGS --batch-size 500 2>&1 | grep -E "(chunks|Ingested|batches|skipped)" || true
echo ""

echo "📊 Status after Round 2 (chunk count should barely change):"
$CLI status -c "$COLLECTION"
echo ""

# ─── Summary ─────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "✅ Incremental ingestion demo complete"
echo ""
echo "Collection: $COLLECTION"
echo "Full writeup: docs/demos/incremental-ingest/README.md"
echo ""
echo "What happened:"
echo "  • Added GitHub activity to an existing code-only collection"
echo "  • Re-ingested the same repo — duplicates automatically skipped"
echo "  • Traces got richer as more source types connected"
echo ""
echo "To keep a collection fresh (e.g., weekly cron):"
echo "  ./wtfoc ingest github SgtPooki/wtfoc -c $COLLECTION --since 7d"
