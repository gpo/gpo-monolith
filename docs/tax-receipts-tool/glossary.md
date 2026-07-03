---
last-reviewed: 2026-06-08
review-interval-days: 180
---

# Glossary — Tax Receipts & Contributions

Domain terms used across the tool, the design doc, and Elections Ontario paperwork.
If a term in the code or docs is unfamiliar, it's probably here.

## Organizations & people

- **EO — Elections Ontario.** The **provincial** regulator. This is a provincial
  regime under the *Election Finances Act* — **not** the CRA / federal charitable
  receipting. All rules here are EO's.
- **GPO — Green Party of Ontario.** The party; also acts as the central agency that
  issues receipts on behalf of associations and takes the agency fee.
- **CA — Constituency Association.** A riding-level registered entity. CAs receive
  contributions and are the issuing entity on most receipts. Each maps to an EO
  **target entity** id.
- **CFO — Chief Financial Officer.** The person responsible for a CA's financial
  return. CFOs submit Tax Receipt Requests and file the AR-1. Vacant/unreachable
  CFOs are a recurring edge case.
- **Nomination contestant / candidate.** Other political entity types whose
  contributions count toward a donor's party-wide annual limit.

## Documents & filings

- **TRR — Tax Receipt Request.** A submission (today via a Drupal tool) in which a CA
  enters the contributions it received so receipts can be issued. Keyed by
  `tax_receipt_request_id`. The upstream intake for the whole process.
- **AR-1.** The annual financial return a CA files with EO, due **May 31** of the
  following year, accompanied by copies of all issued/cancelled/voided receipts.
- **S2P2.** Schedule 2, Part 2 — a contributions schedule within EO reporting.
- **CR-1 / CR-3.** EO **correction/query** forms — raised when EO finds a
  discrepancy (e.g. summary total ≠ filed return total) and the CA must respond.
- **Tax Receipt Summary.** A per-entity total the CA submits; must reconcile with
  the filed return and the sum of contributions (validation rule R2).

## Contribution & receipt concepts

- **Contribution.** A single donation. In the legacy system a CiviCRM
  `civicrm_contribution`; in the go-forward system a **Qomon transaction**. Carries
  amount, date, donor, and metadata.
- **Reporting period.** The EO period a contribution belongs to (e.g. annual vs a
  general-election period). A donor may have different addresses in different
  periods — receipts must use the correct period's address.
- **Target entity.** The EO political entity a contribution is attributed to
  (a specific CA / the party), identified by an EO entity id. Contributions are
  grouped by target entity (× event) for reporting.
- **Donation category.** Which entity type receives the contribution:
  party / association / candidate / agency.
- **Goods & Services (G&S).** A non-monetary contribution form. Donors may opt to
  exclude G&S aggregating ≤ $100/yr. Receipt must state monetary vs G&S.
- **Agency fee.** GPO retains **5%** of contributions made to CAs, transferred
  quarterly. Must reconcile in reporting (rule R5; AR-1 Schedule 2 auto-calcs it).
- **Receipt.** The issued tax receipt. Has a **sequential, continuous** receipt
  number (e.g. `GPO-00000001`), an issuing entity, acceptance + issuance dates, and
  donor name/address. Status: issued / cancelled / void / reissued.
- **Allocation.** The explicit link between a contribution and a receipt, carrying
  the amount of that contribution applied to that receipt. The mechanism that lets a
  contribution back **multiple** receipts **without double-counting** any dollar.
  (See `DESIGN.md` §5.)
- **Receivable.** A contribution paid in the next year (e.g. December) flagged for
  the correct period (rule R6).
- **NIL return.** A return with no cash/cheque contributions (e.g. monthlies only),
  which still must be confirmed/filed.

## Systems

- **CiviCRM.** Legacy CRM + contribution store. **Being decommissioned**; not a
  build target. Notably cannot attach two receipts to one contribution.
- **Qomon.** The new CRM / system of record (5-year contract). REST API; donations
  are "transactions". See `integrations.md`.
- **Warehouse.** GPO's **BigQuery + Superset** data warehouse — the reporting read
  layer the tool queries for contribution data.
- **Drupal TRR tool.** Upstream tool where CAs enter tax receipt requests. (Repo
  link pending — see `open-questions.md` O7.)
