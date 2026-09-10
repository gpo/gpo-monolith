import { execSync } from 'node:child_process';

/**
 * Runs once before the api test suite: applies migrations to the database in
 * DATABASE_URL. Locally that database comes from `pnpm db:test:up` (or the
 * scratchpad Postgres); in CI it is the Postgres service container.
 */
export default function setup(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required for @gpo/tax-receipts-api tests.\n' +
        'Start one with `pnpm db:test:up` (Docker) and export\n' +
        'DATABASE_URL="postgresql://gpo:gpo@localhost:5433/tax_receipts_test".',
    );
  }
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
}
