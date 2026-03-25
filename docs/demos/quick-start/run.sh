#!/usr/bin/env bash
set -euo pipefail

# quick-start.sh — Local-first demo: 3 commands, no API key, local embeddings
#
# Usage:
#   ./docs/demos/quick-start/run.sh                       # full demo
#   ./docs/demos/quick-start/run.sh --skip-ingest          # query only (collection must exist)
#   ./docs/demos/quick-start/run.sh --embedder-url lmstudio --embedder-model mxbai-embed-large-v1
#
# See docs/demos/quick-start/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="wtfoc-quick-start"
EMBEDDER_ARGS=""
SKIP_INGEST=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--skip-ingest) SKIP_INGEST=true; shift ;;
		lmstudio) EMBEDDER_ARGS="--embedder-url lmstudio --embedder-model mxbai-embed-large-v1"; shift ;;
		--embedder-url|--embedder-model|--embedder-key|--embedder)
			EMBEDDER_ARGS="$EMBEDDER_ARGS $1 $2"; shift 2 ;;
		*) shift ;;
	esac
done

CLI="$REPO_ROOT/wtfoc"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  wtfoc — Quick Start                                ║"
echo "║  Three commands, no API key, local embeddings         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if [[ "$SKIP_INGEST" == "false" ]]; then
	echo "Step 1: Create a collection"
	echo "  \$ wtfoc init $COLLECTION --local"
	echo ""
	$CLI init "$COLLECTION" --local
	echo ""

	echo "Step 2: Ingest this repository"
	echo "  \$ wtfoc ingest repo SgtPooki/wtfoc -c $COLLECTION"
	echo ""
	$CLI ingest repo SgtPooki/wtfoc -c "$COLLECTION" $EMBEDDER_ARGS 2>&1 | grep -E "(chunks|Ingested|batches|Finished)" || true
	echo ""

	echo "Collection status:"
	$CLI status -c "$COLLECTION"
	echo ""
fi

echo "═══════════════════════════════════════════════════════"
echo "Step 3: Trace a question"
echo "  \$ wtfoc trace \"how does ingest work\" -c $COLLECTION"
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI trace "how does ingest work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "═══════════════════════════════════════════════════════"
echo "Bonus: Semantic search"
echo "  \$ wtfoc query \"embedder model\" -c $COLLECTION"
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI query "embedder model" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "═══════════════════════════════════════════════════════"
echo "Done! Three commands, zero API keys, local embeddings."
echo ""
echo "Next steps:"
echo "  ./wtfoc trace \"your question here\" -c $COLLECTION"
echo "  ./wtfoc serve -c $COLLECTION          # web UI at localhost:3577"
echo "  ./docs/demos/upload-flow-trace/run.sh  # cross-repo trace demo"
