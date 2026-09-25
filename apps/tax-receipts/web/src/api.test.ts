import { afterEach, expect, test, vi } from 'vitest';
import { api } from './api.js';
import { jsonResponse } from './test/fixtures.js';

/**
 * Fastify's default JSON body parser 400s ("Body cannot be empty when
 * content-type is set to 'application/json'") on a request that carries
 * that header but sends no body — e.g. a bodyless POST like "Refresh from
 * Qomon" or logout. This was silently breaking every such call from the
 * browser (only caught once an error was actually surfaced in the UI);
 * pin the fix so it can't regress.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a bodyless POST does not send a Content-Type header', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);

  await api.logout();

  const init = fetchMock.mock.calls[0]?.[1];
  expect(init?.headers).not.toHaveProperty('Content-Type');
});

test('a POST with a JSON body still sends the Content-Type header', async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    jsonResponse({ id: 'u1', name: 'Terry', role: 'admin' }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await api.login('terry@example.org', 'password');

  const init = fetchMock.mock.calls[0]?.[1];
  expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
});
