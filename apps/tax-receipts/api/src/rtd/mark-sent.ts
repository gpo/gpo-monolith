import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { getRtdGateFindings, type RtdGateFinding } from './draft.js';

/**
 * RTD filing "mark sent" step (redesigned from tickets 2.3/2.6's combined
 * stamp): the filer's confirmation that a prepared filing was actually
 * emailed to EO. This is what jobs-to-be-done.md originally called "C5.
 * Stamp what EO has seen" and specified as happening AFTER "C4. Submit to
 * EO" -- the built system used to invert that order (the old `stampRtdFiling`
 * set the reported-marker before a file even existed). This function is the
 * fix: it's the only place `RtdFiling.submittedAt`/`submittedBy` get written,
 * and it's the point at which a filing becomes truly "reported" for DC-1A
 * eligibility purposes (`dc1a.ts`).
 *
 * Sending isn't automated (no email integration exists yet -- easy to layer
 * on later); the filer downloads the already-rendered artifact
 * (`prepare.ts`), emails it to EO by hand, then confirms here.
 *
 * Re-checks the RTD gate on every included contribution before allowing the
 * mark: nothing should be confirmed "sent" if a contribution has drifted
 * into a blocked state between prepare and send (e.g. a B1/B2 finding opened
 * since). This mirrors the race guard `prepareRtdFiling` already runs at its
 * own boundary.
 */

export class RtdFilingNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(readonly rtdFilingId: string) {
    super(`no RtdFiling ${rtdFilingId}`);
    this.name = 'RtdFilingNotFoundError';
  }
}

export class UnsupportedFilingKindError extends Error {
  readonly statusCode = 400;
  constructor(readonly rtdFilingId: string, readonly kind: string) {
    super(
      `RtdFiling ${rtdFilingId} has kind ${kind}; markRtdFilingSent only applies to INITIAL filings -- a ` +
        'DC1A_AMENDMENT is generated and considered filed in one step (dc1a.ts)',
    );
    this.name = 'UnsupportedFilingKindError';
  }
}

export class RtdFilingAlreadySentError extends Error {
  readonly statusCode = 409;
  constructor(readonly rtdFilingId: string, readonly submittedAt: Date) {
    super(`RtdFiling ${rtdFilingId} was already marked sent at ${submittedAt.toISOString()}`);
    this.name = 'RtdFilingAlreadySentError';
  }
}

/** A contribution in this filing now has an open RTD-gate finding it didn't
 *  have at prepare time -- refuse to confirm this filing as sent to EO. */
export class RtdSendBlockedError extends Error {
  readonly statusCode = 409;
  constructor(readonly blocked: Array<{ contributionId: string; gateFindings: RtdGateFinding[] }>) {
    super(
      `${blocked.length} row(s) in this filing now have open RTD-gate findings; resolve them (or generate a ` +
        `DC-1A once this is actually confirmed sent) before marking sent: ` +
        blocked
          .map((b) => `${b.contributionId} (${b.gateFindings.map((f) => f.ruleRef).join(',')})`)
          .join('; '),
    );
    this.name = 'RtdSendBlockedError';
  }
}

export interface MarkRtdFilingSentInput {
  rtdFilingId: string;
  actorUserId: string;
  reason: string;
  /** defaults to now. */
  asOf?: Date;
}

export interface MarkedRtdFilingSent {
  rtdFilingId: string;
  submittedAt: Date;
}

export async function markRtdFilingSent(
  prisma: PrismaClient,
  input: MarkRtdFilingSentInput,
): Promise<MarkedRtdFilingSent> {
  const asOf = input.asOf ?? new Date();

  const filing = await prisma.rtdFiling.findUnique({
    where: { id: input.rtdFilingId },
    include: { inclusions: { select: { contributionId: true } } },
  });
  if (!filing) throw new RtdFilingNotFoundError(input.rtdFilingId);
  if (filing.kind !== 'INITIAL') throw new UnsupportedFilingKindError(input.rtdFilingId, filing.kind);
  if (filing.submittedAt) throw new RtdFilingAlreadySentError(input.rtdFilingId, filing.submittedAt);

  const contributionIds = filing.inclusions.map((i) => i.contributionId);
  const gateFindings = await getRtdGateFindings(prisma, contributionIds);
  const blocked = contributionIds
    .map((contributionId) => ({ contributionId, gateFindings: gateFindings.get(contributionId) ?? [] }))
    .filter((b) => b.gateFindings.length > 0);
  if (blocked.length > 0) {
    throw new RtdSendBlockedError(blocked);
  }

  await withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
    const before = filing;
    const after = await ctx.tx.rtdFiling.update({
      where: { id: input.rtdFilingId },
      data: { submittedAt: asOf, submittedBy: input.actorUserId },
    });
    await ctx.log({
      subjectType: 'RtdFiling',
      subjectId: input.rtdFilingId,
      before: { submittedAt: before.submittedAt, submittedBy: before.submittedBy },
      after: { submittedAt: after.submittedAt, submittedBy: after.submittedBy },
    });
    return after;
  });

  return { rtdFilingId: input.rtdFilingId, submittedAt: asOf };
}
