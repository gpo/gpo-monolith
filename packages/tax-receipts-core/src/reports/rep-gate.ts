import type { EntityKind } from '../enums.js';
import { contributionYear, periodContainsInstant, type PeriodRow } from '../period/calendar.js';
import { isEntityEligible, type RidingRow } from '../space/eligibility.js';

/**
 * The report-export gate (ticket 4.3): eo-reporting.md §2, "report export
 * runs REP2 to REP8; failures block export with named rows"
 * (validation-rules.md §REP). Reading each rule against what the tool can
 * actually check today:
 *
 *  - **REP1, REP3** are structural invariants enforced elsewhere (allocation
 *    sum, receipt-number uniqueness — `invariants/allocation.ts`,
 *    `invariants/sequence.ts`) and, per rules.ts's own header comment, are
 *    "tested at U2/U3 regardless of any story" — not re-checked here.
 *  - **REP7** (cancelled/void excluded from totals, retained as rows) and
 *    **REP8** (G&S included in the S2P2 aggregate) are structurally
 *    guaranteed by how the ALL and S2P2 generators are built on the same
 *    `load-receipts.ts` fetch (ticket 4.2's PHASE-4-NOTES.md) — there is no
 *    code path left that could violate either, so there is nothing this
 *    gate can independently catch that the generators themselves don't
 *    already guarantee by construction.
 *  - **REP5**'s first half ("agency flag consistent with `received_by`") is
 *    likewise structural: `Agency_Contribution` is *derived* from
 *    `received_by`/`entityKind` (`isAgencyContribution`, all-report.ts), so
 *    it cannot be inconsistent. Its second half (the 5% agency fee
 *    reconciling against transfers, recorded as `ReconciliationMark`
 *    transfer rows) has no data to check against yet — `ReconciliationMark`
 *    ingestion is tickets 4.7/4.8, not built. Tracked as open-questions.md
 *    O40, not faked here.
 *  - **REP2** ("per-entity contribution sum equals the entity's Tax Receipt
 *    Summary equals the filed return total") has no "Tax Receipt Summary" or
 *    "filed return total" modeled anywhere in the tool — those are external,
 *    human-prepared AR-1 artifacts (eo-reporting.md §3), not something the
 *    tool generates today. There is no second figure to reconcile the
 *    report against. Tracked as open-questions.md O40 alongside REP5.
 *  - **REP4** ("every reported contribution maps to a valid entity") and the
 *    period-window half of **REP6** ("acceptance date within reporting
 *    period") ARE independently checkable against data the tool already
 *    has, and are what this module actually implements as blocking checks.
 *  - **REP6**'s other half (acceptance in year N, deposit in year N+1
 *    "flagged receivable") is explicitly a *flag*, not a rejection — modeled
 *    here as a separate, non-blocking list.
 */

export interface RepGateSourceRow {
  receiptId: string;
  receiptNumber: string;
  entityKind: EntityKind;
  ridingNumber: number | null;
  periodId: number;
  acceptedAt: Date;
  /** Contribution.processedDate — the accounting/deposit date when
   *  it differs from acceptance (data-model.md §3). Null means no receivable
   *  signal is derivable, not that one was checked and cleared. */
  processedDate: Date | null;
}

export interface RepGateContext {
  periods: ReadonlyMap<number, PeriodRow>;
  ridings: ReadonlyMap<number, RidingRow>;
}

export interface RepGateFinding {
  ruleRef: 'REP4' | 'REP6';
  receiptId: string;
  receiptNumber: string;
  message: string;
}

export interface ReceivableFlag {
  receiptId: string;
  receiptNumber: string;
  acceptedYear: number;
  processedYear: number;
}

export interface RepGateResult {
  /** non-empty means export is blocked (eo-reporting.md §2). */
  findings: RepGateFinding[];
  /** informational only — never blocks (see REP6's doc comment above). */
  receivable: ReceivableFlag[];
}

export function runRepGate(sources: readonly RepGateSourceRow[], context: RepGateContext): RepGateResult {
  const findings: RepGateFinding[] = [];
  const receivable: ReceivableFlag[] = [];

  for (const source of sources) {
    const period = context.periods.get(source.periodId);
    const riding = source.ridingNumber !== null ? context.ridings.get(source.ridingNumber) : undefined;

    // REP4: every reported contribution maps to a valid entity.
    if (!isEntityEligible(source.entityKind, source.ridingNumber, period, riding)) {
      findings.push({
        ruleRef: 'REP4',
        receiptId: source.receiptId,
        receiptNumber: source.receiptNumber,
        message:
          `${source.entityKind}` +
          (source.ridingNumber !== null ? ` (riding ${source.ridingNumber})` : '') +
          ` is not a valid EO entity for period ${source.periodId}`,
      });
    }

    // REP6 (period window): re-verify at export time, not just at intake
    // (rule A1) -- catches a period whose boundaries were edited after this
    // receipt was issued into it.
    if (period && !periodContainsInstant(period, source.acceptedAt)) {
      findings.push({
        ruleRef: 'REP6',
        receiptId: source.receiptId,
        receiptNumber: source.receiptNumber,
        message: `acceptance date ${source.acceptedAt.toISOString()} falls outside period ${period.id}'s window`,
      });
    }

    // REP6 (receivable flag): informational, not blocking.
    if (source.processedDate) {
      const acceptedYear = contributionYear(source.acceptedAt);
      const processedYear = contributionYear(source.processedDate);
      if (processedYear > acceptedYear) {
        receivable.push({
          receiptId: source.receiptId,
          receiptNumber: source.receiptNumber,
          acceptedYear,
          processedYear,
        });
      }
    }
  }

  return { findings, receivable };
}
