# Open Questions, Risks & Dependencies

Living list. Update status as items close. `R` = risk, `O` = open question.
When an item is resolved, move the answer inline and mark it ✅.

| Ref | Item | Status | Action / mitigation |
|---|---|---|---|
| **R1** | Qomon **custom transaction fields don't exist yet** (committed H2 2026, "subject to change"). Blocks native metadata write-back in Phase 1. **Highest project risk.** | 🔴 Open | Store metadata in our Postgres (and/or encode in `campaign_code`) for now; reconcile into Qomon once fields ship. |
| **R2** | Qomon **raw Swagger** not yet delivered to GPO. Pagination, rate limits, transaction filter params, transaction tags, and the webhook event catalog are unconfirmed. | 🔴 Open | Obtain the Swagger from Qomon before Phase 0 build-out; it closes most Qomon unknowns at once. |
| **R3** | **Warehouse sync cadence** (real-time vs batch) is an open question in GPO's modernization plan. Affects freshness of contribution lists. | 🟡 Open | Confirm cadence; design polling/reads to tolerate lag. |
| **R4** | Qomon **in-kind / goods-vs-services** representation is unconfirmed. We need a reliable G&S flag for receipts. | 🟡 Open | Confirm native support; otherwise model G&S locally. |
| **R5** | **Migration timing** (late Jan 2027) leaves a tight window before the 2026 AR-1 deadline (May 31 2027). | 🟡 Open | Phase 5 must be ready to run immediately post-migration; validate during parallel run. |
| **O6** | EO **report logic & validation macros** are **inferred** — the authoritative 2025 master Google Sheet + bound Apps Script are **DLP-locked** from automated access. | 🟡 Open | A human must confirm the logic against the live sheet before Phase 4. |
| **O7** | The **Drupal Tax-Receipt-Request (TRR) tool** repo (upstream CA contribution intake) is **not yet linked / in scope**. | 🔴 Open | Add the repo to the session (`list_repos` → `add_repo`); then map its data model and how in-flight requests are stored, and fold into Phase 1 ingestion. |
| **O8** | Qomon **webhooks appear bespoke / in progress**; a self-serve new-donation push may not exist. | 🟢 Mitigated by design | Polling-primary; treat webhooks as an enhancement. |

## Notes

- **R1 is the pacing item for Phase 1.** Until H2 2026, "push metadata back to Qomon"
  has no native field target. Don't let this block Phase 1 — the interim Postgres
  store is the plan.
- **O6 + O7 are the two human/access dependencies.** O7 is the immediate blocker for
  fully specifying Phase 1 ingestion; O6 is the blocker for Phase 4.
- Cross-references: integration detail in `integrations.md`; regulatory detail in
  `compliance.md`; decisions in `decisions.md`; phases in `DESIGN.md` §7 and §11.
