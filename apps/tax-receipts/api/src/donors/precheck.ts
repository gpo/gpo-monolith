import { randomBytes } from 'node:crypto';
import { contributionYear, remainingEligibleCents, type AllocationRow } from '@gpo/tax-receipts-core';
import { withChangeLog } from '../changelog/write.js';
import type { PrismaClient, ReceiptDelivery } from '../generated/prisma/index.js';
import type { SpaceKey } from '../space/space-state.js';

/**
 * Donor pre-check (ticket 3.9, story V4): "before issuance I receive a
 * pre-check (tied to my email) confirming my address and delivery
 * preference" (PRD.md V4; jobs-to-be-done.md D1). `DonorCyclePreference`
 * itself has existed since ticket 0.2 — this ticket is the first thing that
 * actually writes `precheckSentAt` / `addressConfirmedAt`, and closes
 * traceability.md gap 2.
 *
 * Two halves, split the same way ticket 3.5's delivery is split from 3.6's
 * real send:
 *
 *  - `sendDonorPrechecksForSpace` (staff-triggered, screens.md screen 6's
 *    "pre-check send step ahead of the window") stamps `precheckSentAt` and
 *    issues a bearer confirmation token per donor. It does not email
 *    anything — no provider/warmed subdomain exists yet (O24, same gap
 *    ticket 3.6 carries for receipt delivery itself), so this prepares what
 *    a send would need and stops there. A donor with no email on file is
 *    skipped, not failed, since a space usually has both kinds and one
 *    donor's rejected 3.5 would already have taken the same address-agnostic
 *    stance.
 *  - `confirmDonorPrecheck` (donor-facing, unauthenticated) is what the link
 *    in that email would point to. Donors have no `User` account, so this is
 *    identified solely by the token, not by session/CASL like every other
 *    route in this app — the exact "tied to my email" identity model V4
 *    describes. A confirmed address becomes a new `AddressSnapshot` (source
 *    `donor-precheck`, already anticipated by that field's own doc comment)
 *    rather than a write back into the cached Qomon address: nothing here
 *    should let an unauthenticated caller mutate the donor's Qomon-synced
 *    contact record.
 *
 * An unconfirmed donor's `delivery` stays at the schema default (MAIL) —
 * jobs-to-be-done.md D1's "unconfirmed donors default to mail" is therefore
 * already true with no extra code; nothing here needs to enforce it.
 */

export class DonorPrecheckTokenNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('this confirmation link is invalid or has already been used');
    this.name = 'DonorPrecheckTokenNotFoundError';
  }
}

export class DonorPrecheckTokenExpiredError extends Error {
  readonly statusCode = 410;
  constructor() {
    super('this confirmation link has expired; ask for a new one');
    this.name = 'DonorPrecheckTokenExpiredError';
  }
}

export interface SendDonorPrechecksInput extends SpaceKey {
  actorUserId: string;
  reason: string;
  /** confirmation link lifetime; defaults to 30 days, long enough to span
   *  workflows.md W4's wait/confirm window ahead of a normal issuance run. */
  expiresInDays?: number;
}

export interface SentDonorPrecheck {
  contactId: string;
  contactName: string;
  email: string;
  precheckSentAt: Date;
  confirmationToken: string;
  confirmationTokenExpiresAt: Date;
}

export interface SkippedDonorPrecheck {
  contactId: string;
  contactName: string;
  reason: 'no-email-on-file';
}

export interface SendDonorPrechecksResult {
  sent: SentDonorPrecheck[];
  skipped: SkippedDonorPrecheck[];
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Every distinct contact behind an eligible (remaining > 0) contribution in
 *  the space — the same population screen 6's issuance preview would offer
 *  a receipt to, since a pre-check makes no sense for a donor nothing will
 *  be issued to yet. Deliberately ignores `getSpaceIssuanceGate`: the
 *  pre-check is meant to go out "ahead of the window" (screens.md screen 6),
 *  while validation findings may still be open. */
async function eligibleSpaceContacts(
  prisma: PrismaClient,
  space: SpaceKey,
): Promise<{ id: string; name: string; email: string | null }[]> {
  const contributions = await prisma.contribution.findMany({
    where: {
      deletedInQomonAt: null,
      metadata: {
        is: { periodId: space.periodId, ridingNumber: space.ridingNumber, entityKind: space.entityKind },
      },
    },
    include: { metadata: true, contact: true, allocations: { include: { receipt: true } } },
  });

  const byContact = new Map<string, { id: string; name: string; email: string | null }>();
  for (const c of contributions) {
    if (!c.metadata) continue;
    const allocationRows: AllocationRow[] = c.allocations.map((a) => ({
      receiptId: a.receiptId,
      contributionId: a.contributionId,
      amountCents: a.amountCents,
      receiptStatus: a.receipt.status,
    }));
    const remaining = remainingEligibleCents(
      { id: c.id, amountCents: c.amountCents, nonDeductibleCents: c.metadata.nonDeductibleCents },
      allocationRows,
    );
    if (remaining <= 0) continue;
    byContact.set(c.contactId, { id: c.contactId, name: c.contact.name, email: c.contact.email });
  }
  return [...byContact.values()];
}

export async function sendDonorPrechecksForSpace(
  prisma: PrismaClient,
  input: SendDonorPrechecksInput,
): Promise<SendDonorPrechecksResult> {
  const period = await prisma.period.findUniqueOrThrow({ where: { id: input.periodId } });
  const year = contributionYear(period.startsAt);
  const expiresInDays = input.expiresInDays ?? 30;

  const contacts = await eligibleSpaceContacts(prisma, {
    periodId: input.periodId,
    ridingNumber: input.ridingNumber,
    entityKind: input.entityKind,
  });

  const sent: SentDonorPrecheck[] = [];
  const skipped: SkippedDonorPrecheck[] = [];

  for (const contact of contacts) {
    if (!contact.email) {
      skipped.push({ contactId: contact.id, contactName: contact.name, reason: 'no-email-on-file' });
      continue;
    }

    const precheckSentAt = new Date();
    const confirmationToken = generateToken();
    const confirmationTokenExpiresAt = new Date(precheckSentAt.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

    const pref = await withChangeLog(
      prisma,
      { userId: input.actorUserId, reason: input.reason },
      async (ctx) => {
        const before = await ctx.tx.donorCyclePreference.findUnique({
          where: { contactId_year: { contactId: contact.id, year } },
        });
        const after = await ctx.tx.donorCyclePreference.upsert({
          where: { contactId_year: { contactId: contact.id, year } },
          create: {
            contactId: contact.id,
            year,
            precheckSentAt,
            confirmationToken,
            confirmationTokenExpiresAt,
            confirmationPeriodId: input.periodId,
          },
          update: {
            precheckSentAt,
            confirmationToken,
            confirmationTokenExpiresAt,
            confirmationPeriodId: input.periodId,
          },
        });
        await ctx.log({ subjectType: 'DonorCyclePreference', subjectId: after.id, before, after });
        return after;
      },
    );

    sent.push({
      contactId: contact.id,
      contactName: contact.name,
      email: contact.email,
      precheckSentAt: pref.precheckSentAt!,
      confirmationToken: pref.confirmationToken!,
      confirmationTokenExpiresAt: pref.confirmationTokenExpiresAt!,
    });
  }

  return { sent, skipped };
}

export interface ConfirmDonorPrecheckInput {
  token: string;
  delivery: ReceiptDelivery;
  /** the donor's address as they confirmed it (as-is, or corrected) — always
   *  written as a new `AddressSnapshot`, never back onto `Contact.addresses`
   *  (see module doc: no unauthenticated write path onto the Qomon-synced
   *  record). */
  address: {
    line1: string;
    line2?: string;
    city: string;
    province: string;
    postalCode: string;
    country?: string;
  };
}

export interface ConfirmedDonorPrecheck {
  contactId: string;
  year: number;
  delivery: ReceiptDelivery;
  addressConfirmedAt: Date;
  addressSnapshotId: string;
}

/** The donor-facing half: no session, no CASL — the token itself is the
 *  credential, exactly as V4 describes ("tied to my email"). Single-use: the
 *  token is cleared on success, so a replayed or forwarded link 404s instead
 *  of silently re-confirming. */
export async function confirmDonorPrecheck(
  prisma: PrismaClient,
  input: ConfirmDonorPrecheckInput,
): Promise<ConfirmedDonorPrecheck> {
  const existing = await prisma.donorCyclePreference.findUnique({
    where: { confirmationToken: input.token },
  });
  if (!existing) throw new DonorPrecheckTokenNotFoundError();
  if (!existing.confirmationTokenExpiresAt || existing.confirmationTokenExpiresAt < new Date()) {
    throw new DonorPrecheckTokenExpiredError();
  }
  // set alongside confirmationToken by sendDonorPrechecksForSpace; a token
  // can't exist without it.
  const periodId = existing.confirmationPeriodId!;

  const addressConfirmedAt = new Date();

  const result = await withChangeLog(
    prisma,
    { userId: null, reason: 'donor pre-check confirmation' },
    async (ctx) => {
      const snapshot = await ctx.tx.addressSnapshot.create({
        data: {
          contactId: existing.contactId,
          periodId,
          line1: input.address.line1,
          line2: input.address.line2,
          city: input.address.city,
          province: input.address.province,
          postalCode: input.address.postalCode,
          country: input.address.country ?? 'CA',
          source: 'donor-precheck',
        },
      });
      await ctx.log({ subjectType: 'AddressSnapshot', subjectId: snapshot.id, after: snapshot });

      // Guarded by the token, not the id: a concurrent request (a replayed or
      // double-clicked link) that already consumed this token races here and
      // gets `count === 0` instead of silently re-confirming — this is what
      // makes the token single-use rather than merely single-display.
      const { count } = await ctx.tx.donorCyclePreference.updateMany({
        where: { confirmationToken: input.token },
        data: {
          delivery: input.delivery,
          addressConfirmedAt,
          confirmationToken: null,
          confirmationTokenExpiresAt: null,
          confirmationPeriodId: null,
        },
      });
      if (count === 0) throw new DonorPrecheckTokenNotFoundError();

      const after = await ctx.tx.donorCyclePreference.findUniqueOrThrow({ where: { id: existing.id } });
      await ctx.log({ subjectType: 'DonorCyclePreference', subjectId: after.id, before: existing, after });

      return { after, snapshotId: snapshot.id };
    },
  );

  return {
    contactId: result.after.contactId,
    year: result.after.year,
    delivery: result.after.delivery,
    addressConfirmedAt,
    addressSnapshotId: result.snapshotId,
  };
}
