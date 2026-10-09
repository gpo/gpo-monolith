---
last-reviewed: 2026-10-06
review-interval-days: 30
---

# Current limitations

[Back to the guide](README.md)

What the tool does not do yet, as of 2026-10. Each entry says what to do in
the meantime. This page changes fastest; check it before relying on the
gap still being there.

## Getting data in

| Gap | Meanwhile |
|---|---|
| The Qomon import sweep does not run on a schedule. | A system administrator starts it (through the API, or the Dev tools page in development builds). |
| Contribution riding, entity kind, and received-by often cannot be worked out from Qomon data, so imports arrive with "Intake" items. | Confirm each in the [work queue](work-queue.md); bulk edit helps with batches. |
| A later edit to an imported transaction in Qomon is not applied; it opens a sync incident. | Decide case by case, and correct the contribution if needed. |
| Historical (CiviCRM) data is not loaded yet. | |

## Access

| Gap | Meanwhile |
|---|---|
| Riding grants (limiting a user to some ridings) cannot be set on the Users screen. | Set through the API. |
| Manually creating, or assigning, work items has no screen. | |

## Validation

| Gap | Meanwhile |
|---|---|
| Rules A9 (goods-and-services invoice) and B5 (payer name on a cheque) are not implemented. | Check these by hand. |
| Rule B4 (duplicate donor) matches on email only. The contributor form separately warns about the same name and postal code. | |

## Receipting and delivery

| Gap | Meanwhile |
|---|---|
| The issuance wizard issues one receipt per contribution; it does not consolidate a donor's contributions onto one receipt. | |
| Receipts issued outside the tool (EO stock, handwritten) can be recorded through the API only. | |
| The received-by label is typed in at issuance rather than coming from a registry of entity names (except leadership contestants). | Type it consistently; it prints on every receipt in the run. |
| The cover letter and email wording are typed in each time; there is no stored template. | Keep the agreed wording somewhere to paste from. |
| Print batches are in receipt-number order, not postal-code order. | |
| Deliveries are not logged on the donor's Qomon record (Qomon has no place for them). | The tool's change log and email log are the record. |

## Corrections

| Gap | Meanwhile |
|---|---|
| Cancellation notices and replacement receipts are not emailed automatically after a correction. | Send them by hand from the stored PDFs. |
| Splitting a receipt, and undoing a merge, are API-only. | |
| A DC-1A amendment has no button to produce it. | Generate it through the API (`POST /rtd/contributions/:id/dc1a`), then send it to EO and resolve the Owed to EO item. |
| A moved contribution gets its own new receipt rather than joining the new donor's existing one. | |

## Reporting and the space ladder

| Gap | Meanwhile |
|---|---|
| There is no reconciliation screen (matching contributions to deposits and transfers). | Reconcile outside the tool. |
| Only the *issued* and *delivered* stages move on their own; *queue-clear*, *reconciled*, *reported*, and *sent-to-cfo* do not. | Use the dashboard's open-flag count and the entity reports screen's statuses instead. |
| The dashboard has no RTD deadline column. | Deadlines are on the [RTD filings](rtd-filings.md) screen. |
| Combined (all-entities) ALL and S2P2 files cannot be generated from the screen. | |
| EO's contributor id is usually blank in the ALL, S2P2, and RTD files, as nothing populates it yet. | |
| RTD filings are emailed to EO by hand. | Download, email, then confirm sent. |
| The AR-1 annual return package is not built. | |
