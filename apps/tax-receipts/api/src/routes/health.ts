import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => ({
    service: 'gpo-tax-receipts-api',
    message: 'Tax Receipts & Contributions tool API. See /health.',
  }));

  app.get('/health', async (_request, reply) => {
    let db: 'up' | 'down' = 'down';
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return reply.code(db === 'up' ? 200 : 503).send({
      status: 'ok',
      service: 'gpo-tax-receipts-api',
      time: new Date().toISOString(),
      db,
    });
  });
}
