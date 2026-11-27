import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/** env.ts requires a positive PORT, so borrow a free one from the OS. */
async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

it('closes and exits 0 on SIGTERM', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      SESSION_SECRET: 'test-session-secret-at-least-32-characters',
      ARTIFACT_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'server-test-')),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (data) => (output += String(data)));
  child.stderr!.on('data', (data) => (output += String(data)));
  try {
    await expect
      .poll(() => output, { timeout: 15_000 })
      .toContain('Server listening');
    const closed = once(child, 'close');
    child.kill('SIGTERM');
    const [code, signal] = await closed;
    expect({ code, signal }).toEqual({ code: 0, signal: null });
    expect(output).toContain('shut down cleanly');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}, 30_000);
