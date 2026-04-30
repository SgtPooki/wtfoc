#!/usr/bin/env bash
# Uninstall the autoresearch nightly cron LaunchAgent.
# Maintainer-only. Leaves $HOME/.wtfoc/autoresearch/ state intact —
# only removes the plist + bootouts the agent. State files (runs.jsonl,
# regression dedupe markers, archived reports) are preserved so a
# subsequent re-install picks up where the previous one left off.

set -euo pipefail

LABEL="com.wtfoc.autoresearch.nightly"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || echo "not loaded"
rm -f "$TARGET"

echo "removed $TARGET"
echo "state preserved at $HOME/.wtfoc/autoresearch/"
