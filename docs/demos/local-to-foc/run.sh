#!/usr/bin/env bash
set -euo pipefail

# local-to-foc.sh — Build locally, promote to Filecoin, share the CID
#
# Usage:
#   ./docs/demos/local-to-foc/run.sh                                # quick demo (~3 min)
#   ./docs/demos/local-to-foc/run.sh --collection foc-upload-flow   # promote existing collection
#   ./docs/demos/local-to-foc/run.sh --dry-run                      # show what would upload
#   ./docs/demos/local-to-foc/run.sh --skip-ingest                  # skip ingest, do promote
#
# Requires WTFOC_PRIVATE_KEY env var for the promote step.
# See docs/demos/local-to-foc/README.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="local-to-foc-demo"
EMBEDDER_ARGS=""
SKIP_INGEST=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
	case "$1" in
		--skip-ingest) SKIP_INGEST=true; shift ;;
		--dry-run) DRY_RUN=true; shift ;;
		--collection|-c) COLLECTION="$2"; SKIP_INGEST=true; shift 2 ;;
		lmstudio) EMBEDDER_ARGS="--embedder-url lmstudio --embedder-model mxbai-embed-large-v1"; shift ;;
		--embedder-url|--embedder-model|--embedder-key|--embedder)
			EMBEDDER_ARGS="$EMBEDDER_ARGS $1 $2"; shift 2 ;;
		*) shift ;;
	esac
done

CLI="$REPO_ROOT/wtfoc"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  wtfoc — Local to FOC                               ║"
echo "║  Build locally, promote to Filecoin, share the CID  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ─── Phase 1: Build locally ─────────────────────────────
if [[ "$SKIP_INGEST" == "false" ]]; then
	echo "Phase 1: Build locally"
	echo "────────────────────────────────────────────────────"
	echo ""

	echo "📦 Creating collection..."
	$CLI init "$COLLECTION" --local
	echo ""

	echo "📄 Ingesting source code..."
	echo "   → SgtPooki/wtfoc"
	$CLI ingest repo SgtPooki/wtfoc -c "$COLLECTION" $EMBEDDER_ARGS --batch-size 500 2>&1 | grep -E "(chunks|Ingested|batches|Finished)" || true
	echo ""

	echo "🐙 Ingesting GitHub activity (last 90 days)..."
	echo "   → SgtPooki/wtfoc"
	$CLI ingest github SgtPooki/wtfoc -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|Ingested)" || true
	echo ""
fi

# ─── Phase 2: Verify it works ───────────────────────────
echo "Phase 2: Verify the collection"
echo "────────────────────────────────────────────────────"
echo ""

$CLI status -c "$COLLECTION"
echo ""

echo "🔍 Quick trace test..."
$CLI trace "how does ingest work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "🎯 Quick themes test..."
$CLI themes -c "$COLLECTION" --limit 5 --exemplars 2
echo ""

# ─── Phase 3: Promote to Filecoin ───────────────────────
echo "Phase 3: Promote to Filecoin"
echo "────────────────────────────────────────────────────"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
	echo "🔍 Dry run — showing what would be uploaded..."
	echo ""
	$CLI promote "$COLLECTION" --dry-run
	echo ""
elif [[ -z "${WTFOC_PRIVATE_KEY:-}" ]]; then
	echo "⚠️  WTFOC_PRIVATE_KEY not set — skipping promote step."
	echo ""
	echo "To complete the demo, set your wallet private key:"
	echo "  export WTFOC_PRIVATE_KEY=0x..."
	echo ""
	echo "Then re-run with --skip-ingest to just promote:"
	echo "  ./docs/demos/local-to-foc/run.sh --collection $COLLECTION"
	echo ""
	echo "Or do a dry run to see what would be uploaded:"
	echo "  ./docs/demos/local-to-foc/run.sh --collection $COLLECTION --dry-run"
else
	echo "🚀 Promoting to Filecoin..."
	echo ""
	$CLI promote "$COLLECTION"
	echo ""

	echo "Phase 4: Verify on-chain"
	echo "────────────────────────────────────────────────────"
	echo ""
	echo "Run: ./wtfoc verify <carRootCid from above>"
	echo ""

	echo "Phase 5: Share the CID"
	echo "────────────────────────────────────────────────────"
	echo ""
	echo "Share the CAR root CID with anyone. They can load it in the web UI:"
	echo "  1. Open http://localhost:3577 (or the hosted app)"
	echo "  2. Paste the CID in 'Open by CID'"
	echo "  3. Query and trace — same results, decentralized storage"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "✅ Demo complete"
echo ""
echo "Collection: $COLLECTION"
echo "Full writeup: docs/demos/local-to-foc/README.md"
