#!/usr/bin/env bash
set -euo pipefail

# drift-analysis.sh — Run drift analysis queries against a collection
#
# Usage:
#   ./docs/demos/drift-analysis/run.sh                                # uses wtfoc-quick-start collection
#   ./docs/demos/drift-analysis/run.sh --collection foc-upload-flow   # use a different collection
#
# Prerequisites: run the quick-start demo first to create the collection:
#   ./docs/demos/quick-start/run.sh
#
# This demo is contrived for speed — it runs queries on an existing
# single-repo collection. For real-world drift analysis comparing docs
# against GitHub activity, use --collection with a larger pre-built
# collection that has both documentation and GitHub sources.
#
# The drift check itself runs as a Claude Code skill (/drift-check).
# This script runs the prerequisite queries that demonstrate what
# drift-check does under the hood.
#
# See docs/demos/drift-analysis/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="wtfoc-quick-start"
EMBEDDER_ARGS=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--collection|-c) COLLECTION="$2"; shift 2 ;;
		lmstudio) EMBEDDER_ARGS="--embedder-url lmstudio --embedder-model mxbai-embed-large-v1"; shift ;;
		--embedder-url|--embedder-model|--embedder-key|--embedder)
			EMBEDDER_ARGS="$EMBEDDER_ARGS $1 $2"; shift 2 ;;
		*) shift ;;
	esac
done

CLI="$REPO_ROOT/wtfoc"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  wtfoc — Drift Analysis                             ║"
echo "║  Find stale docs and undocumented features           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Verify collection exists
if ! $CLI status -c "$COLLECTION" >/dev/null 2>&1; then
	echo "❌ Collection '$COLLECTION' not found."
	echo ""
	echo "Run the quick-start demo first:"
	echo "  ./docs/demos/quick-start/run.sh"
	echo ""
	echo "Or specify an existing collection:"
	echo "  ./docs/demos/drift-analysis/run.sh --collection <name>"
	exit 1
fi

echo "📦 Using collection: $COLLECTION"

# ─── Drift Analysis: Under the Hood ─────────────────────
echo "═══════════════════════════════════════════════════════"
echo "🔬 Drift Analysis — Manual Steps"
echo "   (this is what /drift-check does automatically)"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "Step 1: Check collection sources"
echo "────────────────────────────────────────────────────"
$CLI status -c "$COLLECTION"
echo ""

echo "Step 2: Find high-activity topics"
echo "────────────────────────────────────────────────────"
echo ""
echo "  Query: \"breaking change migration update\""
$CLI query "breaking change migration update" -c "$COLLECTION" $EMBEDDER_ARGS -k 5 2>/dev/null
echo ""

echo "  Query: \"new feature added implemented shipped\""
$CLI query "new feature added implemented shipped" -c "$COLLECTION" $EMBEDDER_ARGS -k 5 2>/dev/null
echo ""

echo "Step 3: Trace active topics to see if docs cover them"
echo "────────────────────────────────────────────────────"
echo ""
echo "  Trace: \"pluggable vector backends and Qdrant support\""
$CLI trace "pluggable vector backends and Qdrant support" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "  Trace: \"runtime hydration and cache freshness\""
$CLI trace "runtime hydration and cache freshness" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "═══════════════════════════════════════════════════════"
echo "✅ Manual drift analysis complete"
echo ""
echo "Collection: $COLLECTION"
echo "Full writeup: docs/demos/drift-analysis/README.md"
echo ""
echo "For the full automated analysis, run in Claude Code:"
echo "  /drift-check -c $COLLECTION"
echo ""
echo "For richer results with docs sites + GitHub activity:"
echo "  ./docs/demos/drift-analysis/run.sh --collection foc-upload-flow"
