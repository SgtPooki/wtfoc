#!/usr/bin/env bash
set -euo pipefail

# demo.sh — Full wtfoc demo with real FOC ecosystem data
#
# Usage:
#   ./scripts/demo.sh                    # ingest + demo with default embedder
#   ./scripts/demo.sh --embedder lmstudio  # use LM Studio for better quality
#   ./scripts/demo.sh --skip-ingest      # skip ingest, just run queries
#
# Prerequisites:
#   - Node >= 24, pnpm
#   - For --embedder lmstudio: LM Studio running with an embedding model loaded

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="foc-ecosystem"
EMBEDDER_ARGS=""
SKIP_INGEST=false

# Parse args
for arg in "$@"; do
	case "$arg" in
		--embedder) shift; EMBEDDER_ARGS="--embedder $1"; shift ;;
		--embedder=*) EMBEDDER_ARGS="--embedder ${arg#*=}" ;;
		--skip-ingest) SKIP_INGEST=true ;;
		lmstudio) EMBEDDER_ARGS="--embedder lmstudio" ;;
		*) ;;
	esac
done

CLI="npx tsx packages/cli/src/cli.ts"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  wtfoc — What the FOC happened? Trace it.           ║"
echo "║  Decentralized knowledge tracing on FOC              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if [[ "$SKIP_INGEST" == "false" ]]; then
	# ─── Step 1: Init ────────────────────────────────────────
	echo "📦 Step 1: Create collection"
	rm -rf ~/.wtfoc
	$CLI init "$COLLECTION" --local
	echo ""

	# ─── Step 2: Ingest real repos ───────────────────────────
	echo "📥 Step 2: Ingest FOC ecosystem repos"
	echo ""

	REPOS=(
		"FIL-Builders/foc-cli"
		"filecoin-project/filecoin-pin"
		"FilOzone/synapse-sdk"
		"FilOzone/filecoin-pay"
		"FilOzone/filecoin-pay-explorer"
	)

	for repo in "${REPOS[@]}"; do
		echo "   → $repo"
		$CLI ingest repo "$repo" -c "$COLLECTION" $EMBEDDER_ARGS --quiet 2>&1 | grep -E "✅|⚠️|chunks|edges" || true
		echo ""
	done

	echo "📊 Collection status:"
	$CLI status -c "$COLLECTION"
	echo ""
fi

# ─── Step 3: Demo queries ────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "🔍 Demo: Trace and Query"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "── Query 1: How does file upload work? ──────────────"
echo ""
$CLI trace "how does file upload work" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "── Query 2: Payment and billing ─────────────────────"
echo ""
$CLI trace "payment billing USDFC deposit" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "── Query 3: Storage provider management ─────────────"
echo ""
$CLI query "storage provider dataset" -c "$COLLECTION" $EMBEDDER_ARGS -k 5 2>/dev/null
echo ""

echo "── Query 4: What is PDP? ────────────────────────────"
echo ""
$CLI trace "PDP proof data possession verification" -c "$COLLECTION" $EMBEDDER_ARGS 2>/dev/null
echo ""

echo "═══════════════════════════════════════════════════════"
echo "✅ Demo complete"
echo ""
echo "All results include source file paths and storage IDs."
echo "Every chunk is content-addressed and verifiable."
echo "Swap embedders with --embedder lmstudio for better quality."
