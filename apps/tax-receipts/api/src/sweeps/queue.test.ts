import { QomonAuthError } from '@gpo/qomon-client';
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { InMemoryQomon } from '@gpo/qomon-client/fake';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { resetDb, seedBaseline, testPrisma } from '../test/db.js';
import { openSweepQueue, SWEEP_QUEUE } from './queue.js';
import { startSweepConsumer } from './consumer.js';
import { processSweepRun } from './execute.js';
import { PgBoss } from 'pg-boss';
import type { FastifyInstance } from 'fastify';

const prisma = testPrisma();
let queue: PgBoss;
let app: FastifyInstance;
let cookie: Record<string, string>;
let qomon: InMemoryQomon;
const children = new Set<ChildProcess>();
beforeEach(async () => {
  await resetDb(prisma);
  await seedBaseline(prisma);
  const user = await prisma.user.create({
    data: {
      name: 'Queue operator',
      email: 'queue@gpo.test',
      roleKey: 'sysadmin',
      passwordHash: await hashPassword('queue-test-password'),
    },
  });
  await prisma.qomonSettings.create({
    data: { id: 'singleton', enabled: true, apiKey: 'private-key' },
  });
  queue = await openSweepQueue(process.env.DATABASE_URL!);
  qomon = new InMemoryQomon();
  app = await buildApp({
    prisma,
    sweepQueue: queue,
    buildQomon: () => qomon,
    sessionSecret: 'test-session-secret-at-least-32-characters',
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: 'queue-test-password' },
  });
  cookie = { [login.cookies[0]!.name]: login.cookies[0]!.value };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      await closed;
    }
  }
  children.clear();
  await app?.close();
  await queue?.stop();
});

const create = (mode: 'incremental' | 'full' = 'incremental') =>
  app.inject({
    method: 'POST',
    url: '/admin/sweeps',
    cookies: cookie,
    payload: { target: { kind: 'party' }, mode },
  });

it.each(['incremental', 'full'] as const)(
  'queues a %s scan and exposes its durable lifecycle and result',
  async (mode) => {
    await prisma.syncCursor.create({
      data: { feedKind: 'qomon-poll', since: '2026-03-01T00:00:00.000Z' },
    });
    qomon.seedContact({ id: 501, firstname: 'Async' });
    qomon.seedBundle({
      CreatedAt: '2026-03-02T00:00:00.000Z',
      UpdatedAt: '2026-03-02T00:00:00.000Z',
      transactions: [
        { contact_id: 501, amount: 100, date: '2026-03-01', status_id: 1 },
      ],
    });
    qomon.seedBundle({
      CreatedAt: '2026-02-01T00:00:00.000Z',
      UpdatedAt: '2026-02-01T00:00:00.000Z',
      transactions: [
        { contact_id: 501, amount: 200, date: '2026-02-01', status_id: 1 },
      ],
    });
    const response = await create(mode);
    expect(response.statusCode).toBe(202);
    const run = response.json();
    expect(run).toMatchObject({
      status: 'QUEUED',
      target: { kind: 'party' },
      mode,
      triggerSource: 'MANUAL',
    });
    expect(await prisma.payment.count()).toBe(0);
    expect(qomon.callCount).toBe(0);
    const queued = await app.inject({
      method: 'GET',
      url: `/admin/sweeps/${run.id}`,
      cookies: cookie,
    });
    expect(queued.json()).toMatchObject({ id: run.id, status: 'QUEUED', mode });
    expect(JSON.stringify(run)).not.toContain('private-key');
    const [job] = await queue.findJobs<{ runId: string }>(SWEEP_QUEUE);
    expect(job!.data).toEqual({ runId: run.id });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const statuses = qomon.listTransactionStatuses.bind(qomon);
    vi.spyOn(qomon, 'listTransactionStatuses').mockImplementation(async () => {
      await gate;
      return statuses();
    });
    try {
      await startSweepConsumer(queue, { prisma, buildQomon: () => qomon });
      await expect
        .poll(
          async () =>
            (await prisma.sweepRun.findUniqueOrThrow({ where: { id: run.id } }))
              .status,
        )
        .toBe('RUNNING');
      const running = await app.inject({
        method: 'GET',
        url: `/admin/sweeps/${run.id}`,
        cookies: cookie,
      });
      expect(running.json()).toMatchObject({
        status: 'RUNNING',
        startedAt: expect.any(String),
      });
    } finally {
      release();
    }
    await expect
      .poll(
        async () =>
          (await prisma.sweepRun.findUniqueOrThrow({ where: { id: run.id } }))
            .status,
      )
      .toBe('SUCCEEDED');
    await expect
      .poll(async () => (await queue.findJobs(SWEEP_QUEUE))[0]?.state)
      .toBe('completed');
    const detail = await app.inject({
      method: 'GET',
      url: `/admin/sweeps/${run.id}`,
      cookies: cookie,
    });
    expect(detail.json()).toMatchObject({
      id: run.id,
      status: 'SUCCEEDED',
      completedAt: expect.any(String),
      result: { mode, created: mode === 'full' ? 2 : 1, hasMore: false },
    });
    expect(await prisma.payment.count()).toBe(mode === 'full' ? 2 : 1);
  },
);

it('rejects unavailable targets and unauthorized callers without enqueueing', async () => {
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/admin/sweeps',
        payload: { target: { kind: 'party' }, mode: 'full' },
      })
    ).statusCode,
  ).toBe(401);
  await prisma.user.update({
    where: { email: 'queue@gpo.test' },
    data: { roleKey: 'readonly' },
  });
  expect((await create()).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/admin/sweeps/a4b27721-cfaf-40b4-a199-678d68189ff8',
        cookies: cookie,
      })
    ).statusCode,
  ).toBe(403);
  await prisma.user.update({
    where: { email: 'queue@gpo.test' },
    data: { roleKey: 'sysadmin' },
  });
  await prisma.qomonSettings.update({
    where: { id: 'singleton' },
    data: { enabled: false },
  });
  expect((await create()).statusCode).toBe(409);
  expect(await prisma.sweepRun.count()).toBe(0);
  expect(await queue.fetch(SWEEP_QUEUE)).toEqual([]);
});

it('rolls back the application run when pg-boss enqueueing fails', async () => {
  // A real queue failure, inside the same transaction as the application insert.
  await prisma.$executeRaw`UPDATE pgboss.queue SET name = 'temporarily-unavailable' WHERE name = ${SWEEP_QUEUE}`;
  try {
    expect((await create()).statusCode).toBe(500);
    expect(await prisma.sweepRun.count()).toBe(0);
  } finally {
    await prisma.$executeRaw`UPDATE pgboss.queue SET name = ${SWEEP_QUEUE} WHERE name = 'temporarily-unavailable'`;
  }
});

it('persists a sanitized failed result and rejects the worker execution', async () => {
  const response = await create();
  const [job] = await queue.fetch<{ runId: string }>(SWEEP_QUEUE);
  await expect(
    processSweepRun(
      {
        prisma,
        buildQomon: () => {
          throw new Error('private-key');
        },
      },
      job!.data.runId,
    ),
  ).rejects.toThrow('Qomon sweep execution failed');
  await queue.fail(SWEEP_QUEUE, job!.id, {
    message: 'Qomon sweep execution failed',
  });
  const detail = await app.inject({
    method: 'GET',
    url: `/admin/sweeps/${response.json().id}`,
    cookies: cookie,
  });
  expect(detail.json()).toMatchObject({
    status: 'FAILED',
    error: 'Qomon sweep execution failed',
  });
  expect(detail.body).not.toContain('private-key');
});

it('checks schema compatibility without running runtime migrations', async () => {
  const [before] = await prisma.$queryRaw<
    { version: number }[]
  >`SELECT version FROM pgboss.version`;
  try {
    await prisma.$executeRaw`UPDATE pgboss.version SET version = 0`;
    await expect(openSweepQueue(process.env.DATABASE_URL!)).rejects.toThrow(
      'run migrate:deploy',
    );
    expect(await prisma.$queryRaw`SELECT version FROM pgboss.version`).toEqual([
      { version: 0 },
    ]);
  } finally {
    await prisma.$executeRaw`UPDATE pgboss.version SET version = ${before!.version}`;
  }
});

it.each([undefined, '7'])(
  'cleans up finished jobs using retention %s without deleting application history',
  async (days) => {
    if (days === undefined) vi.stubEnv('SWEEP_JOB_RETENTION_DAYS', undefined);
    else vi.stubEnv('SWEEP_JOB_RETENTION_DAYS', days);
    const response = await create();
    const [job] = await queue.findJobs(SWEEP_QUEUE);
    const retentionDays = Number(days ?? 30);
    expect(job!.deleteAfterSeconds).toBe(retentionDays * 86400);
    const [claimed] = await queue.fetch(SWEEP_QUEUE);
    await processSweepRun(
      { prisma, buildQomon: () => qomon },
      response.json().id,
    );
    await queue.complete(SWEEP_QUEUE, claimed!.id);
    await prisma.$executeRaw`UPDATE pgboss.job SET completed_on = now() - (${retentionDays - 1} * interval '1 day') WHERE id = ${claimed!.id}::uuid`;
    // Time travel also needs to make pg-boss's throttled maintenance pass due.
    await prisma.$executeRaw`UPDATE pgboss.queue SET maintain_on = NULL WHERE name = ${SWEEP_QUEUE}`;
    await queue.supervise(SWEEP_QUEUE);
    expect((await queue.findJobs(SWEEP_QUEUE))[0]?.id).toBe(job!.id);
    await prisma.$executeRaw`UPDATE pgboss.job SET completed_on = now() - (${retentionDays + 1} * interval '1 day') WHERE id = ${claimed!.id}::uuid`;
    await prisma.$executeRaw`UPDATE pgboss.queue SET maintain_on = NULL WHERE name = ${SWEEP_QUEUE}`;
    await queue.supervise(SWEEP_QUEUE);
    expect(await queue.findJobs(SWEEP_QUEUE)).toEqual([]);
    const detail = await app.inject({
      method: 'GET',
      url: `/admin/sweeps/${response.json().id}`,
      cookies: cookie,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      status: 'SUCCEEDED',
      result: { mode: 'incremental' },
    });
  },
);

function workerProcess() {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/sweeps/worker.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, SESSION_SECRET: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.add(child);
  let output = '';
  child.stdout!.on('data', (data) => {
    output += String(data);
  });
  child.stderr!.on('data', (data) => {
    output += String(data);
  });
  return { child, output: () => output };
}

it('starts a separate worker without HTTP settings and shuts down cleanly', async () => {
  const worker = workerProcess();
  await expect
    .poll(worker.output, { timeout: 10_000 })
    .toContain('Sweep worker ready');
  const closed = once(worker.child, 'close');
  worker.child.kill('SIGTERM');
  const [code] = await closed;
  expect(code).toBe(0);
});

it('exits non-zero on execution failure and persists the failed run', async () => {
  const response = await create();
  await prisma.qomonSettings.update({
    where: { id: 'singleton' },
    data: { enabled: false },
  });
  const worker = workerProcess();
  const [code] = await once(worker.child, 'close');
  expect(code).toBe(1);
  expect(worker.output()).not.toContain('private-key');
  expect(
    await prisma.sweepRun.findUniqueOrThrow({
      where: { id: response.json().id },
    }),
  ).toMatchObject({
    status: 'FAILED',
    error: 'Qomon sweep execution failed',
  });
  expect((await queue.findJobs(SWEEP_QUEUE))[0]?.state).toBe('failed');
});

it('stores contact warnings with a successful terminal outcome', async () => {
  const response = await create();
  qomon.seedBundle({
    transactions: [
      { contact_id: 999, amount: 100, date: '2026-03-01', status_id: 1 },
    ],
  });
  const [job] = await queue.fetch<{ runId: string }>(SWEEP_QUEUE);
  await processSweepRun({ prisma, buildQomon: () => qomon }, job!.data.runId);
  await queue.complete(SWEEP_QUEUE, job!.id);
  const detail = await app.inject({
    method: 'GET',
    url: `/admin/sweeps/${response.json().id}`,
    cookies: cookie,
  });
  expect(detail.json()).toMatchObject({
    status: 'SUCCEEDED_WITH_WARNINGS',
    result: { contactFetchFailures: [{ qomonContactId: 999 }], hasMore: false },
  });
});

it('installs the migration SQL into a fresh namespace and preserves jobs on replay', async () => {
  const sql = readFileSync(
    new URL(
      '../../prisma/migrations/20261102000100_pgboss/migration.sql',
      import.meta.url,
    ),
    'utf8',
  ).replaceAll('pgboss', 'pgboss_migration_test');
  const db = queue.getDb();
  const fresh = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: 'pgboss_migration_test',
    migrate: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  try {
    await db.executeSql(sql);
    await fresh.start();
    expect(await fresh.getQueue(SWEEP_QUEUE)).toMatchObject({
      policy: 'singleton',
      retryLimit: 0,
      expireInSeconds: 86400,
      deleteAfterSeconds: 0,
      retentionSeconds: 30 * 86400,
    });
    const id = await fresh.send(SWEEP_QUEUE, { marker: 'preserved' });
    await db.executeSql(sql);
    expect((await fresh.findJobs(SWEEP_QUEUE))[0]).toMatchObject({
      id,
      data: { marker: 'preserved' },
      state: 'created',
    });
  } finally {
    await fresh.stop();
    await db.executeSql('DROP SCHEMA IF EXISTS pgboss_migration_test CASCADE');
  }
});

it('preserves the recorded mode for previously queued incremental work', async () => {
  const response = await create();
  await prisma.sweepRun.update({
    where: { id: response.json().id },
    data: { mode: 'incremental' },
  });
  await prisma.syncCursor.create({
    data: { feedKind: 'qomon-poll', since: '2099-01-01T00:00:00.000Z' },
  });
  qomon.seedBundle({
    transactions: [
      { contact_id: 501, amount: 100, date: '2026-03-01', status_id: 1 },
    ],
  });
  const result = await processSweepRun(
    { prisma, buildQomon: () => qomon },
    response.json().id,
  );
  expect(result).toMatchObject({ mode: 'incremental', pulled: 0 });
});

it('defaults new API requests and database records to incremental', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/admin/sweeps',
    cookies: cookie,
    payload: { target: { kind: 'party' } },
  });
  expect(response.statusCode).toBe(202);
  expect(response.json()).toMatchObject({
    mode: 'incremental',
    status: 'QUEUED',
  });
  const result = await processSweepRun(
    { prisma, buildQomon: () => qomon },
    response.json().id,
  );
  expect(result.mode).toBe('incremental');
  const [row] = await prisma.$queryRaw<{ mode: string }[]>`
    INSERT INTO sweep_run (id, "requestedByUserId")
    SELECT gen_random_uuid(), id FROM app_user WHERE email = 'queue@gpo.test'
    RETURNING mode
  `;
  expect(row!.mode).toBe('incremental');
});

it.each(['incremental', 'full'] as const)(
  'queues a riding %s sweep with current credentials and complete history',
  async (mode) => {
    await prisma.riding.create({
      data: { ridingNumber: 7, name: 'Seven', qomonApiKey: 'old-key' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/admin/sweeps',
      cookies: cookie,
      payload: { target: { kind: 'riding', ridingNumber: 7 }, mode },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      target: { kind: 'riding', ridingNumber: 7 },
      attemptCount: 0,
      durationMs: null,
    });
    await prisma.riding.update({
      where: { ridingNumber: 7 },
      data: { qomonApiKey: 'rotated-key' },
    });
    const buildQomon = vi.fn(() => qomon);
    await processSweepRun({ prisma, buildQomon }, response.json().id);
    expect(buildQomon).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'rotated-key' }),
    );
    const detail = await app.inject({
      url: `/admin/sweeps/${response.json().id}`,
      cookies: cookie,
    });
    expect(detail.json()).toMatchObject({
      status: 'SUCCEEDED',
      attemptCount: 1,
      durationMs: expect.any(Number),
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      requestedByUserId: expect.any(String),
      result: {
        mode,
        pulled: 0,
        created: 0,
        backfilled: 0,
        changedInQomon: 0,
        unchanged: 0,
        syncIncidents: 0,
        hasMore: false,
        contactFetchFailures: [],
      },
    });
    expect(detail.body).not.toContain('rotated-key');
    expect((await queue.findJobs(SWEEP_QUEUE))[0]!.data).toEqual({
      runId: response.json().id,
    });
  },
);

it('rejects unknown, inactive, and unconfigured riding targets before creating work', async () => {
  for (const state of ['unknown', 'inactive', 'missing-key']) {
    if (state !== 'unknown')
      await prisma.riding.upsert({
        where: { ridingNumber: 7 },
        create: {
          ridingNumber: 7,
          name: 'Seven',
          active: false,
          qomonApiKey: 'key',
        },
        update: { active: true, qomonApiKey: '  ' },
      });
    const response = await app.inject({
      method: 'POST',
      url: '/admin/sweeps',
      cookies: cookie,
      payload: { target: { kind: 'riding', ridingNumber: 7 }, mode: 'full' },
    });
    expect(response.statusCode).toBe(409);
  }
  await prisma.qomonSettings.update({
    where: { id: 'singleton' },
    data: { apiKey: ' ' },
  });
  expect((await create()).statusCode).toBe(409);
  expect(await prisma.sweepRun.count()).toBe(0);
  expect(await queue.findJobs(SWEEP_QUEUE)).toEqual([]);
});

it('records remote authentication rejection as a sanitized non-retryable failure', async () => {
  const response = await create();
  const error = new QomonAuthError('private-key confidential-body', {
    method: 'GET',
    path: '/',
    attempt: 1,
    httpStatus: 401,
  });
  await expect(
    processSweepRun(
      {
        prisma,
        buildQomon: () => {
          throw error;
        },
      },
      response.json().id,
    ),
  ).rejects.toMatchObject({ retryable: false });
  const detail = await app.inject({
    url: `/admin/sweeps/${response.json().id}`,
    cookies: cookie,
  });
  expect(detail.json()).toMatchObject({
    status: 'FAILED',
    attemptCount: 1,
    durationMs: expect.any(Number),
    error: 'Qomon sweep execution failed',
  });
  expect(detail.body).not.toMatch(/private-key|confidential-body/);
});

it('browses newest-first history with stable pagination and all filters', async () => {
  const first = (await create('full')).json();
  const second = (await create()).json();
  await prisma.sweepRun.update({
    where: { id: first.id },
    data: { status: 'FAILED' },
  });
  const get = (query = '') =>
    app.inject({ url: `/admin/sweeps${query}`, cookies: cookie });
  const page = (await get('?limit=1')).json();
  expect(page.data.map((r: { id: string }) => r.id)).toEqual([second.id]);
  expect(page.nextCursor).toEqual(expect.any(String));
  const next = (
    await get(`?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`)
  ).json();
  expect(next.data.map((r: { id: string }) => r.id)).toEqual([first.id]);
  expect(next.nextCursor).toBeNull();
  expect(
    (
      await get('?status=FAILED&mode=full&triggerSource=MANUAL&target=party')
    ).json().data,
  ).toHaveLength(1);
  expect((await get('?target=riding:7')).json().data).toHaveLength(0);
  expect((await get('?triggerSource=SCHEDULED')).json().data).toHaveLength(0);
  expect((await get('?cursor=invalid')).statusCode).toBe(400);
  await prisma.sweepRun.createMany({
    data: Array.from({ length: 26 }, () => ({
      requestedByUserId: first.requestedByUserId,
    })),
  });
  expect((await get()).json().data).toHaveLength(25);
  expect((await app.inject({ url: '/admin/sweeps' })).statusCode).toBe(401);
  await prisma.user.update({
    where: { email: 'queue@gpo.test' },
    data: { roleKey: 'readonly' },
  });
  expect((await get()).statusCode).toBe(403);
});

it('sanitizes warning text retained by older workers in both history and details', async () => {
  const response = await create();
  await prisma.sweepRun.update({
    where: { id: response.json().id },
    data: {
      status: 'SUCCEEDED_WITH_WARNINGS',
      result: {
        mode: 'incremental',
        pulled: 1,
        created: 0,
        backfilled: 0,
        changedInQomon: 0,
        unchanged: 0,
        syncIncidents: 0,
        cursor: {},
        hasMore: false,
        contactFetchFailures: [
          {
            qomonTransactionId: '123',
            qomonContactId: 999,
            message: 'private-key confidential-response-body',
          },
        ],
      },
    },
  });
  for (const url of ['/admin/sweeps', `/admin/sweeps/${response.json().id}`]) {
    const detail = await app.inject({ url, cookies: cookie });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toMatch(/private-key|confidential-response-body/);
    expect(detail.body).toContain(
      'Qomon contact was not found; transaction skipped',
    );
    expect(detail.body).toContain('123');
  }
});
