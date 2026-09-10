import { randomUUID } from 'node:crypto';
import type { ChangeLogSubjectType } from '@gpo/tax-receipts-core';
import { Prisma } from '../generated/prisma/index.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Change-log write path (ticket 0.4, guarantee G4). Every mutation of
 * metadata, receipts, or allocations must go through `withChangeLog`, which:
 *
 *  1. opens one database transaction,
 *  2. sets the tx-local `app.correlation_id` / `app.actor` settings the
 *     invariant-5 triggers require,
 *  3. hands the caller a `tx` client plus a `log()` that appends a
 *     ChangeLogEntry (actor, reason, before, after) in that SAME transaction,
 *  4. commits, at which point the deferred `assert_change_log_written`
 *     trigger verifies at least one entry was written for this correlation id.
 *
 * A cascade (one guarded action touching many rows) shares one correlationId.
 * `reason` is mandatory; a blank reason is rejected before the transaction
 * opens.
 */

export class ChangeLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeLogError';
  }
}

export interface ActorContext {
  /** the acting user, or null for system actions (the sweep, a cron job). */
  userId: string | null;
  /** mandatory human reason (invariant 5). */
  reason: string;
  /** reuse across a multi-step cascade; generated when absent. */
  correlationId?: string;
}

export interface ChangeRecord {
  subjectType: ChangeLogSubjectType;
  subjectId: string;
  before?: unknown;
  after?: unknown;
  /** per-entry reason override; defaults to the actor's reason. */
  reason?: string;
}

export interface ChangeLogContext {
  tx: Prisma.TransactionClient;
  correlationId: string;
  actorUserId: string | null;
  log(record: ChangeRecord): Promise<void>;
}

/** JSON-safe snapshot of a Prisma row (Date -> ISO, BigInt -> string). */
export function toJsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      return v;
    }),
  );
}

function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined) return Prisma.DbNull;
  return toJsonSnapshot(value);
}

export async function withChangeLog<T>(
  prisma: PrismaClient,
  actor: ActorContext,
  fn: (ctx: ChangeLogContext) => Promise<T>,
): Promise<T> {
  if (!actor.reason || actor.reason.trim().length === 0) {
    throw new ChangeLogError('a change reason is mandatory (invariant 5)');
  }
  const correlationId = actor.correlationId ?? randomUUID();

  return prisma.$transaction(async (tx) => {
    // $queryRaw (not $executeRaw): SELECT returns a row, and the engine
    // panics on $executeRaw for row-returning statements.
    await tx.$queryRaw`SELECT set_config('app.correlation_id', ${correlationId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.actor', ${actor.userId ?? 'system'}, true)`;

    let wroteEntry = false;
    const ctx: ChangeLogContext = {
      tx,
      correlationId,
      actorUserId: actor.userId,
      async log(record) {
        wroteEntry = true;
        await tx.changeLogEntry.create({
          data: {
            subjectType: record.subjectType,
            subjectId: record.subjectId,
            actorUserId: actor.userId,
            reason: record.reason ?? actor.reason,
            before: jsonOrDbNull(record.before),
            after: jsonOrDbNull(record.after),
            correlationId,
          },
        });
      },
    };

    const result = await fn(ctx);
    if (!wroteEntry) {
      // Not strictly required (the DB only enforces it when a guarded table
      // was touched), but a withChangeLog block that logs nothing is almost
      // always a bug.
      throw new ChangeLogError(
        'withChangeLog block completed without recording any ChangeLogEntry',
      );
    }
    return result;
  });
}
