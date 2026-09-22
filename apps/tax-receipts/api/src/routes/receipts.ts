import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ReceiptDelivery } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { allocateToReceipt } from '../receipts/allocate.js';
import { issueReceipt } from '../receipts/issue.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Individual receipt issuance (ticket 3.1). `issue` is CASL-gated to the
 * party CFO and their CFO designates (compliance.md, s. 25.1(6)) —
 * everyone else, including sysadmin, gets 403 here on purpose (sysadmin's
 * `manage: all` is for config, not for acting as the CFO).
 *
 * The allocations route (ticket 3.2) is gated on `correct` rather than
 * `issue`: attaching another contribution to an already-issued receipt is a
 * correction-adjacent action on existing money, not the act of originating a
 * new receipt — the same `correct` action `abilities.ts` already reserves
 * for administrators and the party CFO alike.
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

  const AllocateBody = z.object({
    contributionId: z.string(),
    reason: z.string().min(3),
    amountCents: z.number().int().positive().optional(),
  });

  r.route({
    method: 'POST',
    url: '/receipts/:id/allocations',
    schema: {
      params: z.object({ id: z.string() }),
      body: AllocateBody,
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('correct', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to correct receipts' });
      }

      const result = await allocateToReceipt(
        { prisma: app.prisma },
        {
          receiptId: request.params.id,
          contributionId: request.body.contributionId,
          actorUserId: user.id,
          reason: request.body.reason,
          amountCents: request.body.amountCents,
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
