import type { FastifyInstance } from 'fastify';

export async function versionRoutes(app: FastifyInstance, opts: { gitSha: string }): Promise<void> {
  app.get('/version', async () => ({ gitSha: opts.gitSha }));
}
