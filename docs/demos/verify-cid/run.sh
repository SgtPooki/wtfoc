#!/usr/bin/env bash
set -euo pipefail

# verify-cid/run.sh — Verify a published wtfoc collection from a CID alone.
#
# The audience does not trust us. They trust the bits. Given a manifest CID,
# wtfoc fetches it from FOC, walks every segment + derived-edge-layer, and
# recomputes the content hashes. No local state required. No ingestion.
#
# Usage:
#   ./docs/demos/verify-cid/run.sh                  # default: published v12 CID
#   ./docs/demos/verify-cid/run.sh <manifest-cid>   # verify any CID
#
# See README.md for the narrative.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

# Published flagship CID (filoz-ecosystem-2026-04-v12). Verifies 37 segments
# + 3 derived-edge-layers. Wall time 15s-2min depending on gateway warmth.
DEFAULT_CID="bafkreif5ezwktkpifmyvwh77cocskinjn7g5tho64t2clb2uzezmrhgzci"
CID="${1:-$DEFAULT_CID}"

CLI="$REPO_ROOT/wtfoc"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  wtfoc — Verify a CID                                ║"
echo "║  Trust nothing. Recompute everything.                ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "CID:    $CID"
echo "Target: FOC (Filecoin Onchain Cloud) via verified-fetch"
echo "Budget: 15s warm / up to 2min cold (network-bound, 37 segments + 3 edge layers)"
echo ""
echo "What this does:"
echo "  1. Fetch the manifest from FOC by CID"
echo "  2. Validate manifest schema"
echo "  3. Walk every segment CID + derived-edge-layer CID"
echo "  4. Recompute sha256 on each fetched artifact"
echo "  5. Verify manifest↔artifact identity + chunk counts"
echo ""
echo "Exit codes:"
echo "  0  REMOTELY VERIFIED — bits match what the manifest claims"
echo "  1  UNVERIFIED (fetch) — network / gateway / missing artifact"
echo "  2  INCONSISTENT (content) — hash or schema mismatch; corrupted or tampered"
echo ""
echo "───────────────────────────────────────────────────────"
echo ""

time $CLI verify-collection --manifest-cid "$CID"

echo ""
echo "───────────────────────────────────────────────────────"
echo "Verified. You did not need us. The bits speak for themselves."
