#!/usr/bin/env bash
set -euo pipefail

# gap-analysis.sh — Show what's missing from your collection
#
# Usage:
#   ./docs/demos/gap-analysis/run.sh                       # full ingest + analysis
#   ./docs/demos/gap-analysis/run.sh --skip-ingest          # analysis only (collection must exist)
#   ./docs/demos/gap-analysis/run.sh --collection foc-upload-flow  # use existing collection
#
# See docs/demos/gap-analysis/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="gap-analysis-demo"
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
echo "║  wtfoc — Gap Analysis                               ║"
echo "║  Your data tells you what's missing                  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if [[ "$SKIP_INGEST" == "false" ]]; then
	echo "📦 Creating collection with partial data..."
	echo "   (deliberately incomplete — that's the point)"
	echo ""
	$CLI init "$COLLECTION" --local
	echo ""

	# Ingest just the SDK — not the docs, not the SP code
	echo "📄 Ingesting only the SDK source code..."
	echo ""
	for repo in "FilOzone/synapse-sdk" "filecoin-project/filecoin-pin"; do
		echo "   → $repo"
		$CLI ingest repo "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --batch-size 200 2>&1 | grep -E "(chunks|Ingested|batches)" || true
		echo ""
	done

	echo "🐙 Ingesting GitHub issues (last 90 days)..."
	echo ""
	for repo in "FilOzone/synapse-sdk" "filecoin-project/filecoin-pin"; do
		echo "   → $repo"
		$CLI ingest github "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|Ingested)" || true
		echo ""
	done

	echo ""
	$CLI status -c "$COLLECTION"
	echo ""
fi

# ─── Gap Analysis ────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "🔍 Unresolved Edges"
echo "   References in your data that point outside the collection"
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI unresolved-edges -c "$COLLECTION" --limit 15
echo ""

echo "═══════════════════════════════════════════════════════"
echo "💡 Suggested Sources"
echo "   Repos and sites your data references but you haven't ingested"
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI suggest-sources -c "$COLLECTION" --limit 15
echo ""

echo "═══════════════════════════════════════════════════════"
echo "✅ Gap analysis complete"
echo ""
echo "Collection: $COLLECTION"
echo "Full writeup: docs/demos/gap-analysis/README.md"
echo ""
echo "The system found references to repos and docs you haven't ingested."
echo "Ingest the suggested sources to close the gaps:"
echo "  ./wtfoc ingest repo <suggested-repo> -c $COLLECTION"
echo "  ./wtfoc ingest website <suggested-url> -c $COLLECTION"
