import { PrismaClient } from './generated/prisma/index.js';

/**
 * One PrismaClient per process. `buildApp` accepts an injected client (tests
 * pass a shared one); this is the default for the server entrypoint.
 */
let singleton: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  singleton ??= new PrismaClient();
  return singleton;
}

export type { PrismaClient };
