import { expect, it } from 'vitest';
import { queueEnvironment } from './queue.js';

const DATABASE_URL = 'postgresql://gpo:gpo@localhost:5433/tax_receipts_test';

it('defaults finished-job retention to 30 days', () => {
  expect(queueEnvironment({ DATABASE_URL })).toMatchObject({
    SWEEP_JOB_RETENTION_DAYS: 30,
  });
});

it('accepts a configured finished-job retention', () => {
  expect(
    queueEnvironment({ DATABASE_URL, SWEEP_JOB_RETENTION_DAYS: '7' }),
  ).toMatchObject({ SWEEP_JOB_RETENTION_DAYS: 7 });
});

it.each(['', '0', '-1', '1.5', 'invalid', '24856'])(
  'rejects invalid retention %s without exposing configuration values',
  (retention) => {
    expect(() =>
      queueEnvironment({
        DATABASE_URL,
        SWEEP_JOB_RETENTION_DAYS: retention,
      }),
    ).toThrow('Sweep queue environment is invalid');
  },
);
