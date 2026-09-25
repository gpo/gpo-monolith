import { EntityKind, ReceiptDelivery, ReceiptReprintKind } from '@gpo/tax-receipts-core';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mergeContacts, unmergeContact } from '../corrections/merge-contacts.js';
import { proposeReallocation } from '../corrections/reallocation-proposal.js';
import {
  correctAmount,
  moveContributions,
  moveReceipt,
  reallocate,
  refund,
  splitContribution,
} from '../corrections/actions.js';
import {
  applyCorrection,
  previewCorrection,
  type CorrectionInput,
  type CorrectionPlan,
} from '../corrections/contribution-correction.js';
import { reprintReceipt } from '../corrections/reprint.js';
import { previewReceiptSplit, splitReceipt } from '../corrections/receipt-split.js';
import type { SessionUser } from '../plugins/auth.js';

/**
 * Contribution correction actions (corrections.md actions 4, 5, 6, 8, 9, 12).
 * One request shape for all of them, sent first to `/corrections/preview` (the
 * whole cascade, nothing written) and then, unchanged, to `/corrections` to
 * commit it.
 *
 * Authority: `correct Contribution` for any of them; `correct Receipt` when
 * the cascade cancels or issues a receipt; and, for a reallocation between
 * entities, a user who can `file` (corrections.md action 9 requires the
 * filer's sign-off, above a threshold that is $0 until it is configurable).
 * A riding-scoped user may correct only contributions in, and move them only
 * to, their granted ridings.
 */

const Part = z.object({
  amountCents: z.number().int().positive(),
  contactId: z.string().optional(),
  entityKind: EntityKind.optional(),
  ridingNumber: z.number().int().nullable().optional(),
  periodId: z.number().int().nullable().optional(),
  nonDeductibleCents: z.number().int().min(0).optional(),
});

const Common = z.object({
  reason: z.string().min(3),
  politicalEntityLabel: z.string().min(1).optional(),
  entityLabels: z.record(z.string(), z.string().min(1)).optional(),
  delivery: ReceiptDelivery.optional(),
});

export const CorrectionRequest = z.discriminatedUnion('action', [
  Common.extend({
    action: z.literal('CORRECT_AMOUNT'),
    contributionId: z.string(),
    amountCents: z.number().int().positive(),
    nonDeductibleCents: z.number().int().min(0).optional(),
    paymentAmountCents: z.number().int().positive().optional(),
  }),
  Common.extend({
    action: z.literal('MOVE'),
    contributionIds: z.array(z.string()).min(1),
    toContactId: z.string(),
  }),
  Common.extend({
    action: z.literal('MOVE_RECEIPT'),
    receiptId: z.string(),
    toContactId: z.string(),
  }),
  Common.extend({
    action: z.literal('SPLIT_CONTRIBUTION'),
    contributionId: z.string(),
    parts: z.array(Part).min(2),
  }),
  Common.extend({
    action: z.literal('REALLOCATE'),
    contributionId: z.string(),
    parts: z.array(Part).min(1),
  }),
  Common.extend({
    action: z.literal('MERGE_CONTACTS'),
    survivorId: z.string(),
    mergedAwayId: z.string(),
    evidence: z.string().min(3).optional(),
  }),
  Common.extend({
    action: z.literal('REFUND'),
    contributionIds: z.array(z.string()).optional(),
    paymentId: z.string().optional(),
  }),
]);
export type CorrectionRequest = z.infer<typeof CorrectionRequest>;

export async function correctionRoutes(
  app: FastifyInstance,
  opts: { storageDir: string },
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function toInput(body: CorrectionRequest, user: SessionUser): Promise<CorrectionInput> {
    const c = {
      actorUserId: user.id,
      reason: body.reason,
      politicalEntityLabel: body.politicalEntityLabel,
      entityLabels: body.entityLabels,
      delivery: body.delivery,
    };
    const prisma = app.prisma;
    switch (body.action) {
      case 'CORRECT_AMOUNT':
        return correctAmount(prisma, {
          ...c,
          contributionId: body.contributionId,
          amountCents: body.amountCents,
          nonDeductibleCents: body.nonDeductibleCents,
          paymentAmountCents: body.paymentAmountCents,
        });
      case 'MOVE':
        return moveContributions(prisma, { ...c, contributionIds: body.contributionIds, toContactId: body.toContactId });
      case 'MOVE_RECEIPT':
        return moveReceipt(prisma, { ...c, receiptId: body.receiptId, toContactId: body.toContactId });
      case 'SPLIT_CONTRIBUTION':
        return splitContribution(prisma, { ...c, contributionId: body.contributionId, parts: body.parts });
      case 'REALLOCATE':
        return reallocate(prisma, { ...c, contributionId: body.contributionId, parts: body.parts });
      case 'MERGE_CONTACTS':
        return mergeContacts(prisma, { ...c, survivorId: body.survivorId, mergedAwayId: body.mergedAwayId, evidence: body.evidence });
      case 'REFUND':
        return refund(prisma, { ...c, contributionIds: body.contributionIds, paymentId: body.paymentId });
    }
  }

  /** null when permitted, else the 403 already sent. */
  function authorize(
    request: { ability: { can(action: string, subject: string): boolean } },
    reply: FastifyReply,
    user: SessionUser,
    input: CorrectionInput,
    plan: CorrectionPlan,
  ): FastifyReply | null {
    if (!request.ability.can('correct', 'Contribution')) {
      return reply.code(403).send({ error: 'not permitted to correct contributions' });
    }
    if ((plan.cancelReceipts.length > 0 || plan.issueReceipts.length > 0) && !request.ability.can('correct', 'Receipt')) {
      return reply.code(403).send({ error: 'this correction cancels or issues receipts; not permitted to correct receipts' });
    }
    if (input.action === 'REALLOCATE' && !request.ability.can('file', 'EOForm')) {
      return reply.code(403).send({ error: 'a reallocation needs a filer\'s sign-off' });
    }
    if (!user.allRidings) {
      const grants = new Set(user.ridingGrants);
      const outside = (riding: number | null) => riding !== null && !grants.has(riding);
      const touches = plan.changes.flatMap((c) => [c.before.ridingNumber, ...c.replacements.map((x) => x.ridingNumber)]);
      if (touches.some(outside)) {
        return reply.code(403).send({ error: 'this correction touches a riding outside your grants' });
      }
    }
    return null;
  }

  r.route({
    method: 'POST',
    url: '/corrections/preview',
    schema: { body: CorrectionRequest },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Contribution')) {
        return reply.code(403).send({ error: 'not permitted to read contributions' });
      }
      const input = await toInput(request.body, user);
      return reply.send(await previewCorrection(app.prisma, input));
    },
  });

  r.route({
    method: 'POST',
    url: '/corrections',
    schema: { body: CorrectionRequest },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });

      const input = await toInput(request.body, user);
      const plan = await previewCorrection(app.prisma, input);
      const denied = authorize(request, reply, user, input, plan);
      if (denied) return denied;

      const result = await applyCorrection({ prisma: app.prisma, storageDir: opts.storageDir }, input);
      return reply.code(201).send(result);
    },
  });

  // --- action 7: split a receipt --------------------------------------------
  const SplitReceiptBody = z.object({
    reason: z.string().min(3),
    groups: z.array(z.object({ contributionIds: z.array(z.string()).min(1) })).min(2),
    politicalEntityLabel: z.string().min(1).optional(),
    entityLabels: z.record(z.string(), z.string().min(1)).optional(),
    delivery: ReceiptDelivery.optional(),
  });

  r.route({
    method: 'POST',
    url: '/receipts/:id/split-preview',
    schema: { params: z.object({ id: z.string() }), body: SplitReceiptBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to read receipts' });
      }
      const plan = await previewReceiptSplit(app.prisma, {
        ...request.body,
        receiptId: request.params.id,
        actorUserId: user.id,
      });
      return reply.send(plan);
    },
  });

  r.route({
    method: 'POST',
    url: '/receipts/:id/split',
    schema: { params: z.object({ id: z.string() }), body: SplitReceiptBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('correct', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to correct receipts' });
      }
      const result = await splitReceipt(
        { prisma: app.prisma, storageDir: opts.storageDir },
        { ...request.body, receiptId: request.params.id, actorUserId: user.id },
      );
      return reply.code(201).send(result);
    },
  });

  // --- action 3 and the lost status: reprint without cancelling ---------------
  const ReprintBody = z.object({
    reason: z.string().min(3),
    kind: ReceiptReprintKind,
    correctedName: z.string().min(1).optional(),
    politicalEntityLabel: z.string().min(1),
  });

  r.route({
    method: 'POST',
    url: '/receipts/:id/reprint',
    schema: { params: z.object({ id: z.string() }), body: ReprintBody },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('correct', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to correct receipts' });
      }
      const result = await reprintReceipt(
        { prisma: app.prisma, storageDir: opts.storageDir },
        { ...request.body, receiptId: request.params.id, actorUserId: user.id },
      );
      return reply.code(201).send(result);
    },
  });

  r.route({
    method: 'GET',
    url: '/receipts/:id/reprints',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to read receipts' });
      }
      const rows = await app.prisma.receiptReprint.findMany({
        where: { receiptId: request.params.id },
        orderBy: { createdAt: 'asc' },
      });
      return reply.send({ data: rows });
    },
  });

  r.route({
    method: 'GET',
    url: '/receipts/:id/reprints/:reprintId/pdf',
    schema: { params: z.object({ id: z.string(), reprintId: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Receipt')) {
        return reply.code(403).send({ error: 'not permitted to read receipts' });
      }
      const reprint = await app.prisma.receiptReprint.findFirst({
        where: { id: request.params.reprintId, receiptId: request.params.id },
        include: { artifact: true },
      });
      if (!reprint) return reply.code(404).send({ error: 'no such reprint' });
      const bytes = await readFile(path.join(opts.storageDir, reprint.artifact.uri));
      return reply.type('application/pdf').send(bytes);
    },
  });

  r.route({
    method: 'POST',
    url: '/contacts/:id/unmerge',
    schema: { params: z.object({ id: z.string() }), body: z.object({ reason: z.string().min(3) }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('correct', 'Contribution')) {
        return reply.code(403).send({ error: 'not permitted to correct contributions' });
      }
      await unmergeContact(app.prisma, { contactId: request.params.id, actorUserId: user.id, reason: request.body.reason });
      return reply.code(200).send({ contactId: request.params.id, mergedIntoId: null });
    },
  });

  r.route({
    method: 'GET',
    url: '/contributions/:id/reallocation-proposal',
    schema: { params: z.object({ id: z.string() }) },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Contribution')) {
        return reply.code(403).send({ error: 'not permitted to read contributions' });
      }
      return reply.send(await proposeReallocation(app.prisma, request.params.id));
    },
  });

  // The donor picker for move, split, and merge. Merged-away contacts are not
  // offered: nothing can be attributed to them any more.
  r.route({
    method: 'GET',
    url: '/contacts',
    schema: {
      querystring: z.object({
        query: z.string().min(2),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
    },
    handler: async (request, reply) => {
      const user = request.user as SessionUser | undefined;
      if (!user) return reply.code(401).send({ error: 'authentication required' });
      if (!request.ability.can('read', 'Contribution')) {
        return reply.code(403).send({ error: 'not permitted to read contributions' });
      }
      const { query, limit } = request.query;
      const rows = await app.prisma.contact.findMany({
        where: {
          mergedIntoId: null,
          OR: [{ name: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }],
        },
        orderBy: { name: 'asc' },
        take: limit,
        select: { id: true, name: true, email: true, qomonContactId: true },
      });
      return reply.send({
        data: rows.map((c) => ({ ...c, qomonContactId: c.qomonContactId === null ? null : String(c.qomonContactId) })),
      });
    },
  });
}
