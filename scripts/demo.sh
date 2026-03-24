#!/usr/bin/env bash
set -euo pipefail

# demo.sh — Full wtfoc demo with multi-source knowledge graph
#
# Usage:
#   ./scripts/demo.sh                    # ingest + demo with default embedder
#   ./scripts/demo.sh --embedder-url lmstudio --embedder-model mxbai-embed-large-v1
#   ./scripts/demo.sh --skip-ingest      # skip ingest, just run queries
#
# Prerequisites:
#   - Node >= 24, pnpm, pnpm build completed
#   - For LM Studio: running with an embedding model loaded

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="foc-ecosystem"
EMBEDDER_ARGS=""
SKIP_INGEST=false

# Parse args — pass all embedder flags through
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
echo "║  wtfoc — What the FOC happened? Trace it.           ║"
echo "║  Multi-source knowledge graph demo                   ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if [[ "$SKIP_INGEST" == "false" ]]; then
	# ─── Step 1: Init ────────────────────────────────────────
	echo "📦 Step 1: Create collection"
	rm -rf ~/.wtfoc
	$CLI init "$COLLECTION" --local
	echo ""

	# ─── Step 2: Ingest documentation sites ──────────────────
	echo "🌐 Step 2: Ingest documentation websites"
	echo ""

	SITES=(
		"https://docs.filecoin.cloud/"
		"https://filecoin.cloud/"
	)

	for site in "${SITES[@]}"; do
		echo "   → $site"
		if ! $CLI ingest website "$site" -c "$COLLECTION" $EMBEDDER_ARGS 2>&1 | grep -E "(chunks|edges|Ingested|Finished|Error)"; then
			echo "   ⚠️  Failed to ingest $site — continuing"
		fi
		echo ""
	done

	# ─── Step 3: Ingest GitHub repos ─────────────────────────
	echo "🐙 Step 3: Ingest GitHub issues, PRs, and discussions"
	echo ""

	REPOS=(
		# Core SDKs
		"FilOzone/synapse-sdk"
		"FIL-Builders/foc-cli"
		# Payment
		"FilOzone/filecoin-pay"
		# Infrastructure
		"FilOzone/filecoin-services"
		# Tools
		"FilOzone/pdp-explorer"
		"FilOzone/filecoin-nova"
	)

	for repo in "${REPOS[@]}"; do
		echo "   → $repo (github issues/PRs --since 90d)"
		if ! $CLI ingest github "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --since 90d 2>&1 | grep -E "(chunks|edges|Ingested|Error)"; then
			echo "   ⚠️  Failed to ingest $repo — continuing"
		fi
		echo ""
	done

	echo "📊 Collection status:"
	$CLI status -c "$COLLECTION"
	echo ""
fi

# ─── Step 4: Demo queries ────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "🔍 Demo: Cross-source trace and query"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "── Trace 1: How does Filecoin Pay work? ─────────────"
echo "   (should pull from docs + GitHub issues)"
echo ""
$CLI trace "how does Filecoin Pay work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "── Trace 2: Storage upload and PDP verification ─────"
echo "   (should connect docs concepts to SDK issues)"
echo ""
$CLI trace "storage upload PDP proof verification" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "── Query 3: Synapse SDK getting started ─────────────"
echo "   (should find docs pages + related GitHub activity)"
echo ""
$CLI query "synapse SDK getting started tutorial" -c "$COLLECTION" $EMBEDDER_ARGS -k 5 2>/dev/null
echo ""

echo "── Trace 4: Session keys and authorization ──────────"
echo "   (cross-source: docs explain it, issues discuss bugs)"
echo ""
$CLI trace "session keys authorization permissions" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "═══════════════════════════════════════════════════════"
echo "✅ Demo complete"
echo ""
echo "Sources ingested: documentation websites + GitHub repos"
echo "All chunks are content-addressed with source attribution."
echo "Swap embedders with --embedder-url lmstudio --embedder-model <model>"
echo ""
echo "Available source types: $(node -e "const{getAvailableSourceTypes}=require('./packages/ingest/dist/index.js');console.log(getAvailableSourceTypes().join(', '))")"
