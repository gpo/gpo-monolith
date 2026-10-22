import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { API_DIR, API_PORT, e2eEnv } from './e2e-env.js';

/**
 * Rebuild the e2e database from nothing before every run: migrate, then the
 * base seed (periods, limits, ridings, the seven users) and the fixture
 * groups the EO evaluation scenarios are written against. Tests share this
 * one database and run serially, so a test that changes a fixture can affect
 * the ones after it; see README.md.
 *
 * Then refuse to run unless Qomon is off: the tests add and edit
 * contributors, which with Qomon enabled would be written to a real Qomon
 * space. A fresh database never enables it (Admin > Qomon), so this only
 * trips on a database someone enabled by hand.
 */
export default async function globalSetup() {
  if (process.env.E2E_SKIP_RESET !== '1') resetDatabase();
  await assertQomonOff();
}

function resetDatabase() {
  rmSync(e2eEnv.ARTIFACT_STORAGE_DIR!, { recursive: true, force: true });
  const run = (args: string[]) =>
    execFileSync('pnpm', ['exec', ...args], { cwd: API_DIR, env: e2eEnv, stdio: 'inherit' });

  run(['prisma', 'migrate', 'reset', '--force', '--skip-seed']);
  run(['tsx', 'prisma/seed.ts']);
  run(['tsx', 'prisma/seed-fixtures.ts']);
}

async function assertQomonOff() {
  const api = `http://127.0.0.1:${API_PORT}`;
  const login = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'sysadmin@gpo.test', password: 'change-me-please-12345' }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!login.ok || !cookie) throw new Error(`e2e setup: could not sign in as sysadmin (${login.status})`);
  const res = await fetch(`${api}/admin/qomon-settings`, { headers: { cookie } });
  if (!res.ok) throw new Error(`e2e setup: could not read the Qomon settings (${res.status})`);
  const settings = (await res.json()) as { enabled: boolean };
  if (settings.enabled) {
    throw new Error('e2e setup: Qomon is enabled on the e2e database; the tests would write to a real Qomon space. Turn it off under Admin > Qomon or reset the database.');
  }
}
