import type { EntityKind, PrismaClient, ReceiptDelivery } from '../generated/prisma/index.js';
import { ContributionNotFoundError } from '../contributions/metadata-edit.js';
import { ReceiptNotFoundError } from '../receipts/allocate.js';
import {
  CorrectionValidationError,
  type ContributionChange,
  type CorrectionAction,
  type CorrectionInput,
  type ReplacementSpec,
} from './contribution-correction.js';

/**
 * The named correction actions (corrections.md), each reduced to a change list
 * for the engine in `contribution-correction.ts`. A builder only decides WHAT
 * is superseded and by what; the cascade (receipts, EO paperwork, validation)
 * is the engine's and identical for every action.
 *
 *   4  correct amount        -> `correctAmount`
 *   5  move contributions    -> `moveContributions`
 *   6  move a whole receipt  -> `moveReceipt` (sugar over 5)
 *   8  refund and cancel     -> `refund`
 *   9  reallocate            -> `reallocate` (a split whose parts change entity)
 *  12  split a contribution  -> `splitContribution`
 *
 * Actions 1, 2, and 11 are `cancel.ts` and `rtd/dc1a.ts`; 7 is `receipt-split.ts`;
 * 3 is `reprint.ts`; 10 is `merge-contacts.ts`.
 */

export interface ActionCommon {
  actorUserId: string;
  reason: string;
  politicalEntityLabel?: string;
  entityLabels?: Record<string, string>;
  delivery?: ReceiptDelivery;
}

function common(action: CorrectionAction, c: ActionCommon, changes: ContributionChange[]): CorrectionInput {
  return {
    action,
    changes,
    actorUserId: c.actorUserId,
    reason: c.reason,
    politicalEntityLabel: c.politicalEntityLabel,
    entityLabels: c.entityLabels,
    delivery: c.delivery,
  };
}

async function loadActive(prisma: PrismaClient, ids: string[]) {
  const rows = await prisma.contribution.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) if (!byId.has(id)) throw new ContributionNotFoundError(id);
  return ids.map((id) => byId.get(id)!);
}

/** Action 4. The corrected amount replaces the contribution's; `paymentAmountCents`
 *  also corrects the payment when the amount was mis-keyed at entry. */
export async function correctAmount(
  prisma: PrismaClient,
  input: ActionCommon & {
    contributionId: string;
    amountCents: number;
    nonDeductibleCents?: number;
    paymentAmountCents?: number;
  },
): Promise<CorrectionInput> {
  const [old] = await loadActive(prisma, [input.contributionId]);
  if (input.amountCents === old!.amountCents && input.paymentAmountCents === undefined) {
    throw new CorrectionValidationError('the corrected amount equals the current amount');
  }
  const built = common('CORRECT_AMOUNT', input, [
    {
      kind: 'supersede',
      contributionId: old!.id,
      replacements: [{ amountCents: input.amountCents, nonDeductibleCents: input.nonDeductibleCents }],
    },
  ]);
  if (input.paymentAmountCents !== undefined) {
    built.paymentAmountCorrection = { paymentId: old!.paymentId, amountCents: input.paymentAmountCents };
  }
  return built;
}

/** Action 5: reattribute contributions to another donor, same payment and amount. */
export async function moveContributions(
  prisma: PrismaClient,
  input: ActionCommon & { contributionIds: string[]; toContactId: string },
): Promise<CorrectionInput> {
  const rows = await loadActive(prisma, input.contributionIds);
  const same = rows.filter((r) => r.contactId === input.toContactId);
  if (same.length > 0) {
    throw new CorrectionValidationError(
      `contribution ${same[0]!.id} already belongs to the target donor; there is nothing to move`,
    );
  }
  return common(
    'MOVE',
    input,
    rows.map((r) => ({
      kind: 'supersede' as const,
      contributionId: r.id,
      replacements: [{ amountCents: r.amountCents, contactId: input.toContactId }],
    })),
  );
}

/** Action 6: the everything-was-theirs case of action 5. */
export async function moveReceipt(
  prisma: PrismaClient,
  input: ActionCommon & { receiptId: string; toContactId: string },
): Promise<CorrectionInput> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: input.receiptId },
    include: { allocations: { include: { contribution: true } } },
  });
  if (!receipt) throw new ReceiptNotFoundError(input.receiptId);
  const ids = [
    ...new Set(receipt.allocations.filter((a) => a.contribution.status === 'ACTIVE').map((a) => a.contributionId)),
  ];
  if (ids.length === 0) {
    throw new CorrectionValidationError(`receipt ${receipt.receiptNumber} has no active contributions to move`);
  }
  return moveContributions(prisma, { ...input, contributionIds: ids });
}

/** Action 8: money returned. Contributions become REFUNDED, the payment too once
 *  none of it is left active. Pass either the contributions or a whole payment. */
export async function refund(
  prisma: PrismaClient,
  input: ActionCommon & { contributionIds?: string[]; paymentId?: string },
): Promise<CorrectionInput> {
  let ids = input.contributionIds ?? [];
  if (input.paymentId) {
    const active = await prisma.contribution.findMany({
      where: { paymentId: input.paymentId, status: 'ACTIVE' },
      select: { id: true },
    });
    ids = [...ids, ...active.map((c) => c.id)];
  }
  ids = [...new Set(ids)];
  if (ids.length === 0) throw new CorrectionValidationError('nothing to refund: name contributions or a payment with active contributions');
  return common(
    'REFUND',
    input,
    ids.map((id) => ({ kind: 'refund' as const, contributionId: id })),
  );
}

export interface SplitPart {
  amountCents: number;
  contactId?: string;
  entityKind?: EntityKind;
  ridingNumber?: number | null;
  periodId?: number | null;
  nonDeductibleCents?: number;
}

function partToSpec(part: SplitPart): ReplacementSpec {
  return {
    amountCents: part.amountCents,
    contactId: part.contactId,
    entityKind: part.entityKind,
    ridingNumber: part.entityKind === 'PARTY' ? null : part.ridingNumber,
    periodId: part.periodId,
    nonDeductibleCents: part.nonDeductibleCents,
  };
}

async function dividedInput(
  prisma: PrismaClient,
  action: CorrectionAction,
  input: ActionCommon & { contributionId: string; parts: SplitPart[] },
): Promise<CorrectionInput> {
  const [old] = await loadActive(prisma, [input.contributionId]);
  const total = input.parts.reduce((sum, p) => sum + p.amountCents, 0);
  if (total !== old!.amountCents) {
    throw new CorrectionValidationError(
      `the parts add up to ${total}c but the contribution is ${old!.amountCents}c; ` +
        'dividing a contribution must account for all of it (use correct amount to change the total)',
    );
  }
  return common(action, input, [
    { kind: 'supersede', contributionId: old!.id, replacements: input.parts.map(partToSpec) },
  ]);
}

/** Action 12: divide one contribution between contacts, entities, or periods. */
export async function splitContribution(
  prisma: PrismaClient,
  input: ActionCommon & { contributionId: string; parts: SplitPart[] },
): Promise<CorrectionInput> {
  if (input.parts.length < 2) throw new CorrectionValidationError('a split needs at least two parts');
  return dividedInput(prisma, 'SPLIT_CONTRIBUTION', input);
}

/** Action 9: the executed half of the guided over-limit resolution. A full
 *  reallocation is one part on another entity; a partial one is several. Filer
 *  sign-off is the route's job (a user who can file). */
export async function reallocate(
  prisma: PrismaClient,
  input: ActionCommon & { contributionId: string; parts: SplitPart[] },
): Promise<CorrectionInput> {
  if (input.parts.length < 1) throw new CorrectionValidationError('a reallocation needs at least one part');
  for (const p of input.parts) {
    if (p.entityKind && p.entityKind !== 'PARTY' && (p.ridingNumber === undefined || p.ridingNumber === null)) {
      throw new CorrectionValidationError('a CA or campaign part needs its riding number');
    }
  }
  return dividedInput(prisma, 'REALLOCATE', input);
}
