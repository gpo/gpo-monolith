#!/usr/bin/env bash
# PostToolUse recorder for the doc-sync Stop hook.
#
# Appends each edited file (relative to the project root) to this turn's touch
# list. doc-sync-reminder.sh reads and clears that list when the turn ends.
# The list path MUST stay in sync with doc-sync-reminder.sh.
set -uo pipefail

proj="${CLAUDE_PROJECT_DIR:-.}"
list="${TMPDIR:-/tmp}/claude-doc-sync.$(printf '%s' "$proj" | tr -c 'A-Za-z0-9' '_').touched"

f=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -n "$f" ] || exit 0
case "$f" in "$proj"/*) f="${f#"$proj"/}" ;; esac   # store relative to project root
printf '%s\n' "$f" >> "$list"
exit 0
