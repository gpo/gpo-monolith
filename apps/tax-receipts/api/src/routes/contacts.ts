import { QomonError, QomonValidationError, type QomonApi } from '@gpo/qomon-client';
import { remainingEligibleCents } from '@gpo/tax-receipts-core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { addressFrom, formatAddress } from '../contacts/address.js';
import {
  contactSource,
  createContact,
  PossibleDuplicateContactError,
  updateContact,
  type ContactWriteDeps,
} from '../contacts/write.js';
import type { Contact } from '../generated/prisma/index.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Contributors (D13; EO evaluation rows 20 to 23): search, view, add, and
 * edit. Reads need `read Contribution` (every signed-in user); adding needs
 * `create Contact` and editing `update Contact` (`contact.manage`).
 *
 * Where a new contributor is created depends on whether a Qomon space is
 * configured (`contacts/write.ts`); `GET /contacts/settings` tells the form
 * which, so it can say so before anything is saved.
 */

const AddressBody = z.object({
  housenumber: z.string().trim().max(20).nullish().transform((v) => v || null),
  street: z.string().trim().min(1, 'a street is required').max(200),
  city: z.string().trim().min(1, 'a city is required').max(100),
  state: z.string().trim().min(1, 'a province is required').max(50),
  postalcode: z.string().trim().min(1, 'a postal code is required').max(20),
  country: z.string().trim().min(1).max(50).default('CA'),
});

const ContactFields = z.object({
  reason: z.string().trim().min(3),
  firstName: z.string().trim().min(1, 'a first name is required').max(100),
  lastName: z.string().trim().min(1, 'a last name is required').max(100),
  email: z
    .string()
    .trim()
    .max(254)
    .nullish()
    .transform((v) => v || null)
    .pipe(z.string().email().nullable()),
  address: AddressBody.nullish().transform((v) => v ?? null),
});

const NewContactBody = ContactFields.extend({
  /** confirms a likely duplicate is a different person (rule B4) */
  allowDuplicate: z.boolean().optional(),
});

function serializeContact(c: Contact) {
  const address = addressFrom(c.addresses);
  return {
    id: c.id,
    name: c.name,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    contributorType: c.contributorType,
    /** the raw address, for the edit form */
    address: address
      ? {
          housenumber: address.housenumber ?? null,
          street: address.street ?? '',
          city: address.city ?? '',
          state: address.state ?? '',
          postalcode: address.postalcode ?? '',
          country: address.country ?? '',
        }
      : null,
    formattedAddress: formatAddress(c.addresses),
    qomonContactId: c.qomonContactId === null ? null : String(c.qomonContactId),
    /** `qomon` when Qomon owns this record, `tool` when the tool does */
    source: c.qomonContactId === null ? ('tool' as const) : ('qomon' as const),
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    mergedIntoId: c.mergedIntoId,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** A Qomon failure on a Qomon-first write: nothing was written locally. */
function sendQomonError(reply: FastifyReply, err: QomonError) {
  if (err instanceof QomonValidationError) {
    return reply.code(422).send({ error: `Qomon refused the contact: ${err.message}` });
  }
  return reply.code(502).send({ error: `Qomon could not be reached or failed: ${err.message}. Nothing was saved.` });
}

export async function contactRoutes(app: FastifyInstance, opts: { qomon?: QomonApi }): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const deps: ContactWriteDeps = { prisma: app.prisma, qomon: opts.qomon };

  r.get('/contacts/settings', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'authentication required' });
    return reply.send({ source: contactSource(deps) });
  });

  // The donor picker (payment entry, move, split, and merge) and the
  // Contributors list. Merged-away contacts are left out unless asked for:
  // nothing can be attributed to them any more.
  r.route({
    method: 'GET',
    url: '/contacts',
    schema: {
      querystring: z.object({
        // optional for the Contributors list; too short to be useful below two
        query: z.string().trim().min(2).optional(),
        includeMerged: z.enum(['true', 'false']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Contribution')) {
        return reply.code(403).send({ error: 'not permitted to read contributions' });
      }
      const { query, includeMerged, limit } = request.query;
      const rows = await app.prisma.contact.findMany({
        where: {
          ...(includeMerged === 'true' ? {} : { mergedIntoId: null }),
          ...(query
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { email: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { name: 'asc' },
        take: limit,
        select: { id: true, name: true, email: true, qomonContactId: true, mergedIntoId: true, addresses: true },
      });
      return reply.send({
        data: rows.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          qomonContactId: c.qomonContactId === null ? null : String(c.qomonContactId),
          mergedIntoId: c.mergedIntoId,
          formattedAddress: formatAddress(c.addresses),
        })),
      });
    },
  });

  r.route({
    method: 'GET',
    url: '/contacts/:id',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Contribution')) {
        return reply.code(403).send({ error: 'not permitted to read contributions' });
      }
      const contact = await app.prisma.contact.findUnique({ where: { id: request.params.id } });
      if (!contact) return reply.code(404).send({ error: `no contact ${request.params.id}` });

      const [contributions, changeLog] = await Promise.all([
        app.prisma.contribution.findMany({
          where: {
            contactId: contact.id,
            // a riding-scoped user sees party-level rows and their ridings
            ...(user.allRidings
              ? {}
              : { OR: [{ ridingNumber: null }, { ridingNumber: { in: user.ridingGrants } }] }),
          },
          orderBy: { acceptedAt: 'desc' },
          take: 200,
          select: {
            id: true,
            amountCents: true,
            nonDeductibleCents: true,
            acceptedAt: true,
            status: true,
            periodId: true,
            entityKind: true,
            ridingNumber: true,
            goodsServices: true,
            receivedBy: true,
            leadershipContestantId: true,
            allocations: { select: { receiptId: true, contributionId: true, amountCents: true, receipt: { select: { status: true } } } },
          },
        }),
        app.prisma.changeLogEntry.findMany({
          where: { subjectType: 'Contact', subjectId: contact.id },
          orderBy: { at: 'desc' },
          include: { actor: { select: { name: true } } },
        }),
      ]);

      return reply.send({
        ...serializeContact(contact),
        editable: contact.qomonContactId === null || deps.qomon !== undefined,
        contributions: contributions.map(({ allocations, nonDeductibleCents, ...c }) => ({
          ...c,
          acceptedAt: c.acceptedAt.toISOString(),
          // what a new receipt could still cover (invariant 1): drives the
          // "issue one receipt for these" selection (EO evaluation rows 43, 46)
          remainingCents: remainingEligibleCents(
            { id: c.id, amountCents: c.amountCents, nonDeductibleCents },
            allocations.map((a) => ({ ...a, receiptStatus: a.receipt.status })),
          ),
        })),
        changeLog: changeLog.map((e) => ({
          id: e.id,
          actorUserId: e.actorUserId,
          actorName: e.actor?.name ?? null,
          reason: e.reason,
          before: e.before,
          after: e.after,
          at: e.at.toISOString(),
          correlationId: e.correlationId,
        })),
      });
    },
  });

  r.route({
    method: 'POST',
    url: '/contacts',
    schema: { body: NewContactBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('create', 'Contact')) {
        return reply.code(403).send({ error: 'not permitted to add contributors' });
      }
      const { reason, allowDuplicate, ...contact } = request.body;
      try {
        const created = await createContact(deps, { actorUserId: user.id, reason, contact, allowDuplicate });
        return reply.code(201).send(serializeContact(created));
      } catch (err) {
        if (err instanceof QomonError) return sendQomonError(reply, err);
        if (err instanceof PossibleDuplicateContactError) {
          return reply.code(409).send({ error: err.message, duplicates: err.matches });
        }
        throw err;
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/contacts/:id',
    schema: { params: z.object({ id: z.string() }), body: ContactFields },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('update', 'Contact')) {
        return reply.code(403).send({ error: 'not permitted to edit contributors' });
      }
      const { reason, ...contact } = request.body;
      try {
        const updated = await updateContact(deps, {
          actorUserId: user.id,
          reason,
          contactId: request.params.id,
          contact,
        });
        return reply.send(serializeContact(updated));
      } catch (err) {
        if (err instanceof QomonError) return sendQomonError(reply, err);
        throw err;
      }
    },
  });
}
