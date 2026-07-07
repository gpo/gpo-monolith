#!/bin/bash
set -uo pipefail

# Only run this in Claude Code on the web / remote sandboxes. The container
# state is cached after this hook completes, so installs are one-time per
# environment build, not per session.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/gpoAutoTests"

# The Cypress binary download (download.cypress.io) is blocked in the
# sandbox, and the e2e suite targets staging.gpo.ca anyway. Install node
# deps for eslint/tsc only.
echo "==> npm install (gpoAutoTests, skipping Cypress binary)"
CYPRESS_INSTALL_BINARY=0 npm install || echo "!! npm install failed"

echo "==> session-start hook complete"
echo "    Validate spec changes with: cd gpoAutoTests && ./node_modules/.bin/eslint . && npx tsc --noEmit"
