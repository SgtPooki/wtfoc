#!/usr/bin/env bash
set -euo pipefail

# cross-source-question/run.sh — Ask a real question, get an evidence chain.
#
# Traces a concrete question across slack conversations, GitHub issues,
# PRs, PR comments, and source code on the flagship filoz-ecosystem-v12
# collection. Shows the full evidence trail, not just a retrieval list.
#
# Usage:
#   ./docs/demos/cross-source-question/run.sh                         # default: cs-4 chunking-bug question
#   ./docs/demos/cross-source-question/run.sh --alt dl-8              # PDP/proof-set alternate
#   ./docs/demos/cross-source-question/run.sh --question "custom ..." # any concrete question
#
# See README.md for the narrative.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

COLLECTION="filoz-ecosystem-2026-04-v12"
# The flagship v12 collection was embedded with baai/bge-base-en-v1.5 (768d).
# Querying it with the default 384d local embedder fails with a dimension
# mismatch. Pick one:
#   1. OPENROUTER_API_KEY set in env → use OpenRouter (same as `pnpm dogfood:flagship`)
#   2. LM Studio running with bge-base-en-v1.5 loaded
#   3. Pass your own --embedder-* flags (they will be forwarded to `wtfoc trace`)
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
	DEFAULT_EMBEDDER_ARGS="--embedder-url https://openrouter.ai/api/v1 --embedder-model baai/bge-base-en-v1.5 --embedder-key $OPENROUTER_API_KEY"
else
	DEFAULT_EMBEDDER_ARGS="--embedder-url lmstudio --embedder-model baai/bge-base-en-v1.5"
fi
EMBEDDER_ARGS="${WTFOC_EMBEDDER_ARGS:-$DEFAULT_EMBEDDER_ARGS}"

# cs-4 — measured baseline reaches 5 source types: slack, issue, PR, PR-comment, code.
QUESTION_CS4="What PRs fix bugs in the chunking code and which files did they touch?"
# dl-8 — Filecoin-flavored alternate, also 5 source types.
QUESTION_DL8="What recent pull requests changed PDP, proof set, or proof verification behavior?"

QUESTION="$QUESTION_CS4"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--alt)
			case "${2:-}" in
				cs-4) QUESTION="$QUESTION_CS4"; shift 2 ;;
				dl-8) QUESTION="$QUESTION_DL8"; shift 2 ;;
				*) echo "unknown alt: ${2:-}  (use cs-4 or dl-8)"; exit 2 ;;
			esac ;;
		--question) QUESTION="$2"; shift 2 ;;
		--collection) COLLECTION="$2"; shift 2 ;;
		--embedder-url|--embedder-model|--embedder-key|--embedder)
			EMBEDDER_ARGS="$EMBEDDER_ARGS $1 $2"; shift 2 ;;
		-h|--help)
			sed -n '3,14p' "$0"; exit 0 ;;
		*) echo "unknown arg: $1"; exit 2 ;;
	esac
done

CLI="$REPO_ROOT/wtfoc"

if ! $CLI collections 2>/dev/null | awk 'NR>2 {print $1}' | grep -qx "$COLLECTION"; then
	echo "error: collection '$COLLECTION' not on this machine."
	echo "this demo runs against the flagship v12 corpus. options:"
	echo "  1. pull it:   $CLI pull bafkreif5ezwktkpifmyvwh77cocskinjn7g5tho64t2clb2uzezmrhgzci"
	echo "  2. use --collection <name> with any locally-ingested collection"
	echo "  3. verify-cid demo (docs/demos/verify-cid/) works without a local collection"
	exit 1
fi

echo "╔══════════════════════════════════════════════════════╗"
echo "║  wtfoc — Ask a real question, get an evidence chain  ║"
echo "║  Slack → Issue → PR → PR comment → Code              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Collection: $COLLECTION"
echo "Question:   $QUESTION"
echo "Embedder:   $(echo "$EMBEDDER_ARGS" | sed -E 's/(--embedder-key )[^ ]+/\1***/')"
echo ""
echo "──────────────────────────────────────────"
echo "1) Evidence view — hops grouped by source type"
echo "──────────────────────────────────────────"
$CLI trace "$QUESTION" -c "$COLLECTION" --mode analytical --view evidence $EMBEDDER_ARGS

echo ""
echo "──────────────────────────────────────────"
echo "2) Lineage view — reconstructed chains"
echo "──────────────────────────────────────────"
$CLI trace "$QUESTION" -c "$COLLECTION" --mode analytical --view lineage $EMBEDDER_ARGS

echo ""
echo "──────────────────────────────────────────"
echo "3) Timeline view — chronological evidence"
echo "──────────────────────────────────────────"
$CLI trace "$QUESTION" -c "$COLLECTION" --mode analytical --view timeline $EMBEDDER_ARGS

echo ""
echo "Done. The answer is not one chunk — it is a walked trail across sources."
