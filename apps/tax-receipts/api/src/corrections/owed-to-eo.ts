import type { ChangeLogContext } from '../changelog/write.js';
import type { ChangeLogSubjectType } from '@gpo/tax-receipts-core';

/**
 * The owed-to-EO queue's one producer (corrections.md: "everything EO must
 * still be told"). Every correction that touches something EO has seen opens
 * an `OWED_TO_EO` WorkItem through here, so the same subject and rule never
 * queues twice while the first is still open (a cancel that follows a
 * supersede on the same RTD-reported contribution must not double the DC-1A
 * work).
 */

/** corrections.md action 11: a DC-1A amendment for an RTD-reported contribution. */
export const OWED_DC1A = 'corrections-11';
/** corrections.md principle 3: a filed annual return covered the receipt, so the
 *  current year's return package carries a note instead. */
export const OWED_RETURN_NOTE = 'corrections-return-note';

export interface OwedToEoInput {
  subjectType: ChangeLogSubjectType;
  subjectId: string;
  contactId: string | null;
  ruleRef: typeof OWED_DC1A | typeof OWED_RETURN_NOTE;
}

/** Opens the item unless an OPEN one already exists for the same subject and
 *  rule; returns the item's id either way. */
export async function openOwedToEo(ctx: ChangeLogContext, input: OwedToEoInput): Promise<string> {
  const existing = await ctx.tx.workItem.findFirst({
    where: {
      kind: 'OWED_TO_EO',
      status: 'OPEN',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ruleRef: input.ruleRef,
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const item = await ctx.tx.workItem.create({
    data: {
      kind: 'OWED_TO_EO',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      contactId: input.contactId,
      ruleRef: input.ruleRef,
      correlationId: ctx.correlationId,
    },
  });
  await ctx.log({ subjectType: 'WorkItem', subjectId: item.id, after: item });
  return item.id;
}
