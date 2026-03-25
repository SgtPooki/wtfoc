#!/usr/bin/env bash
set -euo pipefail

# theme-discovery.sh — Discover semantic themes in a collection
#
# Usage:
#   ./docs/demos/theme-discovery/run.sh                       # full ingest + themes
#   ./docs/demos/theme-discovery/run.sh --skip-ingest          # themes only (collection must exist)
#   ./docs/demos/theme-discovery/run.sh --collection foc-upload-flow  # use existing collection
#
# See docs/demos/theme-discovery/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="theme-discovery-demo"
EMBEDDER_ARGS=""
SKIP_INGEST=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--skip-ingest) SKIP_INGEST=true; shift ;;
		--collection|-c) COLLECTION="$2"; SKIP_INGEST=true; shift 2 ;;
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

if [[ "$SKIP_INGEST" == "false" ]]; then
	echo "📦 Creating collection..."
	$CLI init "$COLLECTION" --local
	echo ""

	echo "🐙 Ingesting GitHub activity (last 90 days)..."
	echo ""
	for repo in "FilOzone/synapse-sdk" "filecoin-project/filecoin-pin" "filecoin-project/curio" "FilOzone/filecoin-services"; do
		echo "   → $repo"
		$CLI ingest github "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|Ingested)" || true
		echo ""
	done

	echo "📄 Ingesting source code..."
	echo ""
	for repo in "FilOzone/synapse-sdk" "filecoin-project/filecoin-pin"; do
		echo "   → $repo"
		$CLI ingest repo "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --batch-size 200 2>&1 | grep -E "(chunks|Ingested|batches)" || true
		echo ""
	done

	echo ""
	$CLI status -c "$COLLECTION"
	echo ""
fi

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
