#!/usr/bin/env bash
set -euo pipefail

# upload-flow-trace.sh — Trace the upload flow across the FOC stack
#
# Usage:
#   ./scripts/demo-upload-flow.sh                    # full ingest + traces
#   ./scripts/demo-upload-flow.sh --skip-ingest      # traces only (collection must exist)
#   ./scripts/demo-upload-flow.sh --embedder-url lmstudio --embedder-model mxbai-embed-large-v1
#
# See docs/demos/upload-flow-trace.md for the full writeup.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="foc-upload-flow"
EMBEDDER_ARGS=""
SKIP_INGEST=false
BATCH_SIZE=200

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
echo "║  wtfoc — Trace the Upload Flow                      ║"
echo "║  Mapping one feature across the entire FOC stack     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if [[ "$SKIP_INGEST" == "false" ]]; then
	echo "📦 Creating collection..."
	rm -rf ~/.wtfoc
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

	# ─── GitHub issues/PRs ───────────────────────────────────
	echo "🐙 Ingesting GitHub issues and PRs (last 90 days)..."
	echo ""
	for repo in "FilOzone/synapse-sdk" "filecoin-project/filecoin-pin" "filecoin-project/curio" "FilOzone/filecoin-services"; do
		echo "   → $repo"
		$CLI ingest github "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|Ingested)" || true
		echo ""
	done

	# ─── Source code ─────────────────────────────────────────
	echo "📄 Ingesting source code (batched for memory efficiency)..."
	echo ""
	for repo in "FilOzone/synapse-sdk" "filecoin-project/filecoin-pin" "filecoin-project/curio" "FilOzone/filecoin-services"; do
		echo "   → $repo"
		$CLI ingest repo "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --batch-size $BATCH_SIZE 2>&1 | grep -E "(chunks|Ingested|batches)" || true
		echo ""
	done

	echo ""
	$CLI status -c "$COLLECTION"
	echo ""
fi

# ─── Traces ──────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "🔍 Trace 1: The upload flow end-to-end"
echo "   \"How does a file get from user code to a storage provider?\""
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI trace "file upload flow from user to storage provider" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "═══════════════════════════════════════════════════════"
echo "🔍 Trace 2: SDK internals — StorageManager and PDP"
echo "   \"What code handles the upload and how does it talk to providers?\""
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI trace "StorageManager upload createContexts PDP" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "═══════════════════════════════════════════════════════"
echo "🔍 Trace 3: Storage provider side — after upload"
echo "   \"What happens once data reaches the SP?\""
echo "═══════════════════════════════════════════════════════"
echo ""
$CLI trace "what happens after upload reaches the storage provider curio PDP proof" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "═══════════════════════════════════════════════════════"
echo "✅ Demo complete"
echo ""
echo "Collection: $COLLECTION"
echo "Full writeup: docs/demos/upload-flow-trace.md"
echo ""
echo "Try your own traces:"
echo "  ./wtfoc trace \"your question here\" -c $COLLECTION"
