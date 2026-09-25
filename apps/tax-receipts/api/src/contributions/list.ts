import type { EntityKind, Prisma, PrismaClient, ReceivedBy } from '../generated/prisma/index.js';

/**
 * Contributions list query (ticket 1.3, screens.md 2 / PRD C1): server-side
 * filters on metadata, donor, amount, date, validation status, and receipt
 * state. Column selection and saved filters are client-side concerns (see
 * the web route) — this only assembles and runs the query.
 */

export interface ContributionListFilters {
  periodId?: number;
  /** `null` explicitly means "party-level only" (no riding). */
  ridingNumber?: number | null;
  entityKind?: EntityKind;
  receivedBy?: ReceivedBy;
  /** substring match against the donor's name or email, case-insensitive. */
  contactQuery?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
  acceptedFrom?: Date;
  acceptedTo?: Date;
  hasOpenValidation?: boolean;
  /** narrows to contributions with a specific OPEN validation ruleRef
   *  (e.g. "A2", "INTAKE:riding_number"); implies hasOpenValidation. */
  ruleRef?: string;
  hasReceipt?: boolean;
}

export interface ContributionListRow {
  id: string;
  /** null for manual and legacy-imported payments */
  qomonTransactionId: string | null;
  source: string;
  contactName: string;
  contactEmail: string | null;
  amountCents: number;
  currency: string;
  acceptedAt: string;
  paymentState: string;
  periodId: number | null;
  ridingNumber: number | null;
  entityKind: string | null;
  receivedBy: string | null;
  sourceCode: string | null;
  nonDeductibleCents: number | null;
  hasReceipt: boolean;
  openValidationCount: number;
  lastSyncedAt: string | null;
}

export interface ContributionListPage {
  data: ContributionListRow[];
  nextCursor: string | null;
}

export interface ListContributionsOptions {
  filters: ContributionListFilters;
  limit?: number;
  cursor?: string | null;
  /** per-riding access grant (auth/abilities.ts); `null` = unrestricted
   *  (central staff / sysadmin). Party-level rows (riding null) are always
   *  visible, matching `canSeeRiding`'s rule. */
  ridingScope: readonly number[] | null;
}

export async function listContributions(
  prisma: PrismaClient,
  opts: ListContributionsOptions,
): Promise<ContributionListPage> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const f = opts.filters;

  // The descriptive fields are columns with defaults, so a row that has no
  // period yet (awaiting intake derivation) would otherwise match a filter
  // on its default entity kind or received-by. Any such filter therefore
  // also requires a period, as the old metadata-row join implicitly did.
  const descriptiveWhere: Prisma.ContributionWhereInput = {};
  if (f.periodId !== undefined) descriptiveWhere.periodId = f.periodId;
  if (f.ridingNumber !== undefined) descriptiveWhere.ridingNumber = f.ridingNumber;
  if (f.entityKind) descriptiveWhere.entityKind = f.entityKind;
  if (f.receivedBy) descriptiveWhere.receivedBy = f.receivedBy;

  // superseded and refunded rows are history, not the working set (D12)
  const and: Prisma.ContributionWhereInput[] = [{ status: 'ACTIVE' }];
  if (Object.keys(descriptiveWhere).length > 0) and.push({ periodId: { not: null } }, descriptiveWhere);
  if (f.contactQuery) {
    and.push({
      contact: {
        OR: [
          { name: { contains: f.contactQuery, mode: 'insensitive' } },
          { email: { contains: f.contactQuery, mode: 'insensitive' } },
        ],
      },
    });
  }
  if (f.minAmountCents !== undefined) and.push({ amountCents: { gte: f.minAmountCents } });
  if (f.maxAmountCents !== undefined) and.push({ amountCents: { lte: f.maxAmountCents } });
  if (f.acceptedFrom) and.push({ acceptedAt: { gte: f.acceptedFrom } });
  if (f.acceptedTo) and.push({ acceptedAt: { lte: f.acceptedTo } });
  if (f.hasReceipt !== undefined) {
    and.push({
      allocations: f.hasReceipt
        ? { some: { receipt: { status: 'ISSUED' } } }
        : { none: { receipt: { status: 'ISSUED' } } },
    });
  }
  if (opts.ridingScope !== null) {
    and.push({
      // party-level rows (with a period) are visible to everyone; a row with
      // no period yet is not, matching the old "no metadata, no match"
      OR: [{ periodId: { not: null }, ridingNumber: null }, { ridingNumber: { in: [...opts.ridingScope] } }],
    });
  }

  // WorkItem has no Prisma relation to Contribution (subjectId is a loose
  // string — one table serves four subject types), so validation-status
  // filtering runs as a separate lookup rather than a nested relation filter.
  if (f.hasOpenValidation !== undefined || f.ruleRef) {
    const items = await prisma.workItem.findMany({
      where: {
        kind: 'VALIDATION',
        status: 'OPEN',
        subjectType: 'Contribution',
        ...(f.ruleRef ? { ruleRef: f.ruleRef } : {}),
      },
      select: { subjectId: true },
    });
    const ids = items.map((i) => i.subjectId);
    if (f.hasOpenValidation === false && !f.ruleRef) {
      and.push({ id: { notIn: ids } });
    } else {
      and.push({ id: { in: ids } });
    }
  }

  const where: Prisma.ContributionWhereInput = { AND: and };

  const rows = await prisma.contribution.findMany({
    where,
    include: {
      contact: true,
      payment: { include: { qomonLink: true } },
      allocations: { where: { receipt: { status: 'ISSUED' } }, select: { id: true } },
    },
    orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const counts =
    page.length > 0
      ? await prisma.workItem.groupBy({
          by: ['subjectId'],
          where: {
            kind: 'VALIDATION',
            status: 'OPEN',
            subjectType: 'Contribution',
            subjectId: { in: page.map((r) => r.id) },
          },
          _count: { _all: true },
        })
      : [];
  const countBySubject = new Map(counts.map((c) => [c.subjectId, c._count._all]));

  const data: ContributionListRow[] = page.map((r) => ({
    id: r.id,
    qomonTransactionId: r.payment.qomonLink ? r.payment.qomonLink.qomonTransactionId.toString() : null,
    source: r.payment.source,
    contactName: r.contact.name,
    contactEmail: r.contact.email,
    amountCents: r.amountCents,
    currency: r.payment.currency,
    acceptedAt: r.acceptedAt.toISOString(),
    paymentState: r.payment.state,
    // the descriptive fields read as null until a period resolves, not as
    // their column defaults
    periodId: r.periodId,
    ridingNumber: r.periodId === null ? null : r.ridingNumber,
    entityKind: r.periodId === null ? null : r.entityKind,
    receivedBy: r.periodId === null ? null : r.receivedBy,
    sourceCode: r.periodId === null ? null : r.sourceCode,
    nonDeductibleCents: r.periodId === null ? null : r.nonDeductibleCents,
    hasReceipt: r.allocations.length > 0,
    openValidationCount: countBySubject.get(r.id) ?? 0,
    lastSyncedAt: r.payment.qomonLink?.lastSyncedAt ? r.payment.qomonLink.lastSyncedAt.toISOString() : null,
  }));

  return { data, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
}
