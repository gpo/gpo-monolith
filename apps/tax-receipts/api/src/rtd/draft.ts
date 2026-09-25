import {
  attachRtdClock,
  buildRtdDraftRows,
  contributionYear,
  BusinessDayClock,
  type RtdCandidateContribution,
  type RtdDraftRowWithClock,
} from '@gpo/tax-receipts-core';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * RTD draft builder, DB-backed (ticket 2.2). Wires
 * `@gpo/tax-receipts-core`'s row-inclusion/aggregate logic
 * (`packages/tax-receipts-core/src/rtd/draft.ts`) to the mirror: pulls this
 * year's still-monetary, party-directed, valid contributions, builds the
 * candidate rows, attaches the ticket 0.10 business-day clock, and attaches
 * the RTD gate's open findings per row (eo-reporting.md §1: "RTD export runs
 * rules A1, C4, B1, B2, E2 on candidate rows" — E2 excluded here; it only
 * fires on an edit to an ALREADY-reported row, and ticket 2.3 hasn't shipped
 * the stamping write path that would make a row "already reported" yet).
 *
 * Nothing here writes: no `RtdInclusion` row, no `RtdFiling`, no artifact.
 * This is read-only, matching screens.md screen 9's "draft builder" step,
 * which sits before the stamp (ticket 2.3) and export (a later ticket)
 * steps.
 */

/** The RTD gate's rule refs (eo-reporting.md §1), minus E2 — see this
 *  file's header comment for why E2 doesn't apply to a fresh draft. These
 *  rules already run at intake/edit/nightly (ticket 1.7/2.1's registry) and
 *  open a `WorkItem` on failure, so the gate here queries those open items
 *  rather than re-running the checks live — the same choice
 *  `space/issuance.ts`'s `getSpaceIssuanceGate` makes for the issuance
 *  gate. */
export const RTD_GATE_RULE_REFS = ['A1', 'C4', 'B1', 'B2'] as const;

export interface RtdGateFinding {
  workItemId: string;
  ruleRef: string;
}

/** Open A1/C4/B1/B2 work items for the given contributions, keyed by
 *  contribution id. Empty for a contribution with nothing open. */
export async function getRtdGateFindings(
  prisma: PrismaClient,
  contributionIds: readonly string[],
): Promise<Map<string, RtdGateFinding[]>> {
  const byContribution = new Map<string, RtdGateFinding[]>();
  if (contributionIds.length === 0) return byContribution;

  const items = await prisma.workItem.findMany({
    where: {
      status: 'OPEN',
      subjectType: 'Contribution',
      subjectId: { in: [...contributionIds] },
      ruleRef: { in: [...RTD_GATE_RULE_REFS] },
    },
    orderBy: [{ ruleRef: 'asc' }, { openedAt: 'asc' }],
  });
  for (const item of items) {
    const list = byContribution.get(item.subjectId) ?? [];
    list.push({ workItemId: item.id, ruleRef: item.ruleRef! });
    byContribution.set(item.subjectId, list);
  }
  return byContribution;
}

/** Builds the ticket 0.10 business-day clock from every stored annual
 *  calendar. The table is small (one row per year); no year filter needed. */
export async function loadBusinessDayClock(prisma: PrismaClient): Promise<BusinessDayClock> {
  const calendars = await prisma.businessDayCalendar.findMany();
  return new BusinessDayClock(calendars);
}

export class RtdDraftMissingMetadataError extends Error {
  constructor(readonly contributionId: string) {
    super(
      `contribution ${contributionId} matched the RTD candidate query (party, monetary, valid) ` +
        'but has no period — this should be unreachable given the query filter',
    );
    this.name = 'RtdDraftMissingMetadataError';
  }
}

export interface RtdDraftEntry extends RtdDraftRowWithClock {
  contactName: string;
  contactFirstName: string;
  contactLastName: string;
  /** Contribution.periodId (rule A1's derivation, ticket 1.6). */
  periodId: number;
  /** Contribution.eoContributorId. Null in the common case — no
   *  ticket assigns it yet (open-questions.md O38); emitted as null rather
   *  than fabricated. */
  eoContributorId: string | null;
  /** Open RTD-gate findings on this contribution (see `RTD_GATE_RULE_REFS`).
   *  Non-blocking here — screen 9 shows these alongside the row rather than
   *  hiding it (screens.md screen 9); whatever ticket actually emits the
   *  filing is what enforces the block. */
  gateFindings: RtdGateFinding[];
}

export interface RtdDraft {
  year: number;
  asOf: Date;
  rows: RtdDraftEntry[];
}

export interface RtdDraftInput {
  /** the RTD calendar year to draft (eo-reporting.md §1's `<Year>` in the
   *  filing name) — evaluated in ET, matching `contributionYear`. */
  year: number;
  /** defaults to now; the instant the business-day clock is evaluated as
   *  of. */
  asOf?: Date;
}

export async function buildRtdDraft(prisma: PrismaClient, input: RtdDraftInput): Promise<RtdDraft> {
  const asOf = input.asOf ?? new Date();

  // Coarse UTC pre-filter with generous padding around the ET calendar-year
  // boundary (at most ~5 hours off UTC); `contributionYear` below does the
  // precise ET-based filter, so correctness never depends on this range.
  const rangeStart = new Date(Date.UTC(input.year - 1, 11, 25));
  const rangeEnd = new Date(Date.UTC(input.year + 1, 0, 7));

  const contributions = await prisma.contribution.findMany({
    where: {
      status: 'ACTIVE',
      // Only a landed deposit counts toward RTD disclosure — unpaid,
      // reimbursed, and bank-error payments never actually deposited
      // (open-questions.md O42: this filter isn't spelled out verbatim in
      // eo-reporting.md, flagged rather than assumed silently).
      payment: { state: 'RECEIVED' },
      acceptedAt: { gte: rangeStart, lt: rangeEnd },
      // RTD "covers monetary contributions to the central party only"
      // (eo-reporting.md §1): party-directed, and not goods & services.
      entityKind: 'PARTY',
      goodsServices: false,
      // a row with no period yet is still awaiting intake derivation and is
      // not a disclosure candidate (its PARTY is only the column default)
      periodId: { not: null },
    },
    include: { contact: true, rtdInclusions: { select: { id: true }, take: 1 } },
  });

  const inYear = contributions.filter((c) => contributionYear(c.acceptedAt) === input.year);

  const candidates: RtdCandidateContribution[] = inYear.map((c) => ({
    contributionId: c.id,
    contactId: c.contactId,
    amountCents: c.amountCents,
    acceptedAt: c.acceptedAt,
    alreadyReported: c.rtdInclusions.length > 0,
  }));

  const draftRows = buildRtdDraftRows(candidates);
  const clock = await loadBusinessDayClock(prisma);
  const withClock = attachRtdClock(draftRows, clock, asOf);

  const bySource = new Map(inYear.map((c) => [c.id, c]));
  const gateFindings = await getRtdGateFindings(
    prisma,
    withClock.map((r) => r.contributionId),
  );

  const rows: RtdDraftEntry[] = withClock.map((row) => {
    const source = bySource.get(row.contributionId);
    if (!source) throw new RtdDraftMissingMetadataError(row.contributionId);
    const periodId = source.periodId;
    if (periodId === null) throw new RtdDraftMissingMetadataError(row.contributionId);
    return {
      ...row,
      contactName: source.contact.name,
      contactFirstName: source.contact.firstName ?? '',
      contactLastName: source.contact.lastName ?? source.contact.name,
      periodId,
      eoContributorId: source.eoContributorId,
      gateFindings: gateFindings.get(row.contributionId) ?? [],
    };
  });

  return { year: input.year, asOf, rows };
}
