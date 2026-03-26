#!/usr/bin/env bash
set -euo pipefail

# edge-extraction.sh — LLM edge extraction + materialization pipeline demo
#
# Usage:
#   ./docs/demos/edge-extraction/run.sh                                      # uses wtfoc-quick-start
#   ./docs/demos/edge-extraction/run.sh --collection my-collection           # custom collection
#   ./docs/demos/edge-extraction/run.sh --extractor-url http://localhost:8000/v1 --extractor-model qwen3-32b
#
# Prerequisites:
#   - An existing collection (run quick-start demo first)
#   - An OpenAI-compatible LLM endpoint (default: http://localhost:1234/v1 via LM Studio)
#
# See docs/demos/edge-extraction/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="wtfoc-quick-start"
EXTRACTOR_ARGS=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--collection|-c) COLLECTION="$2"; shift 2 ;;
		--extractor-url|--extractor-model|--extractor-key|--extractor-timeout|--extractor-concurrency)
			EXTRACTOR_ARGS="$EXTRACTOR_ARGS $1 $2"; shift 2 ;;
		*) shift ;;
	esac
done

# Default extractor if none specified
if [[ -z "$EXTRACTOR_ARGS" ]]; then
	EXTRACTOR_ARGS="--extractor-url http://localhost:1234/v1 --extractor-model default"
	echo "No --extractor-url specified. Defaulting to LM Studio at localhost:1234."
	echo "Start LM Studio with a model loaded, or pass --extractor-url and --extractor-model."
	echo ""
fi

CLI="$REPO_ROOT/wtfoc"

echo "================================================================"
echo "  wtfoc — LLM Edge Extraction Pipeline"
echo "  Collection: $COLLECTION"
echo "================================================================"
echo ""

# Step 1: Show current state
echo "Step 1: Current collection status"
echo "  \$ wtfoc status -c $COLLECTION"
$CLI status -c "$COLLECTION"
echo ""

# Step 2: Count edges before extraction
echo "Step 2: Edge count before LLM extraction"
BEFORE_EDGES=$($CLI trace "test" -c "$COLLECTION" --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats']['edgeHops'])" 2>/dev/null || echo "0")
echo "  Edge-based hops in a test trace: $BEFORE_EDGES"
echo ""

# Step 3: Run extract-edges
echo "================================================================"
echo "Step 3: Extract LLM edges"
echo "  \$ wtfoc extract-edges -c $COLLECTION $EXTRACTOR_ARGS"
echo "================================================================"
echo ""
$CLI extract-edges -c "$COLLECTION" $EXTRACTOR_ARGS 2>&1
echo ""

# Step 4: Show overlay status
echo "Step 4: Collection status with overlay"
$CLI status -c "$COLLECTION"
echo ""

# Step 5: Trace with overlay edges (runtime merge)
echo "================================================================"
echo "Step 5: Trace with overlay edges (runtime merge — no materialization needed)"
echo "  \$ wtfoc trace \"how does the ingest pipeline work\" -c $COLLECTION"
echo "================================================================"
echo ""
$CLI trace "how does the ingest pipeline work" -c "$COLLECTION" 2>&1
echo ""

# Step 6: Materialize
echo "================================================================"
echo "Step 6: Materialize overlay edges into segments"
echo "  \$ wtfoc materialize-edges -c $COLLECTION"
echo "================================================================"
echo ""
$CLI materialize-edges -c "$COLLECTION" 2>&1
echo ""

# Step 7: Final status
echo "Step 7: Final collection status (overlay cleared, edges in segments)"
$CLI status -c "$COLLECTION"
echo ""

echo "================================================================"
echo "Done! LLM edges are now baked into segments."
echo ""
echo "Next steps:"
echo "  wtfoc promote $COLLECTION         # Upload to Filecoin"
echo "  wtfoc serve -c $COLLECTION        # Web UI at localhost:3577"
echo "  wtfoc trace \"your question\" -c $COLLECTION"
echo ""
