#!/usr/bin/env bash
# Stop hook: nudge to keep area docs in sync with code.
#
# Fires when the agent finishes a turn. If code in a "watched" area changed
# during this branch's work but the doc that documents that area did NOT, it
# blocks the stop once (exit 2) with a reminder. Stopping again proceeds.
#
# This is a REMINDER, not a content check: it can only tell that a doc was
# (not) touched, never that the edit was correct. Edit the map below to taste.
set -uo pipefail

input=$(cat)

# Prevent infinite loops: if we already blocked once this turn, let the stop go.
if command -v jq >/dev/null 2>&1; then
  active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false')
else
  if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    active=true
  else
    active=false
  fi
fi
[ "$active" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Best-effort base ref to compare the branch against.
base=""
for ref in origin/main origin/master main master; do
  if git rev-parse --verify --quiet "$ref" >/dev/null 2>&1; then base="$ref"; break; fi
done

# Union of: committed-vs-base, staged, unstaged, and untracked files.
CHANGED=()
while IFS= read -r line; do [ -n "$line" ] && CHANGED+=("$line"); done < <(
  {
    [ -n "$base" ] && git diff --name-only "$base"...HEAD 2>/dev/null
    git diff --name-only HEAD 2>/dev/null
    git diff --name-only --cached 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  } | sort -u
)
[ "${#CHANGED[@]}" -eq 0 ] && exit 0

# matches <glob>  → true if any changed file matches the glob (case-pattern).
matches() {
  local p="$1" f
  for f in "${CHANGED[@]}"; do
    case "$f" in $p) return 0 ;; esac
  done
  return 1
}

reminders=()

# ── Area → doc map ───────────────────────────────────────────────────────────
# Tax Receipts & Contributions tool ⇒ its knowledge base.
if matches "apps/tax-receipts/*" && ! matches "docs/tax-receipts-tool/*"; then
  reminders+=("apps/tax-receipts/ changed but no doc under docs/tax-receipts-tool/ did — check DESIGN.md / integrations.md / compliance.md / decisions.md / open-questions.md.")
fi
# ──────────────────────────────────────────────────────────────────────────────

if [ "${#reminders[@]}" -gt 0 ]; then
  {
    echo "Doc-maintenance check — code changed in a watched area without a matching doc update:"
    for r in "${reminders[@]}"; do echo "  • $r"; done
    echo "Update the doc(s) if behavior/decisions changed. If they're already current (or this change doesn't affect them), stop again to proceed."
  } >&2
  exit 2
fi
exit 0
