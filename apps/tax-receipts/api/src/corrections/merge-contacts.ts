import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient, ReceiptDelivery } from '../generated/prisma/index.js';
import {
  CorrectionValidationError,
  type ContributionChange,
  type CorrectionInput,
} from './contribution-correction.js';

/**
 * Correction action 10: merge duplicate contacts (corrections.md). Every ACTIVE
 * contribution of the merged-away contact is superseded onto the surviving
 * contact (the action 5 path, in bulk, so receipts are cancelled and reissued
 * and a DC-1A is queued for anything already RTD-reported), the merged-away
 * contact's payments are re-pointed at the survivor, and the merged-away
 * contact is flagged `mergedIntoId`. All of it commits in one transaction.
 *
 * Nothing is deleted, so a merge is reversible with its audit trail (`unmerge`
 * clears the flag; the contributions it moved go back with an ordinary move).
 * When an RTD-reported contribution is involved the supporting evidence is
 * required and stored in the change-log entry (EO s. 25.2(8)).
 *
 * The combined contributor's calendar-year RTD aggregate needs no step here:
 * the draft builder derives it live from ACTIVE contributions, so deposits that
 * only crossed $200 once merged go into the next normal filing as late records
 * (the EO-sanctioned path). Contacts are Qomon-owned, so the merge in Qomon
 * itself is the follow-up the preview lists.
 */

export interface MergeContactsInput {
  survivorId: string;
  mergedAwayId: string;
  actorUserId: string;
  /** mandatory (invariant 5). */
  reason: string;
  /** why these are the same person; required when an RTD-reported contribution moves */
  evidence?: string;
  politicalEntityLabel?: string;
  entityLabels?: Record<string, string>;
  delivery?: ReceiptDelivery;
}

export async function mergeContacts(prisma: PrismaClient, input: MergeContactsInput): Promise<CorrectionInput> {
  if (input.survivorId === input.mergedAwayId) {
    throw new CorrectionValidationError('a contact cannot be merged into itself');
  }
  const [survivor, mergedAway] = await Promise.all([
    prisma.contact.findUnique({ where: { id: input.survivorId } }),
    prisma.contact.findUnique({ where: { id: input.mergedAwayId } }),
  ]);
  if (!survivor) throw new CorrectionValidationError(`no contact ${input.survivorId}`);
  if (!mergedAway) throw new CorrectionValidationError(`no contact ${input.mergedAwayId}`);
  if (survivor.mergedIntoId) {
    throw new CorrectionValidationError(`${survivor.name} was itself merged into another contact; merge into that one`);
  }
  if (mergedAway.mergedIntoId) {
    throw new CorrectionValidationError(`${mergedAway.name} is already merged into contact ${mergedAway.mergedIntoId}`);
  }

  const active = await prisma.contribution.findMany({
    where: { contactId: mergedAway.id, status: 'ACTIVE' },
    select: { id: true, amountCents: true, rtdInclusions: { select: { rtdFiling: { select: { submittedAt: true } } } } },
  });
  const reportedCount = active.filter((c) => c.rtdInclusions.some((i) => i.rtdFiling.submittedAt != null)).length;
  if (reportedCount > 0 && !input.evidence?.trim()) {
    throw new CorrectionValidationError(
      `${reportedCount} of ${mergedAway.name}'s contributions were RTD-reported; state the evidence that these are the same person`,
    );
  }

  const changes: ContributionChange[] = active.map((c) => ({
    kind: 'supersede',
    contributionId: c.id,
    replacements: [{ amountCents: c.amountCents, contactId: survivor.id }],
  }));

  return {
    action: 'MERGE_CONTACTS',
    actorUserId: input.actorUserId,
    reason: input.reason,
    changes,
    politicalEntityLabel: input.politicalEntityLabel,
    entityLabels: input.entityLabels,
    delivery: input.delivery,
    extraFollowUps: [
      `Qomon still has both records: merge ${mergedAway.name} into ${survivor.name} there too (contacts are Qomon-owned; the tool never writes to Qomon)`,
    ],
    inTransaction: async (ctx) => {
      // "who paid" is the same person now
      const payments = await ctx.tx.payment.findMany({ where: { contactId: mergedAway.id } });
      for (const p of payments) {
        await ctx.tx.payment.update({ where: { id: p.id }, data: { contactId: survivor.id } });
        await ctx.log({
          subjectType: 'Payment',
          subjectId: p.id,
          before: { contactId: mergedAway.id },
          after: { contactId: survivor.id },
        });
      }
      await ctx.tx.contact.update({
        where: { id: mergedAway.id },
        data: { mergedIntoId: survivor.id, mergedAt: new Date() },
      });
      await ctx.log({
        subjectType: 'Contact',
        subjectId: mergedAway.id,
        before: { mergedIntoId: null },
        after: { mergedIntoId: survivor.id, survivorName: survivor.name, evidence: input.evidence ?? null },
      });
    },
  };
}

export class ContactNotMergedError extends Error {
  readonly statusCode = 409;
  constructor(contactId: string) {
    super(`contact ${contactId} is not merged into another contact`);
    this.name = 'ContactNotMergedError';
  }
}

/** Reverses the flag only. Contributions the merge moved stay where they are;
 *  moving any of them back is an ordinary correction (action 5). */
export async function unmergeContact(
  prisma: PrismaClient,
  input: { contactId: string; actorUserId: string; reason: string },
): Promise<void> {
  const contact = await prisma.contact.findUnique({ where: { id: input.contactId } });
  if (!contact) throw new CorrectionValidationError(`no contact ${input.contactId}`);
  if (!contact.mergedIntoId) throw new ContactNotMergedError(contact.id);
  await withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
    await ctx.tx.contact.update({ where: { id: contact.id }, data: { mergedIntoId: null, mergedAt: null } });
    await ctx.log({
      subjectType: 'Contact',
      subjectId: contact.id,
      before: { mergedIntoId: contact.mergedIntoId },
      after: { mergedIntoId: null },
    });
  });
}
