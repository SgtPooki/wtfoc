#!/usr/bin/env bash
# Install the autoresearch nightly cron as a launchd LaunchAgent.
# Maintainer-only. Idempotent — re-running rewrites the plist + reloads.
#
# Usage:
#   bash scripts/autoresearch/cron/install.sh
#
# After install:
#   launchctl list | grep com.wtfoc.autoresearch.nightly
#   tail -f ~/.wtfoc/autoresearch/cron-stderr.log
#
# To disable: bash scripts/autoresearch/cron/uninstall.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WRAPPER="$SCRIPT_DIR/run-nightly.sh"
TEMPLATE="$SCRIPT_DIR/com.wtfoc.autoresearch.nightly.plist.in"
LABEL="com.wtfoc.autoresearch.nightly"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET="$TARGET_DIR/$LABEL.plist"

if [ ! -x "$WRAPPER" ]; then
    chmod +x "$WRAPPER"
fi

mkdir -p "$TARGET_DIR" "$HOME/.wtfoc/autoresearch"

PNPM_DIR="$(dirname "$(command -v pnpm 2>/dev/null || echo /opt/homebrew/bin/pnpm)")"
NODE_DIR="$(dirname "$(command -v node 2>/dev/null || echo /opt/homebrew/bin/node)")"
GH_DIR="$(dirname "$(command -v gh 2>/dev/null || echo /opt/homebrew/bin/gh)")"
PATH_VALUE="$PNPM_DIR:$NODE_DIR:$GH_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Substitute placeholders. We use python for robust escaping.
python3 - "$TEMPLATE" "$WRAPPER" "$HOME" "$PATH_VALUE" "$REPO_ROOT" > "$TARGET" <<'PY'
import sys
template_path, wrapper, home, path_value, cwd = sys.argv[1:6]
with open(template_path) as f:
    body = f.read()
body = body.replace("@@WRAPPER@@", wrapper)
body = body.replace("@@HOME@@", home)
body = body.replace("@@PATH@@", path_value)
body = body.replace("@@CWD@@", cwd)
sys.stdout.write(body)
PY

echo "wrote $TARGET"

UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

# Bootout if previously loaded — ignore failure (fresh install).
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl enable "$DOMAIN/$LABEL"

echo
echo "installed and enabled."
echo "next scheduled run: 03:00 local."
echo "logs: $HOME/.wtfoc/autoresearch/cron-stderr.log"
echo "state: $HOME/.wtfoc/autoresearch/nightly-status.json"
echo
echo "to run on demand: launchctl kickstart -p $DOMAIN/$LABEL"
echo "to disable: bash scripts/autoresearch/cron/uninstall.sh"
