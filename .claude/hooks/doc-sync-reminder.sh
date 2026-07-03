#!/usr/bin/env bash
# Stop hook: nudge to keep area docs in sync with code edited THIS turn.
#
# Pairs with record-edit.sh (a PostToolUse recorder) that lists the files the
# agent edited during the turn. At end of turn this hook reads that list: if a
# file in a watched area was edited but the area's doc was not, it blocks the
# stop once (exit 2) with a reminder. Stopping again proceeds.
#
# The area-to-doc rules live in docs/doc-map.tsv (the single source of truth,
# shared with CLAUDE.md and the doc-sync skill). Edit the map, not this hook,
# to change coverage. The list path MUST match record-edit.sh.
#
# A REMINDER, not a content check: it only knows whether a doc was touched.
set -uo pipefail

input=$(cat)
proj="${CLAUDE_PROJECT_DIR:-.}"
map="$proj/docs/doc-map.tsv"
list="${TMPDIR:-/tmp}/claude-doc-sync.$(printf '%s' "$proj" | tr -c 'A-Za-z0-9' '_').touched"

# Loop guard: if we already blocked once this turn, clear state and allow stop.
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  rm -f "$list"; exit 0
fi

# No map means nothing to enforce.
[ -f "$map" ] || exit 0

# Files edited this turn (recorded by record-edit.sh). None → nothing to check.
[ -f "$list" ] || exit 0
CHANGED=()
while IFS= read -r line; do [ -n "$line" ] && CHANGED+=("$line"); done < "$list"
rm -f "$list"
[ "${#CHANGED[@]}" -eq 0 ] && exit 0

# matches <glob> → true if any edited file matches the glob (case-pattern).
matches() {
  local p="$1" f
  for f in "${CHANGED[@]}"; do
    case "$f" in $p) return 0 ;; esac
  done
  return 1
}

# For each map rule (<code globs>\t<doc path/glob>\t<what to update>): a code
# glob was edited but its doc wasn't → collect a reminder.
reminders=()
while IFS=$'\t' read -r globs doc hint; do
  case "$globs" in ''|'#'*) continue ;; esac
  for g in $globs; do
    if matches "$g" && ! matches "$doc"; then
      reminders+=("$globs changed but $doc did not — update $hint.")
      break
    fi
  done
done < "$map"

if [ "${#reminders[@]}" -gt 0 ]; then
  {
    echo "Doc-maintenance check — you edited a watched area this turn without updating its doc:"
    for r in "${reminders[@]}"; do echo "  • $r"; done
    echo "The doc-sync skill (.claude/skills/doc-sync) gives a guided path: what belongs in which doc, and the writing conventions."
    echo "Update the doc(s) if behaviour changed. If they're already current (or this change doesn't affect them), stop again to proceed."
  } >&2
  exit 2
fi
exit 0
