---
name: doc-sync
description: Fold a code change into the area's memory docs. Use when the Doc Sync PR check fails, or proactively after changing behaviour in an area listed in docs/doc-map.tsv.
---

# doc-sync: fold a code change into shared memory

The repo's docs are shared memory for humans and agents (see `docs/README.md`).
This skill is the write path: after changing code in a mapped area, capture
what a future session would otherwise have to rediscover.

## Steps

1. **Find the affected docs.** Match the files you changed against
   `docs/doc-map.tsv`. The third column hints at which doc(s) in the area
   usually need the update.
2. **Decide what is worth capturing.** Ask: what did this change teach or
   decide that is not obvious from the code itself? Capture durable facts only:
   - behaviour or interface changes, and new constraints or invariants;
   - decisions made (and rejected alternatives, briefly);
   - external facts learned (API quirks, regulatory rules, vendor
     commitments), each dated ("as of 2026-06") with its source;
   - open questions resolved, or new risks discovered.
   A pure refactor with no behaviour change usually needs no doc edit; in that
   case stop here and say so.
3. **Route each fact to the right doc.** For the tax-receipts area
   (`docs/tax-receipts-tool/`):
   - mechanisms, constraints, invariants, decisions and their why, Qomon or
     warehouse facts, and Elections Ontario rules as the code applies them →
     `architecture.md`, in the section for that area;
   - anything a user would notice → the matching page in `user-guide/`;
   - web list-screen conventions → `ui-patterns.md`;
   - risks and unknowns → a GitHub issue, linked from the doc if a reader
     needs to know.
   Elections Ontario rules come from EO's own published requirements; cite
   the source and date. Keep confidential material out: this repo is public.
4. **Edit surgically.** Update or delete the sentences the change invalidates;
   add the new facts where a reader would look for them. Do not append
   changelog-style notes to the bottom of a doc.
5. **Contradictions are decisions, not edits.** If your change conflicts with
   a documented decision or a hard rule in `CLAUDE.md`, do not silently
   rewrite it. Flag the conflict in your reply; documented decisions only
   change with explicit sign-off.
6. **Leave `last-reviewed` alone.** A targeted sync is not a full review; only
   the doc-review skill bumps the frontmatter.
7. **Commit docs with the code.** Doc edits ride in the same commit or PR as
   the change they describe, so review covers both together. This is what the
   Doc Sync PR check verifies; if a change genuinely has no doc impact, the
   `docs-not-needed` label on the PR skips the check.

## Writing conventions

Concise and factual, Canadian spelling, Oxford comma, no em-dashes, no
horizontal rule directly above a header, text-based formats only (Markdown,
Mermaid, CSV/TSV). Write for a reader with zero session context. Link on
first mention: the first time you name a domain term, a decision, or another
doc's subject, link its doc (repo-relative paths); once per doc is enough. Date
external facts: a claim about an external system, vendor, or rule carries an
as-of date ("as of 2026-06") and its source; re-verifying against the source
refreshes the date.
