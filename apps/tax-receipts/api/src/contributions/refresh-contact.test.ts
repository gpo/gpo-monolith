import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { ContributionNotFoundError } from './metadata-edit.js';
import { refreshContributionContact } from './refresh-contact.js';

const prisma = testPrisma();

describe('refreshContributionContact (D12: contacts stay Qomon-owned)', () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await seedBaseline(prisma);
  });

  it('throws for an unknown contribution', async () => {
    await expect(refreshContributionContact(prisma, new InMemoryQomon(), 'nope')).rejects.toBeInstanceOf(
      ContributionNotFoundError,
    );
  });

  it('picks up an address corrected in Qomon after the first sync, and leaves the payment and contribution alone', async () => {
    const qomon = new InMemoryQomon();
    qomon.seedContact({
      id: 4,
      firstname: 'Wendy',
      surname: 'Waterloo',
      address: { street: 'Main St', city: 'Waterloo', postalcode: 'N2L6H5', country: 'CAN' },
    });
    const { contactId, contributionId, paymentId } = await makeContribution(prisma, {
      qomonContactId: 4n,
      qomonTransactionId: 4n,
      amountCents: 5_000,
    });
    await prisma.contact.update({
      where: { id: contactId },
      data: { addresses: [{ city: 'Waterloo', postalcode: 'N2L6H5', country: 'CAN' }] },
    });

    await expect(refreshContributionContact(prisma, qomon, contributionId)).resolves.toBe('refreshed');

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect((contact.addresses as Array<{ street?: string }>)[0]).toMatchObject({ street: 'Main St' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).amountCents).toBe(5_000);
    expect((await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } })).amountCents).toBe(5_000);
  });

  it('tolerates a contact that no longer exists in Qomon', async () => {
    // contact 5 was never seeded in Qomon, so getContact 404s
    const { contributionId } = await makeContribution(prisma, { qomonContactId: 5n, qomonTransactionId: 5n, amountCents: 100 });
    await expect(refreshContributionContact(prisma, new InMemoryQomon(), contributionId)).resolves.toBe(
      'not-found-in-qomon',
    );
  });

  it('is a no-op for a contact with no Qomon link (development and testing)', async () => {
    const { contributionId } = await makeContribution(prisma, { amountCents: 100 });
    await expect(refreshContributionContact(prisma, new InMemoryQomon(), contributionId)).resolves.toBe('not-linked');
  });
});
