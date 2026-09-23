import { beforeEach, describe, expect, it } from 'vitest';
import { withChangeLog } from '../changelog/write.js';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  DonorPrecheckTokenExpiredError,
  DonorPrecheckTokenNotFoundError,
  confirmDonorPrecheck,
  sendDonorPrechecksForSpace,
} from './precheck.js';

const prisma = testPrisma();

describe('donor pre-check (ticket 3.9, story V4)', () => {
  let baseline: Awaited<ReturnType<typeof seedBaseline>>;

  beforeEach(async () => {
    await resetDb(prisma);
    baseline = await seedBaseline(prisma);
  });

  async function seedMetadata(contributionId: string, overrides: Record<string, unknown> = {}) {
    return withChangeLog(prisma, { userId: baseline.cfoUserId, reason: 'seed metadata' }, async (ctx) => {
      const after = await ctx.tx.contributionMetadata.create({
        data: { contributionId, periodId: baseline.periodId, entityKind: 'PARTY', receivedBy: 'GPO', ...overrides },
      });
      await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contributionId, after });
      return after;
    });
  }

  it('sends a pre-check to every eligible donor with an email on file, and records the send', async () => {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 1n,
      qomonTransactionId: 1n,
      amountCents: 5_000,
    });
    await seedMetadata(contributionId);

    const result = await sendDonorPrechecksForSpace(prisma, {
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      actorUserId: baseline.adminUserId,
      reason: 'annual pre-check window opens',
    });

    expect(result.skipped).toEqual([]);
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]!.contactId).toBe(contactId);
    expect(result.sent[0]!.confirmationToken).toBeTruthy();

    const pref = await prisma.donorCyclePreference.findUnique({
      where: { contactId_year: { contactId, year: 2026 } },
    });
    expect(pref?.precheckSentAt).toBeInstanceOf(Date);
    expect(pref?.confirmationToken).toBe(result.sent[0]!.confirmationToken);
    expect(pref?.confirmationPeriodId).toBe(baseline.periodId);

    const entries = await prisma.changeLogEntry.findMany({
      where: { subjectType: 'DonorCyclePreference', subjectId: pref!.id },
    });
    expect(entries).toHaveLength(1);
  });

  it('skips a donor with no email on file rather than failing the whole space', async () => {
    const { contact, contributionId } = await (async () => {
      const c = await prisma.contact.create({
        data: { qomonContactId: 2n, name: 'No Email Ned', email: null },
      });
      const contribution = await prisma.contribution.create({
        data: { qomonTransactionId: 2n, contactId: c.id, amountCents: 5_000, acceptedAt: new Date('2026-03-01T12:00:00Z') },
      });
      return { contact: c, contributionId: contribution.id };
    })();
    await seedMetadata(contributionId);

    const result = await sendDonorPrechecksForSpace(prisma, {
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      actorUserId: baseline.adminUserId,
      reason: 'annual pre-check window opens',
    });

    expect(result.sent).toEqual([]);
    expect(result.skipped).toEqual([{ contactId: contact.id, contactName: 'No Email Ned', reason: 'no-email-on-file' }]);
  });

  it('does not pre-check a donor whose contribution is already fully receipted', async () => {
    const { contributionId } = await makeContribution(prisma, {
      qomonContactId: 3n,
      qomonTransactionId: 3n,
      amountCents: 5_000,
    });
    await seedMetadata(contributionId, { nonDeductibleCents: 5_000 }); // fully non-deductible -> nothing remains

    const result = await sendDonorPrechecksForSpace(prisma, {
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      actorUserId: baseline.adminUserId,
      reason: 'annual pre-check window opens',
    });

    expect(result.sent).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  async function sendOnePrecheck() {
    const { contactId, contributionId } = await makeContribution(prisma, {
      qomonContactId: 4n,
      qomonTransactionId: 4n,
      amountCents: 5_000,
    });
    await seedMetadata(contributionId);
    const result = await sendDonorPrechecksForSpace(prisma, {
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      actorUserId: baseline.adminUserId,
      reason: 'annual pre-check window opens',
    });
    return { contactId, token: result.sent[0]!.confirmationToken };
  }

  it('confirms the donor address and delivery preference, and stores a new AddressSnapshot', async () => {
    const { contactId, token } = await sendOnePrecheck();

    const confirmed = await confirmDonorPrecheck(prisma, {
      token,
      delivery: 'EMAIL',
      address: { line1: '42 Wallaby Way', city: 'Ottawa', province: 'ON', postalCode: 'K1A0A1' },
    });

    expect(confirmed.contactId).toBe(contactId);
    expect(confirmed.delivery).toBe('EMAIL');

    const pref = await prisma.donorCyclePreference.findUnique({
      where: { contactId_year: { contactId, year: 2026 } },
    });
    expect(pref?.delivery).toBe('EMAIL');
    expect(pref?.addressConfirmedAt).toBeInstanceOf(Date);
    expect(pref?.confirmationToken).toBeNull();
    expect(pref?.confirmationPeriodId).toBeNull();

    const snapshot = await prisma.addressSnapshot.findUnique({ where: { id: confirmed.addressSnapshotId } });
    expect(snapshot?.source).toBe('donor-precheck');
    expect(snapshot?.city).toBe('Ottawa');
    expect(snapshot?.periodId).toBe(baseline.periodId);
  });

  it('leaves an unconfirmed donor defaulted to MAIL', async () => {
    const { contactId } = await sendOnePrecheck();
    const pref = await prisma.donorCyclePreference.findUnique({
      where: { contactId_year: { contactId, year: 2026 } },
    });
    expect(pref?.delivery).toBe('MAIL');
    expect(pref?.addressConfirmedAt).toBeNull();
  });

  it('404s an unknown token', async () => {
    await expect(
      confirmDonorPrecheck(prisma, {
        token: 'not-a-real-token',
        delivery: 'MAIL',
        address: { line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1' },
      }),
    ).rejects.toBeInstanceOf(DonorPrecheckTokenNotFoundError);
  });

  it('rejects a token that has already been used (single-use)', async () => {
    const { token } = await sendOnePrecheck();
    await confirmDonorPrecheck(prisma, {
      token,
      delivery: 'EMAIL',
      address: { line1: '42 Wallaby Way', city: 'Ottawa', province: 'ON', postalCode: 'K1A0A1' },
    });

    await expect(
      confirmDonorPrecheck(prisma, {
        token,
        delivery: 'MAIL',
        address: { line1: '42 Wallaby Way', city: 'Ottawa', province: 'ON', postalCode: 'K1A0A1' },
      }),
    ).rejects.toBeInstanceOf(DonorPrecheckTokenNotFoundError);
  });

  it('410s an expired token', async () => {
    const { token } = await sendOnePrecheck();
    await prisma.donorCyclePreference.update({
      where: { confirmationToken: token },
      data: { confirmationTokenExpiresAt: new Date('2000-01-01T00:00:00Z') },
    });

    await expect(
      confirmDonorPrecheck(prisma, {
        token,
        delivery: 'MAIL',
        address: { line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1' },
      }),
    ).rejects.toBeInstanceOf(DonorPrecheckTokenExpiredError);
  });

  it('re-sending a pre-check replaces the outstanding token rather than issuing a second one', async () => {
    const { contactId, token: firstToken } = await sendOnePrecheck();

    const second = await sendDonorPrechecksForSpace(prisma, {
      periodId: baseline.periodId,
      ridingNumber: null,
      entityKind: 'PARTY',
      actorUserId: baseline.adminUserId,
      reason: 're-send: bounced',
    });
    const secondToken = second.sent.find((s) => s.contactId === contactId)!.confirmationToken;

    expect(secondToken).not.toBe(firstToken);
    await expect(
      confirmDonorPrecheck(prisma, {
        token: firstToken,
        delivery: 'MAIL',
        address: { line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1' },
      }),
    ).rejects.toBeInstanceOf(DonorPrecheckTokenNotFoundError);
  });
});
