import {
  deriveIntakeDefaults,
  type GpoMetadataDescriptive,
  type IntakeFlag,
  type PaymentMethod,
} from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import { loadPeriods } from '../sync/mirror-sweep.js';
import { runValidationForContribution } from '../validation/run.js';
import { createContribution, createPaymentWithContribution } from './create.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import type { ChangeLogContext } from '../changelog/write.js';

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
 * A payment may be attributed across several contributions at entry (a couple's
 * cheque, a gift split between entities): each carries its own donor, amount,
 * and descriptive fields, derived and validated the same way. Later, whatever
 * of a payment is still unattributed can be attributed with
 * {@link addContributionToPayment}. A contact merged into another (correction
 * action 10) is never accepted.
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

/** One contribution of a payment. Everything but the amount defaults from the
 *  payment or from the intake derivation. */
export interface ContributionEntry {
  amountCents: number;
  /** the donor it is attributed to; defaults to the payment's contact */
  contactId?: string;
  /** acceptance date; defaults to the date the payment was received */
  acceptedAt?: Date;
  note?: string | null;
  /** operator overrides on top of the derived descriptive fields */
  descriptive?: Partial<Omit<GpoMetadataDescriptive, 'external_ref'>>;
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
  /** operator overrides on top of the derived descriptive fields (the single
   *  contribution's, when `contributions` is not given) */
  descriptive?: Partial<Omit<GpoMetadataDescriptive, 'external_ref'>>;
  /** attribute the payment across these contributions; when omitted, one
   *  contribution covers the whole payment */
  contributions?: ContributionEntry[];
}

export interface IntakePreview {
  descriptive: GpoMetadataDescriptive | null;
  flags: readonly IntakeFlag[];
}

/** What the intake derivation would settle on, for the entry form to show
 *  before anything is saved. */
export async function previewIntake(
  prisma: PrismaClient,
  input: { acceptedAt: Date; ridingNumber?: number | null; sourceCode?: string | null; externalRef?: string | null },
): Promise<IntakePreview> {
  const derived = deriveIntakeDefaults({
    acceptedAt: input.acceptedAt,
    codeCampaign: input.sourceCode ?? null,
    ridingNumber: input.ridingNumber ?? null,
    externalRef: input.externalRef ?? null,
    periods: await loadPeriods(prisma),
  });
  return { descriptive: derived.descriptive, flags: derived.flags };
}

async function assertUsableContact(prisma: PrismaClient, contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, name: true, mergedIntoId: true },
  });
  if (!contact) throw new ManualEntryError(`no contact ${contactId}`);
  if (contact.mergedIntoId) {
    throw new ManualEntryError(`${contact.name} was merged into another contact; use the surviving contact`);
  }
}

/** The descriptive fields for one contribution: derived from its date, then
 *  overridden by the operator. A period the operator names stands in for a
 *  derivation that found none. */
async function resolveDescriptive(
  periods: Awaited<ReturnType<typeof loadPeriods>>,
  input: {
    amountCents: number;
    acceptedAt: Date;
    externalRef: string | null;
    overrides: Partial<Omit<GpoMetadataDescriptive, 'external_ref'>>;
  },
): Promise<{ descriptive: GpoMetadataDescriptive; flags: readonly IntakeFlag[] }> {
  const { overrides } = input;
  const derived = deriveIntakeDefaults({
    acceptedAt: input.acceptedAt,
    codeCampaign: overrides.source_code ?? null,
    ridingNumber: overrides.riding_number ?? null,
    externalRef: input.externalRef,
    periods,
  });
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
          external_ref: input.externalRef,
        }
      : null);
  if (!base) {
    throw new ManualEntryError('no reporting period covers this date; choose a period or configure one first');
  }
  const descriptive: GpoMetadataDescriptive = { ...base, ...overrides, external_ref: input.externalRef };
  if (descriptive.non_deductible_cents > input.amountCents) {
    throw new ManualEntryError('the non-deductible portion cannot exceed the amount');
  }
  if (descriptive.entity_kind === 'PARTY' && descriptive.riding_number !== null) {
    throw new ManualEntryError('a party contribution carries no riding number');
  }
  if (descriptive.entity_kind !== 'PARTY' && descriptive.riding_number === null) {
    throw new ManualEntryError(`a ${descriptive.entity_kind} contribution needs a riding number`);
  }
  return { descriptive, flags: derived.flags };
}

function assertPositiveCents(cents: number, what: string): void {
  if (!Number.isInteger(cents) || cents <= 0) throw new ManualEntryError(`${what} must be a positive whole number of cents`);
}

export async function enterManualPayment(prisma: PrismaClient, input: ManualPaymentInput) {
  assertPositiveCents(input.amountCents, 'amount');
  await assertUsableContact(prisma, input.contactId);

  const entries: ContributionEntry[] = input.contributions ?? [
    { amountCents: input.amountCents, descriptive: input.descriptive },
  ];
  if (entries.length === 0) throw new ManualEntryError('a payment needs at least one contribution');
  let total = 0;
  for (const e of entries) {
    assertPositiveCents(e.amountCents, 'a contribution amount');
    total += e.amountCents;
    if (e.contactId) await assertUsableContact(prisma, e.contactId);
  }
  if (total > input.amountCents) {
    throw new ManualEntryError(
      `the contributions add up to ${total}c but the payment is ${input.amountCents}c`,
    );
  }

  const periods = await loadPeriods(prisma);
  const resolved: Awaited<ReturnType<typeof resolveDescriptive>>[] = [];
  for (const e of entries) {
    resolved.push(
      await resolveDescriptive(periods, {
        amountCents: e.amountCents,
        acceptedAt: e.acceptedAt ?? input.receivedAt,
        externalRef: input.externalRef ?? null,
        overrides: e.descriptive ?? {},
      }),
    );
  }

  const { payment, contributions } = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    async (ctx: ChangeLogContext) => {
      const first = entries[0]!;
      const created = await createPaymentWithContribution(ctx, {
        source: 'MANUAL',
        contactId: input.contactId,
        amountCents: input.amountCents,
        receivedAt: input.receivedAt,
        method: input.method,
        payerName: input.payerName ?? null,
        externalRef: input.externalRef ?? null,
        note: input.note ?? null,
        createdByUserId: input.actorUserId,
        contribution: {
          contactId: first.contactId,
          amountCents: first.amountCents,
          acceptedAt: first.acceptedAt,
          note: first.note ?? null,
        },
        descriptive: resolved[0]!.descriptive,
      });
      const rows = [created.contribution];
      for (let i = 1; i < entries.length; i++) {
        const e = entries[i]!;
        rows.push(
          await createContribution(ctx, {
            paymentId: created.payment.id,
            contactId: e.contactId ?? input.contactId,
            amountCents: e.amountCents,
            acceptedAt: e.acceptedAt ?? input.receivedAt,
            note: e.note ?? null,
            createdByUserId: input.actorUserId,
            descriptive: resolved[i]!.descriptive,
          }),
        );
      }
      return { payment: created.payment, contributions: rows };
    },
  );

  // "on intake, all rules against the new row" (validation-rules.md)
  for (const c of contributions) await runValidationForContribution(prisma, c.id);

  return {
    payment,
    /** the first contribution (the only one unless the payment was split) */
    contribution: contributions[0]!,
    contributions,
    /** fields the derivation could not settle with confidence, for the caller to surface */
    flags: resolved[0]!.flags,
    contributionFlags: resolved.map((r) => r.flags),
  };
}

export interface AddContributionInput extends ContributionEntry {
  actorUserId: string;
  /** mandatory (invariant 5) */
  reason: string;
  paymentId: string;
}

/** Attribute some of what a payment has not yet been attributed to. */
export async function addContributionToPayment(prisma: PrismaClient, input: AddContributionInput) {
  assertPositiveCents(input.amountCents, 'the amount');
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    include: { contributions: { where: { status: 'ACTIVE' }, select: { amountCents: true } } },
  });
  if (!payment) throw new ManualEntryError(`no payment ${input.paymentId}`);
  const attributed = payment.contributions.reduce((sum, c) => sum + c.amountCents, 0);
  const remaining = payment.amountCents - attributed;
  if (input.amountCents > remaining) {
    throw new ManualEntryError(
      `only ${remaining}c of this payment is still unattributed; correct an existing contribution to change the split`,
    );
  }
  const contactId = input.contactId ?? payment.contactId;
  await assertUsableContact(prisma, contactId);

  const acceptedAt = input.acceptedAt ?? payment.receivedAt;
  const { descriptive, flags } = await resolveDescriptive(await loadPeriods(prisma), {
    amountCents: input.amountCents,
    acceptedAt,
    externalRef: payment.externalRef,
    overrides: input.descriptive ?? {},
  });

  const contribution = await withChangeLog(
    prisma,
    { userId: input.actorUserId, reason: input.reason },
    (ctx) =>
      createContribution(ctx, {
        paymentId: payment.id,
        contactId,
        amountCents: input.amountCents,
        acceptedAt,
        note: input.note ?? null,
        createdByUserId: input.actorUserId,
        descriptive,
      }),
  );
  await runValidationForContribution(prisma, contribution.id);
  return { contribution, flags, remainingCents: remaining - input.amountCents };
}
