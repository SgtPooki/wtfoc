#!/usr/bin/env bash
set -euo pipefail

# gap-analysis.sh — Show what's missing from your collection
#
# Usage:
#   ./docs/demos/gap-analysis/run.sh                                # uses wtfoc-quick-start collection
#   ./docs/demos/gap-analysis/run.sh --collection foc-upload-flow   # use a different collection
#
# Prerequisites: run the quick-start demo first to create the collection:
#   ./docs/demos/quick-start/run.sh
#
# This demo is contrived for speed — it runs analysis on an existing
# single-repo collection. For richer results with more unresolved edges,
# use --collection with a larger pre-built collection (e.g., foc-upload-flow).
#
# See docs/demos/gap-analysis/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="wtfoc-quick-start"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--collection|-c) COLLECTION="$2"; shift 2 ;;
		*) shift ;;
	esac
done

CLI="$REPO_ROOT/wtfoc"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  wtfoc — Gap Analysis                               ║"
echo "║  Your data tells you what's missing                  ║"
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
	echo "  ./docs/demos/gap-analysis/run.sh --collection <name>"
	exit 1
fi

echo "📦 Using collection: $COLLECTION"
$CLI status -c "$COLLECTION"
echo ""

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
echo ""
echo "For richer results with more sources:"
echo "  ./docs/demos/gap-analysis/run.sh --collection foc-upload-flow"
