import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { PrismaClient } from '../generated/prisma/index.js';

async function prismaPlugin(
  app: FastifyInstance,
  opts: { prisma: PrismaClient; owns: boolean },
): Promise<void> {
  app.decorate('prisma', opts.prisma);
  if (opts.owns) {
    app.addHook('onClose', async () => {
      await opts.prisma.$disconnect();
    });
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export default fp(prismaPlugin, { name: 'prisma' });
