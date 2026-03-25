#!/usr/bin/env bash
# Run Playwright tests with safe handling of macOS Chromium cleanup crash.
#
# On macOS, Chromium sometimes exits with SIGABRT (134) during process
# cleanup even when all tests pass. This script only forgives exit 134
# when the JSON report confirms zero test failures.
set -euo pipefail

REPORT_FILE="test-results/results.json"

# Run Playwright with JSON reporter alongside the default one
EXIT_CODE=0
PLAYWRIGHT_JSON_OUTPUT_NAME="$REPORT_FILE" npx playwright test --reporter=list,json 2>&1 || EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
  exit 0
fi

# Only forgive exit 134 (SIGABRT) on macOS when all tests passed
if [ "$EXIT_CODE" -eq 134 ] && [ "$(uname -s)" = "Darwin" ]; then
  if [ -f "$REPORT_FILE" ]; then
    # Check the JSON report for zero failures
    FAILED=$(node -e "
      const r = JSON.parse(require('fs').readFileSync('$REPORT_FILE', 'utf8'));
      const s = r.stats || r.suites?.[0]?.stats || {};
      console.log(s.unexpected || s.failed || 0);
    " 2>/dev/null || echo "unknown")

    if [ "$FAILED" = "0" ]; then
      echo "ℹ️  All tests passed; ignoring macOS Chromium cleanup crash (exit 134)"
      exit 0
    fi
  fi
fi

exit "$EXIT_CODE"
