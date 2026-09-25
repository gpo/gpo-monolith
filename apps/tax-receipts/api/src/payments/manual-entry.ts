import {
  deriveIntakeDefaults,
  type GpoMetadataDescriptive,
  type IntakeFlag,
  type PaymentMethod,
} from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import { descriptiveToRow } from '../contributions/metadata-cache.js';
import { loadPeriods } from '../sync/mirror-sweep.js';
import { runValidationForContribution } from '../validation/run.js';
import { createPaymentWithContribution } from './create.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Manual entry (D12): staff record a payment and its initial contribution
 * directly in the tool, with no Qomon transaction behind it. Goes through the
 * same {@link createPaymentWithContribution} as the Qomon import, so the rows
 * and change-log entries are identical; only `source` (MANUAL) and the absent
 * Qomon link differ.
 *
 * The descriptive fields start from the same intake derivation the import
 * uses (period from the acceptance date, `received_by` from provenance) and
 * the operator overrides any of them (data-model §6, invariant 8: "central
 * manual entry defaults GPO with operator override"). Unlike an import, a
 * manual entry never lands without a period: the operator is present to
 * pick one, so an unresolvable period is rejected rather than parked.
 *
 * Contact rule: the contact must already exist here. During development and
 * testing it need not carry a Qomon link; before go-live this is where
 * "create the contact in Qomon first" belongs (data-model invariant 9, O46).
 */

export class ManualEntryError extends Error {
  readonly statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = 'ManualEntryError';
  }
}

export interface ManualPaymentInput {
  actorUserId: string;
  /** mandatory (invariant 5) */
  reason: string;
  contactId: string;
  amountCents: number;
  receivedAt: Date;
  method: PaymentMethod;
  /** structured payer when it differs from the contact (rule B5, O36) */
  payerName?: string | null;
  /** processor id or cheque/deposit reference, for statement matching */
  externalRef?: string | null;
  note?: string | null;
  /** operator overrides on top of the derived descriptive fields */
  descriptive?: Partial<Omit<GpoMetadataDescriptive, 'external_ref'>>;
}

export async function enterManualPayment(prisma: PrismaClient, input: ManualPaymentInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new ManualEntryError('amount must be a positive whole number of cents');
  }
  const contact = await prisma.contact.findUnique({ where: { id: input.contactId }, select: { id: true } });
  if (!contact) throw new ManualEntryError(`no contact ${input.contactId}`);

  const overrides = input.descriptive ?? {};
  const derived = deriveIntakeDefaults({
    acceptedAt: input.receivedAt,
    codeCampaign: overrides.source_code ?? null,
    ridingNumber: overrides.riding_number ?? null,
    externalRef: input.externalRef ?? null,
    periods: await loadPeriods(prisma),
  });

  // An operator-chosen period stands in for the derivation; otherwise the
  // derivation must have found one.
  const base: GpoMetadataDescriptive | null =
    derived.descriptive ??
    (overrides.period_id !== undefined
      ? {
          period_id: overrides.period_id,
          riding_number: null,
          entity_kind: 'PARTY',
          received_by: 'GPO',
          goods_services: false,
          non_deductible_cents: 0,
          processed_date: null,
          source_code: '',
          eo_contributor_id: null,
          exception_reason: null,
          external_ref: input.externalRef ?? null,
        }
      : null);
  if (!base) {
    throw new ManualEntryError(
      'no reporting period covers this date; choose a period or configure one first',
    );
  }
  const descriptive: GpoMetadataDescriptive = {
    ...base,
    ...overrides,
    external_ref: input.externalRef ?? null,
  };
  if (descriptive.non_deductible_cents > input.amountCents) {
    throw new ManualEntryError('the non-deductible portion cannot exceed the amount');
  }

  const { payment, contribution } = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    (ctx) =>
      createPaymentWithContribution(ctx, {
        source: 'MANUAL',
        contactId: input.contactId,
        amountCents: input.amountCents,
        receivedAt: input.receivedAt,
        method: input.method,
        payerName: input.payerName ?? null,
        externalRef: input.externalRef ?? null,
        note: input.note ?? null,
        createdByUserId: input.actorUserId,
        metadataRow: descriptiveToRow(descriptive, null),
      }),
  );

  // "on intake, all rules against the new row" (validation-rules.md)
  await runValidationForContribution(prisma, contribution.id);

  // fields the derivation could not settle with confidence, for the caller
  // to surface to the operator
  const flags: readonly IntakeFlag[] = derived.flags;
  return { payment, contribution, flags };
}
