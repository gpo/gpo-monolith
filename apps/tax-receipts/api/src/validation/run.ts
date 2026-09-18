import {
  contributionYear,
  DUPLICATE_CONTRIBUTION_WINDOW_MS,
  runContributionRules,
  type ContributionForLimits,
  type DuplicateContactCandidate,
  type DuplicateContributionCandidate,
  type PeriodRow,
  type ValidationFinding,
} from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Validation engine v1 (ticket 1.7): assembles the DB-side context the pure
 * rule registry (`@gpo/tax-receipts-core`) needs, runs it, and reconciles
 * the findings against `WorkItem` rows — opening one per newly-failing
 * rule, reopening a RESOLVED or year-expired EXCEPTION item whose condition
 * re-appeared, and auto-resolving an OPEN item whose rule no longer fires.
 * One WorkItem row is kept per (contribution, ruleRef) over time rather than
 * accumulating duplicates release over release.
 *
 * Callers: the mirror sweep (1.1, on intake — after metadata is created or
 * backfilled) and the metadata write-through (1.2, on edit). A nightly full
 * pass is `runValidationForAllContributions` below.
 */

export interface ValidationRunResult {
  contributionId: string;
  findings: ValidationFinding[];
  opened: number;
  reopened: number;
  resolved: number;
}

export async function runValidationForContribution(
  prisma: PrismaClient,
  contributionId: string,
): Promise<ValidationRunResult | null> {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: { metadata: true, contact: true },
  });
  if (!contribution || !contribution.metadata) return null; // nothing to validate yet (1.1's intake flag covers this)

  const period = await prisma.period.findUnique({ where: { id: contribution.metadata.periodId } });
  const periodRow: PeriodRow | undefined = period
    ? {
        id: period.id,
        name: period.name,
        kind: period.kind,
        ridingNumbers: period.ridingNumbers,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
      }
    : undefined;

  const dupWindowStart = new Date(contribution.acceptedAt.getTime() - DUPLICATE_CONTRIBUTION_WINDOW_MS);
  const dupWindowEnd = new Date(contribution.acceptedAt.getTime() + DUPLICATE_CONTRIBUTION_WINDOW_MS);
  const duplicateRows = await prisma.contribution.findMany({
    where: {
      contactId: contribution.contactId,
      id: { not: contribution.id },
      acceptedAt: { gte: dupWindowStart, lte: dupWindowEnd },
    },
    include: { metadata: true },
  });
  const duplicateContributionCandidates: DuplicateContributionCandidate[] = duplicateRows
    .filter((r) => r.metadata !== null)
    .map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      acceptedAt: r.acceptedAt,
      externalRef: r.externalRef,
      entityKind: r.metadata!.entityKind,
      ridingNumber: r.metadata!.ridingNumber,
    }));

  const year = contributionYear(contribution.acceptedAt);
  // loose UTC bound (a day of margin either side) refined in JS by contributionYear (ET)
  const yearRows = await prisma.contribution.findMany({
    where: {
      contactId: contribution.contactId,
      id: { not: contribution.id },
      acceptedAt: {
        gte: new Date(Date.UTC(year - 1, 11, 30)),
        lt: new Date(Date.UTC(year + 1, 0, 2)),
      },
    },
    include: { metadata: true },
  });
  const otherContributionsThisYear: ContributionForLimits[] = yearRows
    .filter((r) => r.metadata !== null && contributionYear(r.acceptedAt) === year)
    .map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      goodsServices: r.metadata!.goodsServices,
      entityKind: r.metadata!.entityKind,
      ridingNumber: r.metadata!.ridingNumber,
      year,
      candidateSelf: false,
      leadership: false,
    }));
  const limitRows = await prisma.contributionLimit.findMany({ where: { year } });

  const contactCandidates = contribution.contact.email
    ? await prisma.contact.findMany({
        where: { email: contribution.contact.email, id: { not: contribution.contactId } },
        select: { id: true, email: true },
      })
    : [];
  const duplicateContactCandidates: DuplicateContactCandidate[] = contactCandidates.map((c) => ({
    contactId: c.id,
    email: c.email,
  }));

  const findings = runContributionRules({
    contribution: {
      id: contribution.id,
      amountCents: contribution.amountCents,
      acceptedAt: contribution.acceptedAt,
      paymentMethodKind: contribution.paymentMethodKind,
      externalRef: contribution.externalRef,
      metadata: {
        periodId: contribution.metadata.periodId,
        ridingNumber: contribution.metadata.ridingNumber,
        entityKind: contribution.metadata.entityKind,
        receivedBy: contribution.metadata.receivedBy,
        goodsServices: contribution.metadata.goodsServices,
        nonDeductibleCents: contribution.metadata.nonDeductibleCents,
        sourceCode: contribution.metadata.sourceCode,
      },
    },
    contactId: contribution.contactId,
    contactEmail: contribution.contact.email,
    period: periodRow,
    duplicateContributionCandidates,
    duplicateContactCandidates,
    overLimit: limitRows.length > 0 ? { contributionYear: year, otherContributionsThisYear, limits: limitRows } : null,
  });

  const { opened, reopened, resolved } = await reconcileValidationWorkItems(
    prisma,
    contribution.id,
    contribution.contactId,
    findings,
  );

  return { contributionId: contribution.id, findings, opened, reopened, resolved };
}

/** Prefix on WorkItem.ruleRef for the ticket-1.6 intake-derivation flags
 *  (mirror-sweep.ts) — a distinct concern from this registry's rules.
 *  Excluded from reconciliation below so this function never auto-resolves
 *  or reopens an intake flag it didn't create and can't re-evaluate. */
const INTAKE_FLAG_PREFIX = 'INTAKE:';

async function reconcileValidationWorkItems(
  prisma: PrismaClient,
  contributionId: string,
  contactId: string,
  findings: ValidationFinding[],
): Promise<{ opened: number; reopened: number; resolved: number }> {
  const allExisting = await prisma.workItem.findMany({
    where: { kind: 'VALIDATION', subjectType: 'Contribution', subjectId: contributionId },
  });
  const existing = allExisting.filter((w) => !w.ruleRef?.startsWith(INTAKE_FLAG_PREFIX));
  const byRule = new Map(existing.filter((w) => w.ruleRef !== null).map((w) => [w.ruleRef!, w]));
  const findingRefs = new Set(findings.map((f) => f.ruleRef));
  const nowYear = contributionYear(new Date());

  let opened = 0;
  let reopened = 0;
  let resolved = 0;

  for (const finding of findings) {
    const current = byRule.get(finding.ruleRef);
    if (!current) {
      await prisma.workItem.create({
        data: {
          kind: 'VALIDATION',
          subjectType: 'Contribution',
          subjectId: contributionId,
          contactId,
          ruleRef: finding.ruleRef,
        },
      });
      opened += 1;
      continue;
    }
    if (current.status === 'OPEN') continue; // already tracked, nothing to do
    if (current.status === 'EXCEPTION') {
      const exceptionYear = contributionYear(current.closedAt ?? current.openedAt);
      if (exceptionYear >= nowYear) continue; // still within its granted year
    }
    // RESOLVED, or an expired EXCEPTION: the condition re-appeared. Reopen
    // the same row rather than creating a duplicate (data-model §2: "every
    // close writes a ChangeLogEntry"; reopening is the mirror of a close).
    await withChangeLog(
      prisma,
      { userId: null, reason: 'validation: condition re-detected on re-run, reopening' },
      async (ctx) => {
        const before = current;
        const after = await ctx.tx.workItem.update({
          where: { id: current.id },
          data: { status: 'OPEN', resolutionNote: null, closedAt: null },
        });
        await ctx.log({ subjectType: 'WorkItem', subjectId: current.id, before, after });
      },
    );
    reopened += 1;
  }

  for (const current of existing) {
    if (current.status !== 'OPEN') continue;
    if (current.ruleRef && findingRefs.has(current.ruleRef)) continue; // still applies
    await withChangeLog(
      prisma,
      { userId: null, reason: 'validation: condition no longer applies' },
      async (ctx) => {
        const before = current;
        const after = await ctx.tx.workItem.update({
          where: { id: current.id },
          data: { status: 'RESOLVED', resolutionNote: 'auto-resolved: condition no longer applies', closedAt: new Date() },
        });
        await ctx.log({ subjectType: 'WorkItem', subjectId: current.id, before, after });
      },
    );
    resolved += 1;
  }

  return { opened, reopened, resolved };
}

export interface NightlyValidationResult {
  contributionsChecked: number;
  opened: number;
  reopened: number;
  resolved: number;
}

/** The "nightly" run-on-schedule half of validation-rules.md's "when rules
 *  run" (calendar-driven rules like B2's aggregation need this even absent
 *  an edit). A real schedule is ticket 1.15; this is the entrypoint it (or a
 *  manual trigger, matching 1.1's pattern) calls. */
export async function runValidationForAllContributions(
  prisma: PrismaClient,
): Promise<NightlyValidationResult> {
  const ids = await prisma.contribution.findMany({
    where: { metadata: { isNot: null }, deletedInQomonAt: null },
    select: { id: true },
  });

  let opened = 0;
  let reopened = 0;
  let resolved = 0;
  for (const { id } of ids) {
    const result = await runValidationForContribution(prisma, id);
    if (!result) continue;
    opened += result.opened;
    reopened += result.reopened;
    resolved += result.resolved;
  }
  return { contributionsChecked: ids.length, opened, reopened, resolved };
}
