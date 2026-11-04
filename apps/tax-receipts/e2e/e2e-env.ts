import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const API_DIR = path.resolve(here, '../api');
export const WEB_DIR = path.resolve(here, '../web');

export const API_PORT = 3100;
export const WEB_PORT = 5174;
export const BASE_URL = `http://localhost:${WEB_PORT}`;

/**
 * The environment the e2e API server and the seed scripts run under. It is
 * built from scratch rather than read from api/.env, so that:
 *  - the database is a separate `tax_receipts_e2e` on the dev Postgres
 *    (`pnpm db:dev:up`), reset on every run, never the dev data;
 *  - nothing here can enable Qomon: it is a database setting (Admin >
 *    Qomon) the fresh database never turns on, so every contributor added
 *    or edited is tool-owned (D13); global-setup.ts checks it is off;
 *  - email stays on the `dev` adapter, which sends nothing.
 */
export const e2eEnv: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  NODE_ENV: 'development',
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    'postgresql://gpo:gpo@localhost:5434/tax_receipts_e2e?schema=public',
  SESSION_SECRET: 'e2e-session-secret-not-for-any-real-environment',
  PORT: String(API_PORT),
  HOST: '127.0.0.1',
  ARTIFACT_STORAGE_DIR: path.resolve(here, '.storage/artifacts'),
  EMAIL_PROVIDER: 'dev',
  PUBLIC_WEB_URL: BASE_URL,
};
