#!/usr/bin/env bash
set -euo pipefail

# theme-discovery.sh — Discover semantic themes in a collection
#
# Usage:
#   ./docs/demos/theme-discovery/run.sh                                # uses wtfoc-quick-start collection
#   ./docs/demos/theme-discovery/run.sh --collection foc-upload-flow   # use a different collection
#
# Prerequisites: run the quick-start demo first to create the collection:
#   ./docs/demos/quick-start/run.sh
#
# This demo is contrived for speed — it runs clustering on an existing
# single-repo collection. For richer theme clusters across multiple repos
# and source types, use --collection with a larger pre-built collection.
#
# See docs/demos/theme-discovery/README.md for the full writeup.

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
echo "║  wtfoc — Theme Discovery                            ║"
echo "║  What is your engineering conversation actually about?║"
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
	echo "  ./docs/demos/theme-discovery/run.sh --collection <name>"
	exit 1
fi

echo "📦 Using collection: $COLLECTION"
$CLI status -c "$COLLECTION"
echo ""

# ─── Theme Discovery ────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "🎯 Theme Clusters"
echo "   Greedy cosine clustering over all embeddings"
echo "   No LLM needed — pure math, sub-second on a laptop"
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI themes -c "$COLLECTION" --limit 10 --exemplars 3
echo ""

echo "═══════════════════════════════════════════════════════"
echo "🔬 Fine-grained themes (lower threshold)"
echo "   More clusters, more specific topics"
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI themes -c "$COLLECTION" --threshold 0.80 --limit 10 --exemplars 2
echo ""

echo "═══════════════════════════════════════════════════════"
echo "✅ Theme discovery complete"
echo ""
echo "Collection: $COLLECTION"
echo "Full writeup: docs/demos/theme-discovery/README.md"
echo ""
echo "Try different thresholds:"
echo "  ./wtfoc themes -c $COLLECTION --threshold 0.90  # broad themes"
echo "  ./wtfoc themes -c $COLLECTION --threshold 0.75  # fine-grained"
echo "  ./wtfoc themes -c $COLLECTION --all             # show all clusters"
echo ""
echo "For richer themes across multiple repos and source types:"
echo "  ./docs/demos/theme-discovery/run.sh --collection foc-upload-flow"
