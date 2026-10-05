import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Prisma-backed session store for @fastify/session (ticket 0.5: "stateful
 * sessions"). Sessions survive a restart and are inspectable in the database,
 * which the in-memory default is not.
 */

type SessionData = Record<string, unknown> & {
  cookie?: { expires?: string | Date | null };
  /** @fastify/passport stores the serialized user (our user id) directly */
  passport?: string | { user?: string };
};

/** The signed-in user's id from a session's data, or null. */
export function sessionUserId(session: SessionData): string | null {
  const p = session.passport;
  if (typeof p === 'string') return p;
  return p?.user ?? null;
}

/**
 * `where` for every stored session belonging to `userId`. Matches the
 * passport field as well as the `userId` column, because rows written before
 * `sessionUserId` existed have a null column.
 */
export function sessionsOfUser(userId: string) {
  return {
    OR: [{ userId }, { data: { path: ['passport'], equals: userId } }],
  };
}

type Callback<T = void> = (err?: Error | null, result?: T) => void;

export class PrismaSessionStore {
  constructor(private readonly prisma: PrismaClient) {}

  get(sid: string, cb: Callback<SessionData | null>): void {
    this.prisma.session
      .findUnique({ where: { sid } })
      .then((row) => {
        if (!row) return cb(null, null);
        if (row.expiresAt.getTime() < Date.now()) {
          return this.prisma.session
            .deleteMany({ where: { sid } })
            .then(() => cb(null, null))
            .catch((e) => cb(e as Error));
        }
        cb(null, row.data as SessionData);
      })
      .catch((e) => cb(e as Error));
  }

  set(sid: string, session: SessionData, cb: Callback): void {
    const expiresAt = resolveExpiry(session);
    const userId = sessionUserId(session);
    const data = session as unknown as object;
    this.prisma.session
      .upsert({
        where: { sid },
        create: { sid, data, expiresAt, userId },
        update: { data, expiresAt, userId },
      })
      .then(() => cb(null))
      .catch((e) => cb(e as Error));
  }

  destroy(sid: string, cb: Callback): void {
    this.prisma.session
      .deleteMany({ where: { sid } })
      .then(() => cb(null))
      .catch((e) => cb(e as Error));
  }
}

function resolveExpiry(session: SessionData): Date {
  const raw = session.cookie?.expires;
  if (raw) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}
