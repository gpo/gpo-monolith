import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureContact, fixtureWrite, makeContribution, resetDb, seedBaseline, testPrisma } from '../test/db.js';
import {
  ContactOwnedByQomonError,
  ContactWriteError,
  createContact,
  PossibleDuplicateContactError,
  updateContact,
  type ContactInput,
} from './write.js';

const prisma = testPrisma();

const ADA: ContactInput = {
  firstName: ' Ada ',
  lastName: 'Lovelace',
  email: 'ada@example.org',
  address: { housenumber: '12', street: 'Queen St', city: 'Guelph', state: 'on', postalcode: 'n1h 1a1', country: 'ca' },
};

async function contactEntries(contactId: string) {
  return prisma.changeLogEntry.findMany({ where: { subjectType: 'Contact', subjectId: contactId }, orderBy: { at: 'asc' } });
}

describe('contact writes (D13)', () => {
  let actorUserId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    actorUserId = (await seedBaseline(prisma)).adminUserId;
  });

  describe('with no Qomon configured, the tool owns its contacts', () => {
    it('adds a contributor with no Qomon link and logs the creation with the actor and reason', async () => {
      const contact = await createContact({ prisma }, { actorUserId, reason: 'walk-in cheque', contact: ADA });

      expect(contact).toMatchObject({
        qomonContactId: null,
        name: 'Ada Lovelace',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.org',
        contributorType: 'INDIVIDUAL',
      });
      expect(contact.addresses).toEqual([
        { housenumber: '12', street: 'Queen St', city: 'Guelph', state: 'ON', postalcode: 'N1H 1A1', country: 'CA' },
      ]);
      const [entry] = await contactEntries(contact.id);
      expect(entry).toMatchObject({ actorUserId, reason: 'walk-in cheque', before: null });
      expect(entry!.after).toMatchObject({ name: 'Ada Lovelace', qomonContactId: null });
    });

    it('edits a contributor and logs before and after', async () => {
      const contact = await createContact({ prisma }, { actorUserId, reason: 'new donor', contact: ADA });
      const updated = await updateContact(
        { prisma },
        { actorUserId, reason: 'moved', contactId: contact.id, contact: { ...ADA, address: { ...ADA.address!, street: 'King St' } } },
      );

      expect(updated.addresses).toEqual([expect.objectContaining({ street: 'King St' })]);
      const entries = await contactEntries(contact.id);
      expect(entries).toHaveLength(2);
      expect(entries[1]).toMatchObject({ reason: 'moved', actorUserId });
      expect(entries[1]!.before).toMatchObject({ addresses: [expect.objectContaining({ street: 'Queen St' })] });
      expect(entries[1]!.after).toMatchObject({ addresses: [expect.objectContaining({ street: 'King St' })] });
    });

    it('refuses an edit that changes nothing, a blank name, and an incomplete address', async () => {
      const contact = await createContact({ prisma }, { actorUserId, reason: 'new donor', contact: ADA });
      await expect(
        updateContact({ prisma }, { actorUserId, reason: 'no-op', contactId: contact.id, contact: ADA }),
      ).rejects.toThrow('nothing to change');
      await expect(
        createContact({ prisma }, { actorUserId, reason: 'x', contact: { ...ADA, lastName: '  ' } }),
      ).rejects.toBeInstanceOf(ContactWriteError);
      await expect(
        createContact({ prisma }, { actorUserId, reason: 'x', contact: { ...ADA, address: { ...ADA.address!, city: '' } } }),
      ).rejects.toThrow('the address needs a city');
    });

    it('stops at a likely duplicate (same email, or same name and postal code) until confirmed', async () => {
      await createContact({ prisma }, { actorUserId, reason: 'first', contact: ADA });

      // a spouse sharing the email
      const spouse = { ...ADA, firstName: 'William', lastName: 'King' };
      await expect(createContact({ prisma }, { actorUserId, reason: 'x', contact: spouse })).rejects.toBeInstanceOf(
        PossibleDuplicateContactError,
      );
      // the same person typed again with no email
      const again = { ...ADA, firstName: 'ada', email: null, address: { ...ADA.address!, postalcode: 'N1H1A1' } };
      await expect(createContact({ prisma }, { actorUserId, reason: 'x', contact: again })).rejects.toThrow(
        'Ada Lovelace (ada@example.org)',
      );
      // same name elsewhere is a different person
      const namesake = { ...ADA, email: null, address: { ...ADA.address!, postalcode: 'K1A 0A6' } };
      await expect(createContact({ prisma }, { actorUserId, reason: 'x', contact: namesake })).resolves.toBeTruthy();

      const confirmed = await createContact({ prisma }, { actorUserId, reason: 'spouse', contact: spouse, allowDuplicate: true });
      expect(confirmed.name).toBe('William King');
    });

    it('refuses to edit a Qomon contact while Qomon is not configured', async () => {
      const linked = await fixtureContact(prisma, { data: { name: 'Q Donor', firstName: 'Q', lastName: 'Donor', qomonContactId: 7n } });
      await expect(
        updateContact({ prisma }, { actorUserId, reason: 'fix', contactId: linked.id, contact: { ...ADA } }),
      ).rejects.toBeInstanceOf(ContactOwnedByQomonError);
    });

    it('refuses to edit a merged-away contact', async () => {
      const survivor = await createContact({ prisma }, { actorUserId, reason: 'new', contact: ADA });
      const dup = await fixtureContact(prisma, {
        data: { name: 'Ada L', firstName: 'Ada', lastName: 'L', mergedIntoId: survivor.id, mergedAt: new Date() },
      });
      await expect(
        updateContact({ prisma }, { actorUserId, reason: 'fix', contactId: dup.id, contact: ADA }),
      ).rejects.toThrow('merged into another contact');
    });

    it("re-runs validation on the contributor's active contributions after an edit", async () => {
      const contact = await createContact({ prisma }, { actorUserId, reason: 'new donor', contact: ADA });
      const { contributionId } = await makeContribution(prisma, { contactId: contact.id, amountCents: 5_000 });
      // give it a period, or validation has nothing to run against
      await fixtureWrite(prisma, (tx) =>
        tx.contribution.update({ where: { id: contributionId }, data: { periodId: 67, entityKind: 'PARTY', receivedBy: 'GPO' } }),
      );

      await updateContact(
        { prisma },
        {
          actorUserId,
          reason: 'moved to BC',
          contactId: contact.id,
          contact: { ...ADA, address: { ...ADA.address!, city: 'Vancouver', state: 'BC', postalcode: 'V6B 1A1' } },
        },
      );
      const findings = await prisma.workItem.findMany({ where: { subjectId: contributionId, ruleRef: 'B1', status: 'OPEN' } });
      expect(findings).toHaveLength(1);
    });
  });

  describe('with Qomon configured, Qomon owns them', () => {
    it('creates the contributor in Qomon first, then mirrors it with its Qomon id', async () => {
      const qomon = new InMemoryQomon();
      const contact = await createContact({ prisma, qomon }, { actorUserId, reason: 'new donor by phone', contact: ADA });

      expect(contact.qomonContactId).not.toBeNull();
      const inQomon = await qomon.getContact(Number(contact.qomonContactId));
      expect(inQomon).toMatchObject({ firstname: 'Ada', surname: 'Lovelace', mail: 'ada@example.org' });
      expect(inQomon.address).toMatchObject({ street: 'Queen St', postalcode: 'N1H 1A1' });
      expect(contact).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.org' });
      expect(contact.lastSyncedAt).not.toBeNull();

      const [entry] = await contactEntries(contact.id);
      expect(entry).toMatchObject({ actorUserId, reason: 'new donor by phone', before: null });
    });

    it('writes nothing locally when Qomon refuses the contact', async () => {
      const qomon = new InMemoryQomon();
      // the fake, like Qomon, refuses a contact with no surname
      const refusing = {
        createContact: () => qomon.createContact({ firstname: 'Ada' }),
        getContact: (id: number) => qomon.getContact(id),
        updateContact: (id: number, changes: object) => qomon.updateContact(id, changes),
      };
      await expect(createContact({ prisma, qomon: refusing }, { actorUserId, reason: 'x', contact: ADA })).rejects.toThrow(
        'firstname and surname required',
      );
      expect(await prisma.contact.count()).toBe(0);
    });

    it('writes only the changed fields to Qomon, keeping what Qomon holds beyond them, and logs the edit', async () => {
      const qomon = new InMemoryQomon();
      const contact = await createContact({ prisma, qomon }, { actorUserId, reason: 'new', contact: ADA });
      const qomonId = Number(contact.qomonContactId);
      // changed in Qomon since: a phone number the tool does not model, and
      // a new email the local copy has not seen yet
      await qomon.updateContact(qomonId, { phone: '519-555-0100', mail: 'ada@new.example.org' });

      const updated = await updateContact(
        { prisma, qomon },
        { actorUserId, reason: 'married name', contactId: contact.id, contact: { ...ADA, lastName: 'King' } },
      );

      const inQomon = await qomon.getContact(qomonId);
      expect(inQomon).toMatchObject({ surname: 'King', phone: '519-555-0100', mail: 'ada@new.example.org' });
      // the mirror is what Qomon now holds, including the email changed there
      expect(updated).toMatchObject({ name: 'Ada King', lastName: 'King', email: 'ada@new.example.org' });
      const entries = await contactEntries(contact.id);
      expect(entries[1]).toMatchObject({ reason: 'married name', actorUserId });
      expect(entries[1]!.before).toMatchObject({ lastName: 'Lovelace' });
      expect(entries[1]!.after).toMatchObject({ lastName: 'King' });
    });

    it('edits a tool-owned contact locally even when Qomon is configured', async () => {
      const qomon = new InMemoryQomon();
      const local = await createContact({ prisma }, { actorUserId, reason: 'before Qomon was set up', contact: ADA });
      const updated = await updateContact(
        { prisma, qomon },
        { actorUserId, reason: 'typo', contactId: local.id, contact: { ...ADA, firstName: 'Augusta' } },
      );
      expect(updated).toMatchObject({ qomonContactId: null, firstName: 'Augusta' });
    });
  });

  it('the database refuses a contact write outside a change-logged transaction (invariant 5)', async () => {
    await expect(prisma.contact.create({ data: { name: 'Sneaky' } })).rejects.toThrow(/invariant 5/);
    const c = await fixtureContact(prisma, { data: { name: 'Dana' } });
    await expect(prisma.contact.update({ where: { id: c.id }, data: { name: 'Dana X' } })).rejects.toThrow(/invariant 5/);
  });

  it('the database refuses to hard-delete a contact (invariant 4)', async () => {
    const c = await fixtureContact(prisma, { data: { name: 'Dana' } });
    await expect(prisma.contact.delete({ where: { id: c.id } })).rejects.toThrow(/invariant/);
  });
});
