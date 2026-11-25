import { PgBoss } from 'pg-boss';
import { z } from 'zod';

export const SWEEP_QUEUE = 'qomon-sweep';
export const QueueEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  // pg-boss stores seconds in a PostgreSQL integer.
  SWEEP_JOB_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24855)
    .default(30),
});

export function queueEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const parsed = QueueEnvSchema.safeParse(source);
  if (!parsed.success) throw new Error('Sweep queue environment is invalid');
  return parsed.data;
}

/** Runtime startup verifies the installed version and never creates queue objects. */
export async function openSweepQueue(
  connectionString: string,
  supervise = false,
): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    migrate: false,
    supervise,
    schedule: false,
    registerInstance: false,
  });
  // Raw database errors can contain connection details.
  boss.on('error', () =>
    console.error('Sweep queue database operation failed'),
  );
  try {
    await boss.start();
    if (!(await boss.getQueue(SWEEP_QUEUE))) throw new Error('Queue missing');
    return boss;
  } catch {
    await boss.stop();
    throw new Error(
      'Sweep queue unavailable or incompatible; run migrate:deploy before starting API or worker',
    );
  }
}
