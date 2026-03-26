#!/usr/bin/env bash
set -euo pipefail

# full-stack.sh — Build the canonical wtfoc-source collection from scratch
#
# This script creates a reproducible collection from the wtfoc repo itself:
#   - Source code (repo adapter)
#   - GitHub issues + PRs (github adapter)
#   - LLM edge extraction + materialization
#   - Analytical trace dogfood
#
# Usage:
#   # With homelab Ollama (nomic-embed-text) + Claude proxy for extraction:
#   ./docs/demos/full-stack/run.sh \
#     --embedder-url ollama --embedder-model nomic-embed-text \
#     --extractor-url http://127.0.0.1:4523/v1 --extractor-model haiku
#
#   # With default local embedder (MiniLM), no LLM extraction:
#   ./docs/demos/full-stack/run.sh
#
#   # Skip ingest, just extract edges + trace:
#   ./docs/demos/full-stack/run.sh --skip-ingest \
#     --embedder-url ollama --embedder-model nomic-embed-text \
#     --extractor-url http://127.0.0.1:4523/v1 --extractor-model haiku
#
# The collection name includes the embedder model for traceability.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

EMBEDDER_ARGS=""
EXTRACTOR_ARGS=""
SKIP_INGEST=false
BATCH_SIZE=200
REPO="SgtPooki/wtfoc"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--skip-ingest) SKIP_INGEST=true; shift ;;
		--batch-size) BATCH_SIZE="$2"; shift 2 ;;
		--embedder-url|--embedder-model|--embedder-key|--embedder)
			EMBEDDER_ARGS="$EMBEDDER_ARGS $1 $2"; shift 2 ;;
		--extractor-url|--extractor-model|--extractor-key|--extractor-json-mode|--extractor-timeout|--extractor-concurrency)
			EXTRACTOR_ARGS="$EXTRACTOR_ARGS $1 $2"; shift 2 ;;
		*) echo "Unknown option: $1"; exit 1 ;;
	esac
done

# Derive collection name from embedder model (default: local MiniLM)
EMBEDDER_MODEL="minilm"
prev=""
for i in $EMBEDDER_ARGS; do
	if [[ "$prev" == "--embedder-model" ]]; then
		EMBEDDER_MODEL="$i"
		break
	fi
	prev="$i"
done
COLLECTION="wtfoc-source-${EMBEDDER_MODEL}"

WTFOC="node packages/cli/dist/cli.js"

echo "=== Building collection: $COLLECTION ==="
echo "    Repo:     $REPO"
echo "    Embedder: ${EMBEDDER_MODEL}"
echo "    Batch:    $BATCH_SIZE"
echo ""

if [[ "$SKIP_INGEST" == "false" ]]; then
	echo "--- [1/2] Ingest source code ---"
	$WTFOC ingest repo "$REPO" \
		-c "$COLLECTION" \
		--batch-size "$BATCH_SIZE" \
		$EMBEDDER_ARGS

	echo ""
	echo "--- [2/2] Ingest GitHub issues + PRs ---"
	$WTFOC ingest github "$REPO" \
		-c "$COLLECTION" \
		--since 180d \
		$EMBEDDER_ARGS

	echo ""
	echo "=== Ingest complete ==="
else
	echo "--- Skipping ingest (--skip-ingest) ---"
fi

echo ""
echo "--- Collection status ---"
$WTFOC status -c "$COLLECTION"

if [[ -n "$EXTRACTOR_ARGS" ]]; then
	echo ""
	echo "--- Extract edges ---"
	$WTFOC extract-edges -c "$COLLECTION" $EXTRACTOR_ARGS

	echo ""
	echo "--- Materialize edges ---"
	$WTFOC materialize-edges -c "$COLLECTION"
else
	echo ""
	echo "--- Skipping edge extraction (no --extractor-url provided) ---"
fi

echo ""
echo "--- Dogfood: analytical trace ---"
$WTFOC trace "what features should be prioritized for maximum impact" \
	-c "$COLLECTION" \
	--mode analytical \
	$EMBEDDER_ARGS

echo ""
echo "=== Done. Collection '$COLLECTION' is ready. ==="
