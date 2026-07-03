#!/usr/bin/env bash
# SessionStart hook: surface overdue memory-doc reviews at the start of each
# session, so agents know what shared memory needs attention. Read-only; never
# blocks. See docs/README.md for the system this belongs to.
set -uo pipefail

proj="${CLAUDE_PROJECT_DIR:-.}"
checker="$proj/scripts/check-doc-freshness.sh"
[ -f "$checker" ] || exit 0

out=$(bash "$checker" 2>/dev/null)
if [ -n "$out" ]; then
  echo "Shared-memory freshness: these docs are past their scheduled review (see docs/README.md):"
  printf '%s\n' "$out" | sed 's/^/  /'
  echo "If reviewing one fits this session's scope, offer to run the doc-review skill; otherwise carry on."
fi
exit 0
