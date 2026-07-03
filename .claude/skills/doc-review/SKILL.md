---
name: doc-review
description: Run a scheduled freshness review of one memory doc against the current repo, then bump its last-reviewed date. Use when the SessionStart notice, the doc-freshness issue, or scripts/check-doc-freshness.sh reports a doc overdue, or when asked to review a doc.
---

# doc-review: verify a memory doc against reality

Memory docs decay: code moves on, vendors ship, rules change. A review walks
one doc claim by claim and either confirms, fixes, or flags each one, then
bumps `last-reviewed` so the freshness system knows it was done. See
`docs/README.md` for the system this belongs to.

## Steps

1. **Pick the doc.** If none was named, run `scripts/check-doc-freshness.sh`
   and take the most overdue one. Review one doc per pass; small and complete
   beats broad and shallow.
2. **Establish the doc's sources of truth.** From `docs/doc-map.tsv`, find the
   code areas the doc covers. Note which claims are verifiable from the repo
   and which rest on external sources (vendor docs, Elections Ontario
   guidance, Drive documents, Slack).
3. **Verify claim by claim.** For each factual claim, path, command, and
   cross-reference in the doc:
   - **confirmed** → leave it;
   - **stale** → fix it (repo-verifiable claims: check the code, run the
     command; do not guess);
   - **unverifiable from the repo** → leave it, but if it looks doubtful, add
     it to `open-questions.md` with what would confirm it.
4. **Look for the missing.** Scan the mapped code areas (and recent commits
   touching them, `git log --oneline -- <area>`) for things that exist but the
   doc does not mention. Add what a future reader would need.
5. **Reassess the cadence.** If the doc churned a lot, shorten
   `review-interval-days`; if it was all confirmed, consider lengthening.
   Adjust only with a reason, and say so in your reply.
6. **Bump the frontmatter.** Set `last-reviewed` to today (UTC). Do this even
   when nothing else changed: the review itself is the event being recorded.
7. **Commit and report.** Commit as `docs: review <doc>` describing what was
   confirmed, fixed, and flagged. If nothing changed, the commit is just the
   frontmatter bump. Deliver the fixed/flagged list in your reply.

## Writing conventions

Concise and factual, Canadian spelling, Oxford comma, no em-dashes, no
horizontal rule directly above a header, text-based formats only (Markdown,
Mermaid, CSV/TSV). Write for a reader with zero session context.
