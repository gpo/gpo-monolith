import type { PaymentMethod } from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import { isReceiptedOrReported } from '../contributions/metadata-cache.js';
import { runValidationForContribution } from '../validation/run.js';
import type { Payment, PrismaClient } from '../generated/prisma/index.js';

/**
 * Fix how a manual payment was keyed (D12): the date it was received, the
 * method, its reference, the payer, and the note. The amount and the donor are
 * not here: changing either moves money between contributions or donors, so
 * it goes through a correction action (corrections.md), which handles the
 * receipts.
 *
 * A payment imported from Qomon is Qomon's record and stays read-only; the
 * sweep would only see it drift.
 *
 * A contribution's acceptance date defaults to the payment's received date, so
 * a mis-keyed date usually sits on both. A date fix moves every ACTIVE
 * contribution still on the old date with it, unless one of them already backs
 * an ISSUED receipt or an RTD filing (invariant 6): that date changes only
 * through a correction.
 */

export class PaymentNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(paymentId: string) {
    super(`no payment ${paymentId}`);
    this.name = 'PaymentNotFoundError';
  }
}

export class PaymentEditBlockedError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'PaymentEditBlockedError';
  }
}

export interface PaymentEditInput {
  paymentId: string;
  actorUserId: string;
  /** mandatory (invariant 5) */
  reason: string;
  receivedAt: Date;
  method: PaymentMethod;
  externalRef: string | null;
  payerName: string | null;
  note: string | null;
}

export async function editPayment(prisma: PrismaClient, input: PaymentEditInput): Promise<Payment> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    include: { qomonLink: true, contributions: { where: { status: 'ACTIVE' } } },
  });
  if (!payment) throw new PaymentNotFoundError(input.paymentId);
  if (payment.source === 'QOMON_IMPORT' || payment.qomonLink) {
    throw new PaymentEditBlockedError('this payment was imported from Qomon; it can only change there');
  }

  const dateChanged = payment.receivedAt.getTime() !== input.receivedAt.getTime();
  const followers = dateChanged
    ? payment.contributions.filter((c) => c.acceptedAt.getTime() === payment.receivedAt.getTime())
    : [];
  for (const c of followers) {
    if (await isReceiptedOrReported(prisma, c.id)) {
      throw new PaymentEditBlockedError(
        'a contribution on this date backs an issued receipt or an RTD filing; change its date through a correction instead',
      );
    }
  }

  const { qomonLink: _link, contributions: _contributions, ...before } = payment;
  const updated = await withChangeLog(prisma, { userId: input.actorUserId, reason: input.reason }, async (ctx) => {
    const after = await ctx.tx.payment.update({
      where: { id: payment.id },
      data: {
        receivedAt: input.receivedAt,
        method: input.method,
        externalRef: input.externalRef,
        payerName: input.payerName,
        note: input.note,
      },
    });
    await ctx.log({ subjectType: 'Payment', subjectId: payment.id, before, after });
    for (const c of followers) {
      const moved = await ctx.tx.contribution.update({
        where: { id: c.id },
        data: { acceptedAt: input.receivedAt },
      });
      await ctx.log({ subjectType: 'Contribution', subjectId: c.id, before: c, after: moved });
    }
    return after;
  });

  // the method and reference feed the payment rules, and the date the period window
  for (const c of payment.contributions) {
    await runValidationForContribution(prisma, c.id);
  }
  return updated;
}
