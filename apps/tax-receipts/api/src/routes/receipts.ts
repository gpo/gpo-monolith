import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ReceiptDelivery } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { cancelReceipt, previewReceiptCorrection, reissueReceipt } from '../corrections/cancel.js';
import { recordForeignReceipt } from '../receipts/foreign.js';
import { issueCombinedReceipt, issueReceipt } from '../receipts/issue.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Individual receipt issuance (ticket 3.1). `issue` is CASL-gated to the
 * party CFO and their CFO designates (compliance.md, s. 25.1(6)) —
 * everyone else, including sysadmin, gets 403 here on purpose (sysadmin's
 * `manage: all` is for config, not for acting as the CFO).
 *
 * `POST /receipts` issues one combined receipt for several of a donor's
 * contributions (EO evaluation rows 43 and 46) and is gated on `issue` like
 * any other new receipt. A contribution is never added to a receipt already
 * issued: its PDF would no longer match it, so the way to grow a receipt is
 * to cancel it and issue a combined one. `cancel`/`reissue` (ticket 3.10,
 * corrections.md actions 1/2) are gated on `correct`: they act on existing
 * money rather than originating a new receipt.
 */
export async function receiptRoutes(
  app: FastifyInstance,
  opts: { storageDir: string },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const IssueReceiptBody = z.object({
    reason: z.string().min(3),
    amountCents: z.number().int().positive().optional(),
    delivery: ReceiptDelivery.optional(),
    politicalEntityLabel: z.string().min(1),
  });

  r.route({
    method: 'POST',
    url: '/contributions/:id/receipts',
    schema: {
      params: z.object({ id: z.string() }),
      body: IssueReceiptBody,
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('issue', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to issue receipts' });
      }

      const result = await issueReceipt(
        { prisma: app.prisma, storageDir: opts.storageDir },
        {
          contributionId: request.params.id,
          actorUserId: user.id,
          reason: request.body.reason,
          amountCents: request.body.amountCents,
          delivery: request.body.delivery,
          politicalEntityLabel: request.body.politicalEntityLabel,
        },
      );
      return reply.code(201).send(result);
    },
  });

  const RecordForeignReceiptBody = z.object({
    reason: z.string().min(3),
    receiptNumber: z.string().min(1),
    amountCents: z.number().int().positive().optional(),
    issueDate: z.coerce.date().optional(),
    delivery: ReceiptDelivery.optional(),
  });

  r.route({
    method: 'POST',
    url: '/contributions/:id/receipts/foreign',
    schema: {
      params: z.object({ id: z.string() }),
      body: RecordForeignReceiptBody,
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('issue', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to issue receipts' });
      }

      const result = await recordForeignReceipt(
        { prisma: app.prisma },
        {
          contributionId: request.params.id,
          actorUserId: user.id,
          reason: request.body.reason,
          receiptNumber: request.body.receiptNumber,
          amountCents: request.body.amountCents,
          issueDate: request.body.issueDate,
          delivery: request.body.delivery,
        },
      );
      return reply.code(201).send(result);
    },
  });

  const IssueCombinedReceiptBody = z.object({
    contributionIds: z.array(z.string()).min(2),
    reason: z.string().min(3),
    delivery: ReceiptDelivery.optional(),
    politicalEntityLabel: z.string().min(1),
  });

  r.route({
    method: 'POST',
    url: '/receipts',
    schema: { body: IssueCombinedReceiptBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('issue', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to issue receipts' });
      }

      const result = await issueCombinedReceipt(
        { prisma: app.prisma, storageDir: opts.storageDir },
        {
          contributionIds: request.body.contributionIds,
          actorUserId: user.id,
          reason: request.body.reason,
          delivery: request.body.delivery,
          politicalEntityLabel: request.body.politicalEntityLabel,
        },
      );
      return reply.code(201).send(result);
    },
  });

  r.route({
    method: 'GET',
    url: '/receipts/:id/correction-preview',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to read receipts' });
      }

      const result = await previewReceiptCorrection(app.prisma, request.params.id);
      return reply.send(result);
    },
  });

  const CancelReceiptBody = z.object({ reason: z.string().min(3) });

  r.route({
    method: 'POST',
    url: '/receipts/:id/cancel',
    schema: { params: z.object({ id: z.string() }), body: CancelReceiptBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('correct', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to correct receipts' });
      }

      const result = await cancelReceipt(
        { prisma: app.prisma, storageDir: opts.storageDir },
        { receiptId: request.params.id, actorUserId: user.id, reason: request.body.reason },
      );
      return reply.code(200).send(result);
    },
  });

  const ReissueReceiptBody = z.object({
    reason: z.string().min(3),
    politicalEntityLabel: z.string().min(1),
    delivery: ReceiptDelivery.optional(),
  });

  r.route({
    method: 'POST',
    url: '/receipts/:id/reissue',
    schema: { params: z.object({ id: z.string() }), body: ReissueReceiptBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('correct', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to correct receipts' });
      }

      const result = await reissueReceipt(
        { prisma: app.prisma, storageDir: opts.storageDir },
        {
          receiptId: request.params.id,
          actorUserId: user.id,
          reason: request.body.reason,
          politicalEntityLabel: request.body.politicalEntityLabel,
          delivery: request.body.delivery,
        },
      );
      return reply.code(201).send(result);
    },
  });

  r.route({
    method: 'GET',
    url: '/receipts/:id/pdf',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to read receipts' });
      }

      const receipt = await app.prisma.receipt.findUnique({
        where: { id: request.params.id },
        include: { pdfArtifact: true },
      });
      if (!receipt?.pdfArtifact) return reply.code(404).send({ error: 'not found' });

      const bytes = await readFile(path.join(opts.storageDir, receipt.pdfArtifact.uri));
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${receipt.receiptNumber}.pdf"`)
        .send(bytes);
    },
  });
}
