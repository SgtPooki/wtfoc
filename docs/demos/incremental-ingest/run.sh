#!/usr/bin/env bash
set -euo pipefail

# incremental-ingest.sh — Show that collections grow over time, not start over
#
# Usage:
#   ./docs/demos/incremental-ingest/run.sh                       # full demo
#   ./docs/demos/incremental-ingest/run.sh --embedder-url lmstudio --embedder-model mxbai-embed-large-v1
#
# See docs/demos/incremental-ingest/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="incremental-demo"
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

# ─── Round 1: Start small ───────────────────────────────
echo "Round 1: Start with just one repo"
echo "────────────────────────────────────────────────────"
echo ""

$CLI init "$COLLECTION" --local
echo ""

echo "📄 Ingesting source code from one repo..."
echo "   → FilOzone/synapse-sdk"
$CLI ingest repo FilOzone/synapse-sdk -c "$COLLECTION" $EMBEDDER_ARGS --batch-size 200 2>&1 | grep -E "(chunks|Ingested|batches|skipped)" || true
echo ""

echo "📊 Status after Round 1:"
$CLI status -c "$COLLECTION"
echo ""

echo "🔍 Trace: \"how does upload work?\""
$CLI trace "how does upload work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

# ─── Round 2: Add GitHub activity ───────────────────────
echo "═══════════════════════════════════════════════════════"
echo "Round 2: Add GitHub activity to the SAME collection"
echo "────────────────────────────────────────────────────"
echo ""

echo "🐙 Ingesting GitHub issues/PRs (last 90 days)..."
echo "   → FilOzone/synapse-sdk"
$CLI ingest github FilOzone/synapse-sdk -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|Ingested|skipped)" || true
echo ""

echo "📊 Status after Round 2 (should be MORE chunks):"
$CLI status -c "$COLLECTION"
echo ""

echo "🔍 Same trace, richer results (now has issues + PRs):"
$CLI trace "how does upload work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

# ─── Round 3: Add another repo ──────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "Round 3: Add another repo to the SAME collection"
echo "────────────────────────────────────────────────────"
echo ""

echo "📄 Ingesting source code..."
echo "   → filecoin-project/filecoin-pin"
$CLI ingest repo filecoin-project/filecoin-pin -c "$COLLECTION" $EMBEDDER_ARGS --batch-size 200 2>&1 | grep -E "(chunks|Ingested|batches|skipped)" || true
echo ""

echo "🐙 Ingesting GitHub issues/PRs..."
echo "   → filecoin-project/filecoin-pin"
$CLI ingest github filecoin-project/filecoin-pin -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|Ingested|skipped)" || true
echo ""

echo "📊 Status after Round 3 (even more chunks, more source types):"
$CLI status -c "$COLLECTION"
echo ""

echo "🔍 Same trace, cross-repo results now:"
$CLI trace "how does upload work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

# ─── Round 4: Re-ingest to show dedup ───────────────────
echo "═══════════════════════════════════════════════════════"
echo "Round 4: Re-ingest the same repo — dedup in action"
echo "────────────────────────────────────────────────────"
echo ""

echo "📄 Re-ingesting FilOzone/synapse-sdk (should skip duplicates)..."
$CLI ingest repo FilOzone/synapse-sdk -c "$COLLECTION" $EMBEDDER_ARGS --batch-size 200 2>&1 | grep -E "(chunks|Ingested|batches|skipped)" || true
echo ""

echo "📊 Status after Round 4 (chunk count should barely change):"
$CLI status -c "$COLLECTION"
echo ""

# ─── Round 5: Add docs site ─────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "Round 5: Add a documentation site"
echo "────────────────────────────────────────────────────"
echo ""

echo "🌐 Ingesting docs.filecoin.cloud..."
$CLI ingest website "https://docs.filecoin.cloud/" -c "$COLLECTION" $EMBEDDER_ARGS 2>&1 | grep -E "(chunks|Ingested|Finished|skipped)" || true
echo ""

echo "📊 Final status (code + issues + PRs + docs — one collection):"
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
echo "  • 5 rounds of ingestion, same collection"
echo "  • Each round added new data without losing previous data"
echo "  • Re-ingesting the same content was automatically deduplicated"
echo "  • Traces got richer with each round as more sources connected"
echo ""
echo "To keep this collection fresh (e.g., weekly cron):"
echo "  ./wtfoc ingest github FilOzone/synapse-sdk -c $COLLECTION --since 7d"
echo "  ./wtfoc ingest github filecoin-project/filecoin-pin -c $COLLECTION --since 7d"
