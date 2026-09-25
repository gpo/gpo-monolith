import { GpoMetadataDescriptive, PaymentMethod } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  addContributionToPayment,
  enterManualPayment,
  previewIntake,
  type ContributionEntry,
} from '../payments/manual-entry.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Manual entry (D12): record a payment and attribute it to one or more
 * contributions, or attribute what is left of an existing payment later. The
 * intake preview shows what period and defaults the derivation would settle on
 * so the form can show them before anything is saved.
 *
 * `create Payment` is the party CFO and administrators (and sysadmin). A user
 * scoped to some ridings may enter only contributions for those ridings.
 */

const Overrides = GpoMetadataDescriptive.omit({ external_ref: true }).partial();

const EntryBody = z.object({
  amountCents: z.number().int().positive(),
  contactId: z.string().optional(),
  acceptedAt: z.coerce.date().optional(),
  note: z.string().nullish(),
  descriptive: Overrides.optional(),
});

const NewPaymentBody = z.object({
  reason: z.string().min(3),
  contactId: z.string(),
  amountCents: z.number().int().positive(),
  receivedAt: z.coerce.date(),
  method: PaymentMethod,
  payerName: z.string().nullish(),
  externalRef: z.string().nullish(),
  note: z.string().nullish(),
  contributions: z.array(EntryBody).min(1).optional(),
});

const AddContributionBody = EntryBody.extend({ reason: z.string().min(3) });

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  function outsideGrants(user: SessionUser, entries: Array<Pick<ContributionEntry, 'descriptive'>>): boolean {
    if (user.allRidings) return false;
    const grants = new Set(user.ridingGrants);
    return entries.some((e) => {
      const riding = e.descriptive?.riding_number;
      return riding != null && !grants.has(riding);
    });
  }

  r.route({
    method: 'POST',
    url: '/payments',
    schema: { body: NewPaymentBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('create', 'Payment')) {
        return reply.code(403).send({ error: 'not permitted to enter payments' });
      }
      const body = request.body;
      if (outsideGrants(user, body.contributions ?? [])) {
        return reply.code(403).send({ error: 'this entry is for a riding outside your grants' });
      }
      const result = await enterManualPayment(app.prisma, {
        actorUserId: user.id,
        reason: body.reason,
        contactId: body.contactId,
        amountCents: body.amountCents,
        receivedAt: body.receivedAt,
        method: body.method,
        payerName: body.payerName,
        externalRef: body.externalRef,
        note: body.note,
        contributions: body.contributions,
      });
      return reply.code(201).send({
        paymentId: result.payment.id,
        contributions: result.contributions.map((c, i) => ({
          id: c.id,
          amountCents: c.amountCents,
          periodId: c.periodId,
          flags: result.contributionFlags[i] ?? [],
        })),
      });
    },
  });

  r.route({
    method: 'POST',
    url: '/payments/:id/contributions',
    schema: { params: z.object({ id: z.string() }), body: AddContributionBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('create', 'Contribution')) {
        return reply.code(403).send({ error: 'not permitted to enter contributions' });
      }
      const body = request.body;
      if (outsideGrants(user, [body])) {
        return reply.code(403).send({ error: 'this entry is for a riding outside your grants' });
      }
      const result = await addContributionToPayment(app.prisma, {
        ...body,
        paymentId: request.params.id,
        actorUserId: user.id,
      });
      return reply.code(201).send({
        contributionId: result.contribution.id,
        remainingCents: result.remainingCents,
        flags: result.flags,
      });
    },
  });

  r.route({
    method: 'GET',
    url: '/payments/:id',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Contribution')) {
        return reply.code(403).send({ error: 'not permitted to read contributions' });
      }
      const payment = await app.prisma.payment.findUnique({
        where: { id: request.params.id },
        include: {
          contact: { select: { name: true } },
          contributions: { include: { contact: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!payment) return reply.code(404).send({ error: `no payment ${request.params.id}` });
      const attributed = payment.contributions
        .filter((c) => c.status === 'ACTIVE')
        .reduce((sum, c) => sum + c.amountCents, 0);
      return reply.send({
        id: payment.id,
        contactId: payment.contactId,
        contactName: payment.contact.name,
        amountCents: payment.amountCents,
        receivedAt: payment.receivedAt.toISOString(),
        method: payment.method,
        state: payment.state,
        source: payment.source,
        externalRef: payment.externalRef,
        attributedCents: attributed,
        unattributedCents: payment.amountCents - attributed,
        contributions: payment.contributions.map((c) => ({
          id: c.id,
          contactName: c.contact.name,
          amountCents: c.amountCents,
          status: c.status,
        })),
      });
    },
  });

  r.route({
    method: 'GET',
    url: '/intake-preview',
    schema: {
      querystring: z.object({
        acceptedAt: z.coerce.date(),
        ridingNumber: z.coerce.number().int().min(1).max(124).optional(),
        sourceCode: z.string().optional(),
        externalRef: z.string().optional(),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('create', 'Payment')) {
        return reply.code(403).send({ error: 'not permitted to enter payments' });
      }
      return reply.send(await previewIntake(app.prisma, request.query));
    },
  });
}
