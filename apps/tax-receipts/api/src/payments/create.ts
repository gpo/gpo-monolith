import type { GpoMetadataDescriptive, PaymentMethod, PaymentSource, PaymentState } from '@gpo/tax-receipts-core';
import type { ChangeLogContext } from '../changelog/write.js';
import { descriptiveToColumns } from '../contributions/metadata-cache.js';

/**
 * Payment + initial Contribution creation (data-model §2, D12): the one
 * place both entry points go through, so a Qomon import and a manual entry
 * produce identical rows and identical change-log entries.
 *
 * Runs inside the caller's `withChangeLog` transaction: the Payment, its
 * optional Qomon link, and the initial Contribution (carrying its descriptive
 * fields, when the caller has already derived them) all commit or roll back
 * together, each with a ChangeLogEntry.
 *
 * Invariant 9's Qomon-link gate is deliberately not enforced here yet:
 * during development and testing a contribution may be attributed to a
 * mirrored contact with no Qomon link (D12). Before go-live this is where
 * the refusal belongs.
 */

export interface QomonLinkInput {
  qomonTransactionId: bigint;
  qomonBundleId: bigint | null;
  /** Qomon's raw `payment_method_kind`, kept for provenance */
  qomonPaymentMethodKind: string | null;
  codeCampaign: string | null;
  syncHash: string;
}

export interface NewPaymentInput {
  source: PaymentSource;
  /** who paid, as recorded */
  contactId: string;
  amountCents: number;
  receivedAt: Date;
  method: PaymentMethod;
  payerName?: string | null;
  externalRef?: string | null;
  state?: PaymentState;
  note?: string | null;
  createdByUserId?: string | null;
  /** present exactly for QOMON_IMPORT payments */
  qomonLink?: QomonLinkInput;
  /** the initial contribution; every field defaults from the payment
   *  (amount, contact, acceptance date = received date). */
  contribution?: {
    contactId?: string;
    amountCents?: number;
    acceptedAt?: Date;
    note?: string | null;
  };
  /** already-derived descriptive fields, written onto the contribution.
   *  Left out when no period resolves yet: the contribution then imports
   *  with no period (defaults elsewhere) and a later pass backfills it. */
  descriptive?: GpoMetadataDescriptive;
}

export async function createPaymentWithContribution(ctx: ChangeLogContext, input: NewPaymentInput) {
  const { tx } = ctx;

  const payment = await tx.payment.create({
    data: {
      source: input.source,
      contactId: input.contactId,
      amountCents: input.amountCents,
      receivedAt: input.receivedAt,
      method: input.method,
      payerName: input.payerName ?? null,
      externalRef: input.externalRef ?? null,
      state: input.state ?? 'RECEIVED',
      note: input.note ?? null,
      createdByUserId: input.createdByUserId ?? null,
      ...(input.qomonLink
        ? {
            qomonLink: {
              create: {
                qomonTransactionId: input.qomonLink.qomonTransactionId,
                qomonBundleId: input.qomonLink.qomonBundleId,
                qomonPaymentMethodKind: input.qomonLink.qomonPaymentMethodKind,
                codeCampaign: input.qomonLink.codeCampaign,
                syncHash: input.qomonLink.syncHash,
                lastSyncedAt: new Date(),
              },
            },
          }
        : {}),
    },
    include: { qomonLink: true },
  });
  await ctx.log({ subjectType: 'Payment', subjectId: payment.id, after: payment });

  const contribution = await tx.contribution.create({
    data: {
      paymentId: payment.id,
      contactId: input.contribution?.contactId ?? input.contactId,
      amountCents: input.contribution?.amountCents ?? input.amountCents,
      acceptedAt: input.contribution?.acceptedAt ?? input.receivedAt,
      note: input.contribution?.note ?? null,
      correlationId: ctx.correlationId,
      createdByUserId: input.createdByUserId ?? null,
      ...(input.descriptive ? descriptiveToColumns(input.descriptive) : {}),
    },
  });
  await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after: contribution });

  return { payment, contribution };
}
