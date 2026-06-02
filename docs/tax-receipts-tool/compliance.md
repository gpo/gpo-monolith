# Elections Ontario Compliance Rules

The receipt regime is **provincial — Elections Ontario (EO)**, under the *Election
Finances Act*. It is **not** CRA / federal charitable receipting; don't apply CRA
rules. These constraints shape the data model and the issuance/reporting logic.

> Source: CFO Handbook for Constituency Associations + EO guidance. Confirm against
> the current handbook for any year-specific figure before relying on it.

## Who issues, what's due, when

- Receipts are issued by registered **Constituency Associations (CAs)** / the party.
- **AR-1** annual financial return is due to EO by **May 31** of the following year,
  accompanied by copies of **all issued, cancelled, and voided receipts**.
- **Audited** financial statements are required if the entity's activity is
  **≥ $10,000**.
- **Record retention: 6 years.**

## Receipt numbering & form

- Receipts must use **EO pre-numbered forms or an EO-approved electronic database.**
  (Building such a database is part of this tool's remit — confirm EO approval path.)
- Receipt numbers must be **sequential and continuous.** Reissues **continue** the
  sequence (they do not reuse the original number), e.g.
  `GPO-00321875 → GPO-00321876`.
- A receipt number, once allocated, is **never reused** — cancelling/voiding does
  not free it.

## Required receipt fields

- Contribution **acceptance date** and receipt **issuance date**.
- **Amount**, prefixed with `$`.
- **Form** of contribution: monetary vs **goods & services**.
- Donor **full name and address**.
- **Issuing CA**.
- **Authorized signature** — an **e-signature is acceptable**.

## Contribution limits & eligibility

- **2026 limit: $3,425 per person**, aggregated **party-wide** across all CAs and
  nomination contestants (the figure is **indexed yearly** — verify the current
  year's number).
- **No anonymous contributions.** Must be returned to the donor or remitted to EO.
- **Eligibility:** contributions must come from eligible Ontario sources. A donor who
  is **not a resident of Ontario** (e.g. moved out of province) is ineligible —
  post-move contributions must be **refunded** and receipts cancelled/reissued.
- **Goods & Services** aggregating **≤ $100/yr** may be excluded **at the donor's
  option**.

## Agency fee

- GPO takes a **5% agency fee** on contributions made to CAs, **transferred
  quarterly.**
- This must reconcile in reporting (validation rule **R5**); the AR-1 **Schedule 2**
  auto-calculates the 5% agency fee.

## Corrections, cancellations, voids

- **Voided receipts must be retained** (not destroyed) and submitted to EO.
- **Cancellations** require a cancellation notice/form filed with EO.
- You **cannot amend a prior-year return**; corrections discovered after filing are
  noted in the **current** year's return.
- Consequence for the tool: **never hard-delete**. Every correction is a
  cancel/void + reissue, captured in an append-only change-log. (See `DESIGN.md` §5
  and the invariants there.)

## Reconciliation expectations (what EO/auditors check)

These drive the automated validation rules in `DESIGN.md` §6 (R1–R8). The key ones:

- Per-entity contribution totals must equal the submitted **Tax Receipt Summary**,
  which must equal the **filed return** total (mismatches trigger a **CR-1** query).
- No contribution may be receipted twice.
- Only **issued** receipts are exported to entity reports; cancelled/void are
  excluded from totals but **retained** and submitted.
- Each donor's contributions are aggregated against the annual limit.
