# Phase 1 — Manual Test Plan

Companion to [`PHASE-1-NOTES.md`](PHASE-1-NOTES.md) (what was built, ticket
by ticket, and the judgment calls made). This is a walkthrough for a human
to actually click through and confirm things work, plus database checks to
confirm the data underneath is correct. Checkboxes are there so you can
track progress across a session; nothing here is graded, it's a guide.

PR: [gpo-monolith#99](https://github.com/gpo/gpo-monolith/pull/99).

## 0. Setup

```bash
nvm use                     # Node 22.13.1
corepack enable
pnpm install

# Postgres (same container the automated tests use)
pnpm db:test:up              # docker compose, Postgres on localhost:5433

cd apps/tax-receipts/api
cp .env.example .env
# edit .env if you have a Qomon sandbox key — see "With a Qomon sandbox key" below
set -a; source .env; set +a   # export the vars into this shell

pnpm exec prisma migrate deploy
pnpm db:seed                  # periods 63/64/67, 2026 limits, ESA holidays, kill switch, dev users
pnpm dev                      # Fastify on :3000
```

In a second terminal:

```bash
cd apps/tax-receipts/web
pnpm dev                      # Vite on :5173, proxies /api/* to :3000
```

Open `http://localhost:5173`. Dev login (from `prisma/seed.ts`), password
for all of them is `change-me-please-12345`:

| Email | Role |
|---|---|
| `sysadmin@gpo.test` | sysadmin — the only role that can write anything under Admin (1.12), or trigger the manual sync/validation routes |
| `cfo@gpo.test` | party_cfo |
| `admin@gpo.test` | administrator — can edit contribution metadata, work items |
| `rules@gpo.test` | rules_authority |
| `books@gpo.test` | bookkeeper |
| `filer@gpo.test` | filer, CFO designate |

### With a Qomon sandbox key

The fullest test needs live Qomon data flowing through the mirror sweep.
The sandbox key lives in the private `../qomon-test/.env` (gitignored, per
`PHASE-0-NOTES.md`) — ask the team if you don't have it. Put it in
`apps/tax-receipts/api/.env`:

```
QOMON_API_KEY="..."
QOMON_API_BASE="https://incoming.qomon.app"
```

With this set, `POST /internal/sync/sweep` and the write-through/refresh/
bulk-edit routes actually talk to Qomon. **Without it**, those routes return
`501` (by design — see `PHASE-1-NOTES.md` ticket 1.1/1.2), and the
mirror-sweep / write-through / bulk-edit sections below can't be exercised
end to end through the UI. You can still test everything else (list,
detail, work queue, dashboard, change-log, admin) against whatever's
already in the database — seed a contribution or two by hand (see
"Seeding data without a Qomon key" below) or ask someone who ran a sweep to
share a database dump.

If you use the sandbox, remember: contacts/bundles you create there are
real (if disposable) Qomon data — don't create anything you wouldn't want a
teammate to stumble on later.

### Seeding data without a Qomon key

`pnpm db:seed` only creates configuration (periods, limits, holidays, kill
switch, users) — no sample contributions. To get a contribution into the
mirror without Qomon, the cleanest path is a short throwaway script using
the app's own helpers (so invariant 5's change-log guard is satisfied):

```ts
// apps/tax-receipts/api/scratch-seed.ts (delete when done)
import { PrismaClient } from './src/generated/prisma/index.js';
import { withChangeLog } from './src/changelog/write.js';

const prisma = new PrismaClient();
const contact = await prisma.contact.create({
  data: { qomonContactId: 999001n, name: 'Test Donor', email: 'test@example.org' },
});
const contribution = await prisma.contribution.create({
  data: {
    contactId: contact.id,
    qomonTransactionId: 999001n,
    amountCents: 5_000,
    acceptedAt: new Date('2026-03-01T12:00:00Z'),
  },
});
await withChangeLog(prisma, { userId: null, reason: 'manual test seed' }, async (ctx) => {
  const after = await ctx.tx.contributionMetadata.create({
    data: { contributionId: contribution.id, periodId: 67, entityKind: 'CA', ridingNumber: 84, receivedBy: 'GPO' },
  });
  await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
});
await prisma.$disconnect();
```

```bash
pnpm exec tsx scratch-seed.ts
```

---

## 1. Auth + shell sanity (Phase 0, quick spot-check)

- [ ] Log in as `admin@gpo.test`. Nav bar shows Dashboard / Contributions /
      Work queue / Change-log / Admin / Sign in.
- [ ] Log out, confirm the app treats you as signed out (Dashboard shows
      "Not signed in").
- [ ] Log in with a wrong password — rejected, no session created.

## 2. Mirror sweep (1.1) — needs a Qomon key

- [ ] As `sysadmin@gpo.test`, `POST /internal/sync/sweep` (e.g. via `curl`
      with your session cookie, or a REST client). First call creates any
      new Qomon transactions as `Contribution` rows.
- [ ] As `admin@gpo.test`, hit the same route — expect `403`.
- [ ] In the Contributions list, confirm the new row(s) appear.
- [ ] **Database check**: for a newly-swept contribution,
      ```sql
      select id, "qomonTransactionId", "amountCents", "syncHash", "lastSyncedAt"
        from contribution order by "firstSeenAt" desc limit 5;
      select * from contribution_metadata where "contributionId" = '<id>';
      select kind, "ruleRef", status from work_item where "subjectId" = '<id>';
      ```
      A brand-new contribution should have **1–4 `VALIDATION` work items
      with `ruleRef` like `INTAKE:riding_number`, `INTAKE:entity_kind`,
      `INTAKE:received_by`** (and `INTAKE:period_id` if no period covers its
      date) — this is expected, not a bug: ticket 1.6's derivation is a
      stub for anything B3/B8-blocked. See "Known non-issues" below.
- [ ] Re-run the sweep with nothing new in Qomon — `pulled: 0` in the
      response, no new rows, no duplicate work items.
- [ ] **Database check**: `select * from sync_cursor;` — one row, `since`
      should have advanced after each sweep that found something.
- [ ] Deletion detection: this needs a *full* sweep (`{"mode":"full"}` in
      the POST body) and a transaction actually removed from Qomon —
      awkward to stage in a shared sandbox; skip unless you have a
      disposable bundle to delete.

## 3. Intake derivation (1.6)

- [ ] If you can create a Qomon transaction with a **directed** source
      code (`code_campaign` ending in a zero-padded riding number, e.g.
      `TSF.W.007`), sweep it and confirm `contribution_metadata.ridingNumber`
      is set **without** an `INTAKE:riding_number` work item.
- [ ] A transaction with an **undirected** code (or none) should land with
      `ridingNumber = null`, `entityKind = 'PARTY'`, flagged.

## 4. Validation engine (1.7)

- [ ] Seed or sweep a contribution with `paymentMethodKind: 'cash'` and
      `amountCents > 2500` — expect a `VALIDATION` work item, `ruleRef: 'A8'`.
- [ ] In Work queue, resolve it with a note — confirm it moves to
      `RESOLVED` and disappears from the OPEN view.
- [ ] **Database check**:
      ```sql
      select subject_type, subject_id, reason, "actorUserId", at
        from change_log_entry where "subjectType" = 'WorkItem' order by at desc limit 5;
      ```
      Every resolve/except should have written exactly one entry, with a
      non-empty `reason`.
- [ ] As `sysadmin@gpo.test`, `POST /internal/validation/run` — re-runs the
      full registry. Response reports `opened` / `reopened` / `resolved`
      counts.

## 5. Contributions list + bulk edit (1.3, 1.4)

Filtering, saving filters, and the column picker need no Qomon key —
they're pure reads. **Actually applying a bulk edit does** (it writes
through to Qomon per row) — without a key you'll get a `501` on Apply,
which is expected, not a bug.

- [ ] Filter by donor name/email, period, riding, entity kind, amount
      range, date range, "has open validation findings", "has an issued
      receipt" (this last one will always show "none" — no receipts exist
      until Phase 3).
- [ ] Save a filter, reload the page, confirm it's still in the "load a
      saved filter" dropdown. **This is a `localStorage` feature, per-browser** —
      it won't show up for a teammate or in a different browser.
- [ ] Hide a column via "Columns", reload — the hidden column stays hidden
      (also `localStorage`).
- [ ] Select 2+ rows, bulk-edit one field (e.g. Period id) with a reason,
      apply. Confirm the result banner (`N succeeded, N failed`) and that
      the rows update in place.
- [ ] **Database check**: one `change_log_entry` per row, same reason text,
      distinct `id`s but check they share nothing that would suggest a
      single row got double-counted:
      ```sql
      select "subjectId", reason, count(*) from change_log_entry
        where "subjectType" = 'ContributionMetadata' and reason = '<your reason text>'
        group by "subjectId", reason;
      ```
      Expect count = 1 per contribution you selected.
- [ ] Try a bulk edit that includes one bad row (e.g. a contribution with
      no metadata yet, or — if you can stage it — a receipted one) mixed
      with a good one. Confirm partial success: the good row updates, the
      bad one reports its own error and stays selected.

## 6. Contribution detail (1.5)

Viewing a contribution needs no Qomon key. **Saving a metadata edit and
"Refresh from Qomon" both do** — without a key, Save returns `501` (the
form will show whatever error message bubbles up) and the refresh button
will too. Expected, not a bug.

- [ ] Click a donor name in the list — lands on `/contributions/<id>`.
- [ ] Edit a metadata field, type a reason under 3 characters — Save button
      stays disabled. Type a real reason, Save — confirm the page refreshes
      with the new value and a new change-log entry appears at the bottom.
- [ ] Click "Refresh from Qomon" (needs a Qomon key) — confirm `lastSyncedAt`
      updates. If the underlying Qomon transaction hasn't changed, nothing
      else should move.
- [ ] Allocations/receipts, RTD inclusions panels will be empty for every
      contribution — expected, Phase 3/2 don't exist yet.

## 7. Work queue (1.8)

- [ ] Switch between the four tabs (Validation, Diff queue, Owed to EO,
      Sync incidents). **Diff queue and Owed to EO will be empty** — nothing
      in Phase 1 creates those (Owed to EO is Phase 2; Diff needs a
      receipted contribution to change in Qomon, which needs Phase 3).
      Sync incidents populate only from a full sweep's deletion detection.
- [ ] Resolve vs. except an item — confirm both work, and that the
      resolution note shows in the row afterward.
- [ ] Confirm the "Subject" link jumps to the right contribution detail
      page.

## 8. Space dashboard (1.10)

- [ ] After sweeping/seeding at least one contribution, `/` shows a grid
      row for its (period, riding, entity kind).
- [ ] Click the period cell — lands on Contributions, pre-filtered to that
      exact space (check the filter form shows the right period/riding/
      entity kind already filled in).
- [ ] Open flags count should match what you saw in Work queue for that
      space's contributions.
- [ ] There is **no RTD-deadline column** — flagged as a known gap
      (Phase 2 hasn't built the per-space due-date computation yet).
- [ ] With zero contributions in the database, `/` shows "No spaces yet".

## 9. Change-log explorer (1.11)

- [ ] Filter by subject type, subject id, actor, correlation id, and a
      date range — confirm each narrows the results.
- [ ] Click "Export CSV (for EO)" — a file downloads. Open it in a
      spreadsheet: header row `at,subjectType,subjectId,actor,reason,
      correlationId,before,after`; commas inside a reason/JSON cell should
      stay inside one cell (quoting works), not split into extra columns.
- [ ] Pick one entry and eyeball its `before`/`after` JSON against what you
      know actually changed — this is the audit trail EO will be shown, so
      it's worth actually reading a few rows rather than just checking the
      count.

## 10. Admin (1.12)

All of this section requires `sysadmin@gpo.test`; log in as
`admin@gpo.test` first and confirm every write attempt below 403s, then
switch users for the rest.

- [ ] **Periods**: create a period (pick an id you don't mind having in the
      database, e.g. `9001`), confirm it appears in the table. Edit an
      existing period's bounds — response includes a `revalidation` object;
      cross-check its `opened`/`resolved` counts against what you'd expect
      (did any contribution's acceptance date fall outside the new
      window?).
- [ ] **Contribution limits**: add a bucket for a test year, confirm it
      shows, then remove it — confirm it's gone from both the table and
      the database (`contribution_limit` allows a real delete, unlike
      most of this schema — see `PHASE-1-NOTES.md` ticket 1.12 for why).
- [ ] **RTD holidays**: add/edit a year's holiday list, confirm the table
      updates.
- [ ] **Users**: create a user with a 12+ character password, confirm they
      can log in with it in a private/incognito window. Toggle another
      user's "Active" checkbox off — confirm that user can no longer log
      in.
- [ ] **Kill switch**: engage it with a reason, confirm the badge flips to
      "ENGAGED"; disengage it. **Database check**:
      ```sql
      select * from change_log_entry where "subjectType" = 'IssuanceKillSwitch' order by at desc;
      ```
      Every engage/disengage should be logged with your reason.
- [ ] Confirm there's **no receipt-template editor and no RTD "CFO name" /
      threshold field** anywhere in Admin — both are flagged as
      out-of-scope gaps, not missed clicks.

---

## Database sanity checklist (run whenever, good general health checks)

```sql
-- invariant 5 spot-check: this should FAIL (no app.correlation_id set).
-- Scoped to one row on purpose, in case the trigger doesn't fire as expected.
update contribution_metadata set "sourceCode" = 'should fail'
  where id = (select id from contribution_metadata limit 1);

-- append-only: this should FAIL too
delete from change_log_entry;

-- every change-log entry has a real reason (invariant 5, enforced in code not SQL)
select count(*) from change_log_entry where reason is null or trim(reason) = '';
-- expect 0

-- receipt sequence should be untouched — nothing issues receipts until Phase 3
select * from receipt_sequence;
-- expect counter = 402509

-- work items should never have status OPEN with a non-null closedAt, or vice versa
select * from work_item where (status = 'OPEN' and "closedAt" is not null)
                            or (status != 'OPEN' and "closedAt" is null);
-- expect 0 rows

-- contribution_metadata.checksum: null means "locally derived, never confirmed
-- against Qomon" (ticket 1.1/1.2's stub path); non-null means either Qomon
-- sourced it directly or a write-through/bulk-edit confirmed it
select checksum is null as unconfirmed, count(*) from contribution_metadata group by 1;

-- sync cursor: one row per feed (today, just "qomon-poll")
select * from sync_cursor;
```

Prisma Studio (`pnpm --filter @gpo/tax-receipts-api exec prisma studio`) is
the easiest way to just browse tables visually if you'd rather click
through than write SQL.

---

## Known non-issues (flagged already, don't file bugs)

Straight from `PHASE-1-NOTES.md` — if you hit one of these, it's expected:

- New contributions almost always carry 1–3 `INTAKE:*` work items (riding,
  entity kind, received-by) because ticket 1.6's real derivation rules are
  blocked on B3/B8 (Qomon subspace → riding mapping, the "directed-to"
  field). Only source-code-directed ridings and processor-record
  `received_by` are actually derived; everything else defaults and flags.
- Diff queue / Owed-to-EO tabs are empty (need Phase 3 / Phase 2).
- Allocations, receipts, RTD inclusions are empty everywhere (Phase 3 / 2).
- No RTD-deadline column on the dashboard (Phase 2).
- No receipt-letter-template editor or RTD CFO-name/threshold fields in
  Admin (no schema field exists for either yet — see ticket 1.12 notes).
- Saved filters and column visibility are per-browser (`localStorage`), not
  shared across users or devices.
- Bulk edit only lets you select rows you can see loaded on the page —
  there's no "select every row matching the filter" across pagination.
- Rule B1 (ineligible/out-of-province contributor) isn't checked — flagged
  as open question **O34** in the private spec repo, blocked on address
  data no ticket populates before Phase 3.
- Any write route (`PATCH`/`POST` under `/contributions`, `/work-items`,
  `/admin`, plus the sync/validation triggers) that needs Qomon returns
  `501` if `QOMON_API_KEY` isn't set.

## If something looks genuinely wrong

Re-run the automated suite first — it's the fastest way to tell "is this a
real regression" from "is this expected and I'm misreading it":

```bash
pnpm db:test:up
export DATABASE_URL="postgresql://gpo:gpo@localhost:5433/tax_receipts_test?schema=public"
pnpm turbo run lint typecheck test build
```

If that's green but the manual behaviour still looks wrong, it's likely a
gap between the spec and what got built (worth a note in
`PHASE-1-NOTES.md` or an open question) rather than a broken test — flag it
and we can dig in together.
