import { ReceiptDelivery } from '@gpo/tax-receipts-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { confirmDonorPrecheck } from '../donors/precheck.js';

/**
 * Donor pre-check confirmation (ticket 3.9): the one deliberately
 * unauthenticated route in this app. A donor reached this from an emailed
 * link, not a login — `donors/precheck.ts`'s module doc explains why the
 * bearer token stands in for session/CASL here.
 */
export async function donorPrecheckRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const ConfirmBody = z.object({
    delivery: ReceiptDelivery,
    address: z.object({
      line1: z.string().min(1),
      line2: z.string().min(1).optional(),
      city: z.string().min(1),
      province: z.string().min(1),
      postalCode: z.string().min(1),
      country: z.string().min(1).optional(),
    }),
  });

  r.route({
    method: 'POST',
    url: '/donor-precheck/:token/confirm',
    schema: {
      params: z.object({ token: z.string().min(1) }),
      body: ConfirmBody,
    },
    handler: async (request, reply) => {
      const result = await confirmDonorPrecheck(app.prisma, {
        token: request.params.token,
        delivery: request.body.delivery,
        address: request.body.address,
      });
      return reply.code(200).send(result);
    },
  });
}
