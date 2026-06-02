# Integrations — Qomon API & BigQuery Warehouse

The tool's only backends are **Qomon** (system of record) and the **BigQuery
warehouse** (reporting read layer). **No CiviCRM** (see `decisions.md` D2).

> Several Qomon specifics are unconfirmed because the public docs are JS-rendered and
> GPO is still awaiting the raw Swagger file. Items marked **⚠️ unconfirmed** must be
> verified against the Swagger before building against them. See `open-questions.md`.

## Qomon

### API basics
- **REST**, public API, full **CRUD** across resources, at no extra cost.
- **Auth:** API key as a **Bearer token** — `Authorization: Bearer <key>`. Keys are
  generated in the Qomon webapp under Settings.
- Two doc surfaces: legacy `developers.qomon.com` / `developers.qomon.app`, and a
  refreshed Swagger hub at `api.qomon.com/pages/v1/intro`. **The raw Swagger file is
  pending from Qomon.**
- ⚠️ **unconfirmed:** versioning, rate limits, pagination mechanism, base URL.

### Data model (financial)
- Resources: **Contacts, Actions, Users, Fundraising/Transactions.**
- A **transaction** = a donation **or** a membership, linked to one contact.
- Transaction fields: `amount`, `type` (donation/membership), `date`, `contact`,
  `payment_method` (cash/cheque/online), `status` (valid/refunded/unpaid),
  associated product (e.g. "Full Membership"), **`campaign_code`** (string, for
  source attribution).
- **Contacts** support custom fields, tags, and forms.
- ⚠️ **unconfirmed:** transaction query/filter params (by date/contact/campaign),
  whether **tags** apply to transactions, in-kind / goods-vs-services representation.

### 🔴 The custom-transaction-fields gap (top risk — R1)
- Qomon has **no custom fields on transactions today.**
- GPO's contract secures **custom transaction fields as a committed H2 2026
  deliverable** ("subject to change").
- The metadata Phase 1 needs to write back (reporting period, target entity, donation
  category, goods/services, receipt linkage) maps exactly to these not-yet-existing
  fields.
- **Interim approach:** store metadata in **our PostgreSQL** (and optionally encode
  into the `campaign_code` string), and reconcile into Qomon once the fields ship.
  This keeps Phase 1 unblocked. (See `DESIGN.md` Phase 1 + `open-questions.md` R1.)

### Sync
- Qomon supports **both webhooks and API polling**, and **recommends polling as the
  resilient primary**; webhooks for real-time.
- New-donation / contact-change webhooks appear **bespoke / in progress** (GPO is
  working with Qomon eng on a contact-change → BigQuery webhook). **Don't assume a
  self-serve webhook catalog.**
- **Design polling-first**, treat webhooks as an optimization.

## BigQuery warehouse

- The cross-system warehouse is **BigQuery + Superset.**
- It is the **READ LAYER for reporting** — the tax-receipt/EO tool reads donation
  data **from the warehouse**, not directly from Qomon, for lists and aggregation.
- Holds Qomon + CallHub + website + financial data + ~10 years of legacy history.
  Fed by both Qomon and (interim) CiviCRM.
- ⚠️ **unconfirmed:** sync cadence (real-time vs batch) is an open question in GPO's
  modernization plan (`open-questions.md` R3). Design reads to tolerate lag.

## Where each kind of data lives

| Data | Home |
|---|---|
| Contacts, transactions (system of record) | Qomon |
| Contribution lists / aggregates for reporting | BigQuery warehouse |
| Receipts, receipt numbers, allocations | **Our PostgreSQL** |
| Contribution metadata (interim, pre-H2-2026) | **Our PostgreSQL** → Qomon later |
| Change-log / audit trail (never deleted) | **Our PostgreSQL** |
| Upstream tax receipt requests (TRRs) | Drupal TRR tool (repo TBD — O7) |
