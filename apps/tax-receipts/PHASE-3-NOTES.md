# Phase 3 — reviewer notes

Branch: `tax-receipts/phase-1` (Phase 3 work started ahead of Phase 1 landing,
by request — Phase 1 is otherwise unaffected). Same running-notes pattern as
[`PHASE-1-NOTES.md`](PHASE-1-NOTES.md).

## Ticket 3.1 — Individual receipt issuance

The first slice of receipting: one contribution -> one issued receipt, with
its PDF. Everything else Phase 3 implies (corrections/reissue, RTD filings,
entity reports, EO forms, consolidated multi-contribution receipts) is still
open.

| Where | What |
|---|---|
| `apps/tax-receipts/api/src/receipts/issue.ts` | `issueReceipt(deps, input)`. Checks the kill switch (`assertIssuanceEnabled`), loads the contribution + its metadata + contact, checks invariant 1 via `remainingEligibleCents` (`tax-receipts-core`), builds an `AddressSnapshot` from the contact's cached Qomon address, reserves the next `GPO-` sequence number, and writes `Receipt` + `ReceiptAllocation` in one `withChangeLog` transaction — same shape as `test/db.ts`'s existing `issueReceipt` fixture helper. Renders the PDF and links `pdfArtifactId` in a second change-logged update sharing the first write's `correlationId`. |
| `apps/tax-receipts/api/src/receipts/pdf.ts` | `renderReceiptPdf`: draws onto `assets/receipt-template.pdf` (copied from `scripts/generate_tax_receipt_pdfs/template.pdf`) using the same triplicate layout (office / donor / political-entity copies) as the legacy batch tool, so a tool-issued receipt matches what's already on file with EO. |
| `apps/tax-receipts/api/src/artifacts/store.ts` | `storeArtifact`: content-addressed (sha256) local-disk write + `Artifact` row. Stand-in for real object storage (no such ticket exists yet); `Artifact.uri` stays a storage-agnostic relative path so the swap needs no schema change. Directory from `ARTIFACT_STORAGE_DIR` (`env.ts`, default `./storage/artifacts`, gitignored). |
| `apps/tax-receipts/api/src/routes/receipts.ts` | `POST /contributions/:id/receipts` (CASL `issue Receipt` — party CFO or a CFO designate only, s. 25.1(6); sysadmin's `manage: all` deliberately does not cover this) and `GET /receipts/:id/pdf`. |
| `apps/tax-receipts/api/src/app.ts` | Registers `receiptRoutes`; maps `AllocationOverageError` (409), `ReceiptIssuanceValidationError` (400), `MissingAddressError` (422) alongside the existing `IssuanceDisabledError` (423) handling. |

Tests: `src/receipts/issue.test.ts` (happy path incl. PDF page count and
sequence/change-log side effects; kill switch; invariant-1 overage on one
shot and across two receipts against the same contribution; missing address;
unknown contribution; missing metadata), `src/routes/receipts.test.ts`
(auth, CASL 403 for administrator, happy path incl. PDF fetch, kill-switch
423). `pnpm turbo run lint typecheck test build` green.

### Deviations / judgment calls

1. **One contribution per receipt, this pass.** `ReceiptAllocation` is
   many-to-many by design (a receipt schema note reads "no `total` column -
   always derived from its allocations"), so consolidating several
   contributions onto one receipt is real and eventually needed. It's out of
   scope here: it raises questions this ticket has no basis to answer (whose
   accepted date prints? whose non-deductible amount governs a shared
   receipt?) that belong with the correction/consolidation workflow.
2. **`politicalEntityLabel` is a caller-supplied input, not derived.** The
   exact EO-facing wording for a CA/campaign/party "received by" line is a
   compliance.md question (private repo); guessing at legally-reviewed text
   felt like the wrong kind of shortcut. Whatever screen calls this route
   next should source the label from wherever that wording actually lives
   (an admin-configured per-entity name looks like the right shape, but that
   admin surface doesn't exist yet either).
3. **Address source is `Contact.addresses[0]` (the Qomon-synced address),
   not a donor-confirmed one.** `DonorCyclePreference.addressConfirmedAt`
   exists in the schema but nothing populates or checks it yet (no
   donor-precheck flow built). Rule B1 (out-of-province eligibility) is
   still unchecked, same open gap Phase 1 flagged (O34) — this only checks
   that *an* address exists, not that it's confirmed or in-province.
4. **Artifact storage is local disk**, gitignored under
   `apps/tax-receipts/api/storage/` by default. Fine for dev/test; a real
   deployment needs an actual object-storage ticket before this goes live,
   given the 6-year retention requirement on `Artifact` rows.
5. **No web UI.** This is API + PDF only, per the scoping conversation that
   started this ticket — the contribution-detail screen's "Allocations/
   receipts" panel is still the documented empty state until a UI ticket
   wires it to this route.
