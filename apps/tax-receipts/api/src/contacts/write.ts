import type { QomonApi, QomonContact } from '@gpo/qomon-client';
import { withChangeLog } from '../changelog/write.js';
import { runValidationForContribution } from '../validation/run.js';
import type { Contact, Prisma, PrismaClient } from '../generated/prisma/index.js';
import { addressFrom } from './address.js';

/**
 * The one write path for contributors (D13; EO evaluation rows 19 to 22).
 * `contact` is a guarded table (invariant 5), so every insert and update,
 * whatever started it, runs inside `withChangeLog` and leaves a `Contact`
 * change-log entry with the actor, reason, before, and after.
 *
 * Who owns a contact depends on whether a Qomon space is configured:
 *
 *  - **No Qomon** (`qomon` absent): the tool owns its contacts. Adding one
 *    inserts a row with no Qomon link; editing one updates the row.
 *  - **Qomon configured**: Qomon owns them. Adding one creates it in Qomon
 *    first and mirrors what Qomon then holds; editing a Qomon-linked contact
 *    writes the changed fields to Qomon first and mirrors the result. If
 *    Qomon refuses, nothing is written here.
 *
 * Two edge cases follow from that. A Qomon-linked contact cannot be edited
 * while Qomon is not configured (the next refresh would undo the edit), and
 * a contact with no Qomon link (made before Qomon was configured, or a
 * fixture) stays tool-owned and is edited locally either way.
 */

export class ContactNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(contactId: string) {
    super(`no contact ${contactId}`);
    this.name = 'ContactNotFoundError';
  }
}

export class ContactWriteError extends Error {
  readonly statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = 'ContactWriteError';
  }
}

export class ContactOwnedByQomonError extends Error {
  readonly statusCode = 409;
  constructor(name: string) {
    super(`${name} is a Qomon contact and Qomon is not configured here, so it cannot be edited in the tool; edit it in Qomon`);
    this.name = 'ContactOwnedByQomonError';
  }
}

/** Raised by {@link createContact} when the new contributor looks like one
 *  already on file (rule B4's matches: same email, or same name and postal
 *  code). Not a refusal: two people can share an email, so the caller can
 *  confirm and retry with `allowDuplicate`. */
export class PossibleDuplicateContactError extends Error {
  readonly statusCode = 409;
  constructor(readonly matches: Array<{ id: string; name: string; email: string | null }>) {
    super(
      `this may be a contributor already on file: ${matches
        .map((m) => (m.email ? `${m.name} (${m.email})` : m.name))
        .join(', ')}. Check the existing record, or confirm this is a different person`,
    );
    this.name = 'PossibleDuplicateContactError';
  }
}

/** A mailing address in Qomon's shape, which is also how `Contact.addresses`
 *  stores it (contacts/address.ts). */
export interface ContactAddressInput {
  housenumber: string | null;
  street: string;
  city: string;
  /** province or state, e.g. "ON" */
  state: string;
  postalcode: string;
  country: string;
}

export interface ContactInput {
  firstName: string;
  lastName: string;
  email: string | null;
  address: ContactAddressInput | null;
}

export interface ContactWriteDeps {
  prisma: PrismaClient;
  /** the party Qomon space; absent means contacts are tool-owned */
  qomon?: Pick<QomonApi, 'createContact' | 'updateContact' | 'getContact'>;
}

export type ContactSource = 'qomon' | 'tool';

/** Where a new contact will be created, for the form to say so up front. */
export function contactSource(deps: Pick<ContactWriteDeps, 'qomon'>): ContactSource {
  return deps.qomon ? 'qomon' : 'tool';
}

/** The local columns for a contact as Qomon holds it. */
export function contactFieldsFromQomon(fetched: QomonContact, qomonContactId: number) {
  return {
    name: qomonDisplayName(fetched, qomonContactId),
    // Kept alongside `name` (ticket 4.1): the ALL/S2P2 EO reports need
    // Contributor_First_Name / Contributor_Last_Name as separate columns,
    // which the joined display name can't supply back apart.
    firstName: fetched.firstname?.trim() || null,
    lastName: fetched.surname?.trim() || null,
    email: fetched.mail ?? null,
    addresses: (fetched.address ? [fetched.address] : []) as Prisma.InputJsonValue,
  };
}

function qomonDisplayName(c: QomonContact, fallbackId: number): string {
  const parts = [c.firstname, c.surname].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(' ') : `Qomon contact ${fallbackId}`;
}

function normalize(input: ContactInput): ContactInput {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ContactWriteError('a contributor needs a first and a last name');
  const email = input.email?.trim() || null;
  let address: ContactAddressInput | null = null;
  if (input.address) {
    const a = input.address;
    address = {
      housenumber: a.housenumber?.trim() || null,
      street: a.street.trim(),
      city: a.city.trim(),
      state: a.state.trim().toUpperCase(),
      postalcode: a.postalcode.trim().toUpperCase().replace(/\s+/g, ' '),
      country: a.country.trim().toUpperCase(),
    };
    const missing = [
      !address.street && 'a street',
      !address.city && 'a city',
      !address.state && 'a province',
      !address.postalcode && 'a postal code',
      !address.country && 'a country',
    ].filter((f): f is string => f !== false);
    if (missing.length > 0) throw new ContactWriteError(`the address needs ${missing.join(', ')}`);
  }
  return { firstName, lastName, email, address };
}

function localFields(input: ContactInput) {
  return {
    name: `${input.firstName} ${input.lastName}`,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    addresses: (input.address ? [{ ...input.address }] : []) satisfies Prisma.InputJsonValue,
  };
}

/** The input as Qomon fields. A null address is left out rather than sent
 *  as null: clearing a Qomon address from here is not supported. */
function qomonFields(input: Partial<ContactInput>): Partial<QomonContact> {
  const out: Partial<QomonContact> = {};
  if (input.firstName !== undefined) out.firstname = input.firstName;
  if (input.lastName !== undefined) out.surname = input.lastName;
  if (input.email !== undefined) out.mail = input.email;
  if (input.address) out.address = { ...input.address };
  return out;
}

/** The current contact as a `ContactInput`, to diff an edit against. */
function asInput(contact: Contact): ContactInput {
  const a = addressFrom(contact.addresses);
  return {
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    email: contact.email,
    address: a
      ? {
          housenumber: a.housenumber ?? null,
          street: a.street ?? '',
          city: a.city ?? '',
          state: a.state ?? '',
          postalcode: a.postalcode ?? '',
          country: a.country ?? '',
        }
      : null,
  };
}

function changedFields(before: ContactInput, after: ContactInput): Partial<ContactInput> {
  const changes: Partial<ContactInput> = {};
  if (before.firstName !== after.firstName) changes.firstName = after.firstName;
  if (before.lastName !== after.lastName) changes.lastName = after.lastName;
  if (before.email !== after.email) changes.email = after.email;
  if (JSON.stringify(before.address) !== JSON.stringify(after.address)) changes.address = after.address;
  return changes;
}

async function findLikelyDuplicates(prisma: PrismaClient, contact: ContactInput) {
  const or: Prisma.ContactWhereInput[] = [];
  if (contact.email) or.push({ email: { equals: contact.email, mode: 'insensitive' } });
  if (contact.address) {
    or.push({
      firstName: { equals: contact.firstName, mode: 'insensitive' },
      lastName: { equals: contact.lastName, mode: 'insensitive' },
    });
  }
  if (or.length === 0) return [];
  const candidates = await prisma.contact.findMany({
    where: { mergedIntoId: null, OR: or },
    select: { id: true, name: true, email: true, addresses: true },
    take: 10,
  });
  const postal = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, '').toUpperCase();
  return candidates
    .filter(
      (c) =>
        (contact.email && c.email?.toLowerCase() === contact.email.toLowerCase()) ||
        (contact.address && postal(addressFrom(c.addresses)?.postalcode) === postal(contact.address.postalcode)),
    )
    .map(({ id, name, email }) => ({ id, name, email }));
}

/** Add a contributor (row 21 and 22). Checks for a likely duplicate first
 *  (data-model §5: B4 runs before the Qomon create), unless the caller has
 *  confirmed this is a different person. */
export async function createContact(
  deps: ContactWriteDeps,
  input: { actorUserId: string; reason: string; contact: ContactInput; allowDuplicate?: boolean },
): Promise<Contact> {
  const contact = normalize(input.contact);
  const actor = { userId: input.actorUserId, reason: input.reason };

  if (!input.allowDuplicate) {
    const matches = await findLikelyDuplicates(deps.prisma, contact);
    if (matches.length > 0) throw new PossibleDuplicateContactError(matches);
  }

  if (deps.qomon) {
    // Qomon first: if it refuses, nothing is written here
    const { id } = await deps.qomon.createContact(qomonFields(contact));
    const fetched = await deps.qomon.getContact(id);
    return mirrorQomonContact(deps.prisma, { ...actor, qomonContactId: id, fetched });
  }

  return withChangeLog(deps.prisma, actor, async (ctx) => {
    const created = await ctx.tx.contact.create({ data: localFields(contact) });
    await ctx.log({ subjectType: 'Contact', subjectId: created.id, after: created });
    return created;
  });
}

/** Edit a contributor's name, email, or address. Re-runs validation on their
 *  active contributions, since the address drives rules such as B1. */
export async function updateContact(
  deps: ContactWriteDeps,
  input: { actorUserId: string; reason: string; contactId: string; contact: ContactInput },
): Promise<Contact> {
  const current = await deps.prisma.contact.findUnique({ where: { id: input.contactId } });
  if (!current) throw new ContactNotFoundError(input.contactId);
  if (current.mergedIntoId) {
    throw new ContactWriteError(`${current.name} was merged into another contact; edit the surviving contact`);
  }
  const next = normalize(input.contact);
  const changes = changedFields(asInput(current), next);
  if (Object.keys(changes).length === 0) throw new ContactWriteError('nothing to change');
  const actor = { userId: input.actorUserId, reason: input.reason };

  let updated: Contact;
  if (current.qomonContactId !== null) {
    if (!deps.qomon) throw new ContactOwnedByQomonError(current.name);
    if (changes.address === null) {
      throw new ContactWriteError("a Qomon contact's address cannot be removed from the tool; correct it instead");
    }
    // only the fields this edit changed, so a stale local copy never
    // overwrites something changed in Qomon since the last refresh
    const qomonContactId = Number(current.qomonContactId);
    const fetched = await deps.qomon.updateContact(qomonContactId, qomonFields(changes));
    updated = await mirrorQomonContact(deps.prisma, { ...actor, qomonContactId, fetched });
  } else {
    updated = await withChangeLog(deps.prisma, actor, async (ctx) => {
      const row = await ctx.tx.contact.update({ where: { id: current.id }, data: localFields(next) });
      await ctx.log({ subjectType: 'Contact', subjectId: row.id, before: current, after: row });
      return row;
    });
  }

  await revalidateContact(deps.prisma, updated.id);
  return updated;
}

/**
 * Store a contact as Qomon holds it, creating the local row the first time
 * and overwriting it after that. Used by the import sweep (a system actor),
 * the "refresh donor from Qomon" action, and the two Qomon-first writes
 * above, so a contact that changed by any of those routes has its entry.
 */
export async function mirrorQomonContact(
  prisma: PrismaClient,
  input: {
    userId: string | null;
    reason: string;
    qomonContactId: number;
    fetched: QomonContact;
  },
): Promise<Contact> {
  const qomonContactId = BigInt(input.qomonContactId);
  const fields = { ...contactFieldsFromQomon(input.fetched, input.qomonContactId), lastSyncedAt: new Date() };
  return withChangeLog(prisma, { userId: input.userId, reason: input.reason }, async (ctx) => {
    const before = await ctx.tx.contact.findUnique({ where: { qomonContactId } });
    const after = before
      ? await ctx.tx.contact.update({ where: { id: before.id }, data: fields })
      : await ctx.tx.contact.create({ data: { qomonContactId, ...fields } });
    await ctx.log({ subjectType: 'Contact', subjectId: after.id, before: before ?? undefined, after });
    return after;
  });
}

/** Re-run the rule registry over a contact's active contributions. */
export async function revalidateContact(prisma: PrismaClient, contactId: string): Promise<void> {
  const contributions = await prisma.contribution.findMany({
    where: { contactId, status: 'ACTIVE' },
    select: { id: true },
  });
  for (const c of contributions) await runValidationForContribution(prisma, c.id);
}
