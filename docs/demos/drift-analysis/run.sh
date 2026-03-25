#!/usr/bin/env bash
set -euo pipefail

# drift-analysis.sh — Build a collection for drift analysis, then run the check
#
# Usage:
#   ./docs/demos/drift-analysis/run.sh                                # full ingest + drift check
#   ./docs/demos/drift-analysis/run.sh --skip-ingest                  # drift check only (collection must exist)
#   ./docs/demos/drift-analysis/run.sh --collection foc-upload-flow   # use existing collection
#
# The drift check itself runs as a Claude Code skill (/drift-check).
# This script builds the collection and runs the prerequisite queries
# that demonstrate what drift-check does under the hood.
#
# See docs/demos/drift-analysis/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="drift-analysis-demo"
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
echo "║  wtfoc — Drift Analysis                             ║"
echo "║  Find stale docs and undocumented features           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if [[ "$SKIP_INGEST" == "false" ]]; then
	echo "📦 Creating collection with docs + GitHub sources..."
	echo "   (drift analysis needs both to compare against)"
	echo ""
	$CLI init "$COLLECTION" --local
	echo ""

	# ─── Documentation sites ─────────────────────────────────
	echo "🌐 Ingesting documentation sites..."
	echo ""
	for site in "https://docs.filecoin.cloud/" "https://filecoin.cloud/"; do
		echo "   → $site"
		$CLI ingest website "$site" -c "$COLLECTION" $EMBEDDER_ARGS 2>&1 | grep -E "(chunks|Ingested|Finished)" || true
		echo ""
	done

	# ─── GitHub activity ─────────────────────────────────────
	echo "🐙 Ingesting GitHub issues and PRs (last 90 days)..."
	echo ""
	for repo in "FilOzone/synapse-sdk" "filecoin-project/filecoin-pin" "filecoin-project/curio"; do
		echo "   → $repo"
		$CLI ingest github "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|Ingested)" || true
		echo ""
	done

	# ─── Source code ──────────────────────────────────────────
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

# ─── Drift Analysis: Under the Hood ─────────────────────
echo "═══════════════════════════════════════════════════════"
echo "🔬 Drift Analysis — Manual Steps"
echo "   (this is what /drift-check does automatically)"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "Step 1: Check collection has both docs and GitHub sources"
echo "────────────────────────────────────────────────────"
$CLI status -c "$COLLECTION"
echo ""

echo "Step 2: Find high-activity GitHub topics"
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
echo "  Trace: \"upload API changes and new options\""
$CLI trace "upload API changes and new options" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "  Trace: \"PDP proof verification storage provider\""
$CLI trace "PDP proof verification storage provider" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
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
echo "The skill runs these queries automatically, compares"
echo "GitHub activity against docs coverage, and produces a"
echo "structured report of stale docs and undocumented features."
