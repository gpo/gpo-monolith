import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EntityKind } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { canSeeRiding } from '../auth/abilities.js';
import { dispatchPendingEmails, type DispatchOptions } from '../delivery/dispatcher.js';
import {
  WebhookVerificationError,
  type EmailDeliveryEventType,
  type EmailProvider,
} from '../delivery/email-provider.js';
import { applyEmailEvents } from '../delivery/events.js';
import { queueSpaceReceiptEmails } from '../delivery/outbox.js';
import { createPrintBatch, markPrintBatchMailed } from '../delivery/print-batches.js';
import { getSpaceDeliverySummary } from '../delivery/space-delivery.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Delivery (tickets 3.6, 3.12): the issuance wizard's Deliver step, the
 * print-and-mail path, the provider webhook, and sysadmin outbox tools.
 *
 * Sending is asynchronous: "Send emails" queues and returns, and the
 * dispatcher started by server.ts sends. `POST /admin/emails/dispatch` runs
 * one pass on demand (development, or to drain the queue without waiting).
 */
export async function deliveryRoutes(
  app: FastifyInstance,
  opts: { storageDir: string; emailProvider: EmailProvider; dispatch?: DispatchOptions },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const SpaceParams = z.object({ periodId: z.coerce.number().int(), entityKind: EntityKind });
  const SpaceQuery = z.object({ ridingNumber: z.coerce.number().int().min(1).max(124).optional() });

  r.route({
    method: 'GET',
    url: '/spaces/:periodId/:entityKind/delivery',
    schema: { params: SpaceParams, querystring: SpaceQuery },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      const ridingNumber = request.query.ridingNumber ?? null;
      if (!canSeeRiding(user, ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }
      return reply.send(
        await getSpaceDeliverySummary(app.prisma, {
          periodId: request.params.periodId,
          ridingNumber,
          entityKind: request.params.entityKind,
        }),
      );
    },
  });

  r.route({
    method: 'POST',
    url: '/spaces/:periodId/:entityKind/deliver/email',
    schema: {
      params: SpaceParams,
      querystring: SpaceQuery,
      body: z.object({
        reason: z.string().min(3),
        subject: z.string().min(1).max(200),
        coverLetterBody: z.string().min(1),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('issue', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to deliver receipts' });
      }
      const ridingNumber = request.query.ridingNumber ?? null;
      if (!canSeeRiding(user, ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }
      const result = await queueSpaceReceiptEmails(app.prisma, {
        periodId: request.params.periodId,
        ridingNumber,
        entityKind: request.params.entityKind,
        actorUserId: user.id,
        reason: request.body.reason,
        subject: request.body.subject,
        coverLetterBody: request.body.coverLetterBody,
      });
      return reply.code(201).send(result);
    },
  });

  r.route({
    method: 'POST',
    url: '/spaces/:periodId/:entityKind/print-batches',
    schema: {
      params: SpaceParams,
      querystring: SpaceQuery,
      body: z.object({ reason: z.string().min(3), coverLetterBody: z.string().min(1) }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('issue', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to deliver receipts' });
      }
      const ridingNumber = request.query.ridingNumber ?? null;
      if (!canSeeRiding(user, ridingNumber)) {
        return reply.code(403).send({ error: 'not permitted to see this riding' });
      }
      const result = await createPrintBatch(
        { prisma: app.prisma, storageDir: opts.storageDir },
        {
          periodId: request.params.periodId,
          ridingNumber,
          entityKind: request.params.entityKind,
          actorUserId: user.id,
          reason: request.body.reason,
          coverLetterBody: request.body.coverLetterBody,
        },
      );
      return reply.code(201).send(result);
    },
  });

  r.route({
    method: 'GET',
    url: '/print-batches/:id/pdf',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to read receipts' });
      }
      const batch = await app.prisma.printBatch.findUnique({
        where: { id: request.params.id },
        include: { artifact: true },
      });
      if (!batch || !canSeeRiding(user, batch.ridingNumber)) return reply.code(404).send({ error: 'not found' });
      const bytes = await readFile(path.join(opts.storageDir, batch.artifact.uri));
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="print-batch-${batch.id}.pdf"`)
        .send(bytes);
    },
  });

  r.route({
    method: 'POST',
    url: '/print-batches/:id/mailed',
    schema: {
      params: z.object({ id: z.string() }),
      body: z.object({
        reason: z.string().min(3),
        /** the day it was posted, YYYY-MM-DD; defaults to now */
        mailedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('issue', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to deliver receipts' });
      }
      const batch = await app.prisma.printBatch.findUnique({ where: { id: request.params.id } });
      if (!batch || !canSeeRiding(user, batch.ridingNumber)) return reply.code(404).send({ error: 'not found' });

      // 17:00 UTC is midday in Ontario, so the date cannot slip a day either
      // way (the same convention as the manual entry form). Today's date
      // would land in the future before 1 pm ET, so today means now.
      let mailedAt: Date | undefined;
      if (request.body.mailedOn) {
        mailedAt = new Date(`${request.body.mailedOn}T17:00:00Z`);
        if (mailedAt.getTime() > Date.now() && mailedAt.getTime() - Date.now() < 24 * 60 * 60_000) {
          mailedAt = new Date();
        }
      }
      const result = await markPrintBatchMailed(app.prisma, {
        printBatchId: batch.id,
        actorUserId: user.id,
        reason: request.body.reason,
        mailedAt,
      });
      return reply.send(result);
    },
  });

  // ---- Provider webhook ------------------------------------------------
  // Unauthenticated by session: the provider's signature is the credential.
  // Registered in its own scope so the raw-body parser it needs (signatures
  // are over the exact bytes) does not apply to any other route.

  const provider = opts.emailProvider;
  if (provider.parseWebhook) {
    await app.register(async (scope) => {
      scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
      });
      scope.post('/webhooks/email', async (request, reply) => {
        let events;
        try {
          events = provider.parseWebhook!({
            headers: request.headers,
            rawBody: typeof request.body === 'string' ? request.body : '',
          });
        } catch (err) {
          if (err instanceof WebhookVerificationError) {
            request.log.warn({ err }, 'email webhook refused');
            return reply.code(401).send({ error: 'invalid signature' });
          }
          throw err;
        }
        const result = await applyEmailEvents(app.prisma, events);
        return reply.send(result);
      });
    });
  }

  // ---- Sysadmin outbox tools ---------------------------------------------

  function requireSysadmin(request: { user?: unknown; ability: { can(a: string, s: string): boolean } }) {
    if (!request.user) return { code: 401, error: 'authentication required' };
    if (!request.ability.can('administer', 'Period')) return { code: 403, error: 'sysadmin only' };
    return null;
  }

  r.route({
    method: 'GET',
    url: '/admin/emails',
    schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }) },
    handler: async (request, reply) => {
      const denied = requireSysadmin(request);
      if (denied) return reply.code(denied.code).send({ error: denied.error });
      const rows = await app.prisma.emailMessage.findMany({
        orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
        take: request.query.limit ?? 100,
        include: { receipt: { select: { receiptNumber: true } }, contact: { select: { name: true } } },
      });
      return reply.send({
        provider: provider.name,
        data: rows.map((m) => ({
          id: m.id,
          purpose: m.purpose,
          status: m.status,
          statusDetail: m.statusDetail,
          toAddress: m.toAddress,
          contactName: m.contact.name,
          receiptNumber: m.receipt?.receiptNumber ?? null,
          subject: m.subject,
          textBody: m.textBody,
          attempts: m.attempts,
          queuedAt: m.queuedAt,
          sentAt: m.sentAt,
          providerMessageId: m.providerMessageId,
        })),
      });
    },
  });

  r.post('/admin/emails/dispatch', async (request, reply) => {
    const denied = requireSysadmin(request);
    if (denied) return reply.code(denied.code).send({ error: denied.error });
    const result = await dispatchPendingEmails(
      { prisma: app.prisma, storageDir: opts.storageDir, provider },
      opts.dispatch,
    );
    return reply.send(result);
  });

  // Development only: plays a provider event through the same handling code
  // a real webhook reaches. Never registered with a real provider, where a
  // fake bounce would move a real donor to mail.
  if (provider.name === 'dev') {
    const SimulateType = z.enum(['delivered', 'delayed', 'bounced', 'complained', 'failed']);
    r.route({
      method: 'POST',
      url: '/admin/emails/:id/simulate',
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ type: SimulateType, detail: z.string().optional() }),
      },
      handler: async (request, reply) => {
        const denied = requireSysadmin(request);
        if (denied) return reply.code(denied.code).send({ error: denied.error });
        const message = await app.prisma.emailMessage.findUnique({ where: { id: request.params.id } });
        if (!message?.providerMessageId) {
          return reply.code(409).send({ error: 'that email has not been sent yet' });
        }
        const type: EmailDeliveryEventType = request.body.type;
        const result = await applyEmailEvents(app.prisma, [
          {
            providerEventId: `dev_${crypto.randomUUID()}`,
            providerMessageId: message.providerMessageId,
            type,
            occurredAt: new Date(),
            detail: request.body.detail ?? (type === 'bounced' ? 'Permanent: simulated bounce' : undefined),
            payload: { simulated: true, type },
          },
        ]);
        return reply.send(result);
      },
    });
  }
}
