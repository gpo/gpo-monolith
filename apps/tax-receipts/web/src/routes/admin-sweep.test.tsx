import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const id = 'a4b27721-cfaf-40b4-a199-678d68189ff8';
const run = {
  id,
  status: 'QUEUED',
  target: { kind: 'party' },
  mode: 'incremental',
  triggerSource: 'MANUAL',
  createdAt: '2026-11-01T00:00:00Z',
  queuedAt: '2026-11-01T00:00:00Z',
  startedAt: null,
  completedAt: null,
  requestedByUserId: 'u1',
  result: null,
  error: null,
};
let calls: { url: string; body?: string; method?: string }[];
let status: string;
let createStatus: number;
let manageSystem: boolean;
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  calls = [];
  status = 'QUEUED';
  createStatus = 202;
  manageSystem = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method,
        body: init?.body as string | undefined,
      });
      if (String(url).includes('/auth/me'))
        return jsonResponse({ ...ME, can: { ...ME.can, manageSystem } });
      if (String(url).endsWith('/admin/sweeps'))
        return createStatus === 202
          ? jsonResponse(run, 202)
          : jsonResponse(
              {
                error:
                  'Qomon party space is disabled or has no API key configured',
              },
              409,
            );
      if (String(url).includes('/admin/sweeps/'))
        return jsonResponse({ ...run, status });
      return jsonResponse({ error: 'not found' }, 404);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderPage(path = '/admin/sweep') {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return router;
}

test('queues party incremental work and keeps the selected run in the URL', async () => {
  const router = renderPage();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Queue party incremental sweep',
    }),
  );
  await waitFor(() => expect(router.state.location.searchStr).toContain(id));
  expect(await screen.findByText('Queued')).toBeInTheDocument();
  const call = calls.find((c) => c.method === 'POST')!;
  expect(JSON.parse(call.body!)).toEqual({
    target: { kind: 'party' },
    mode: 'incremental',
  });
  expect(
    screen.queryByRole('button', { name: /refresh/i }),
  ).not.toBeInTheDocument();
});

test('reloads a selected run, polls only every 60 seconds, and stops at terminal state', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  renderPage(`/admin/sweep?runId=${id}`);
  expect(await screen.findByText('Queued')).toBeInTheDocument();
  const detailCalls = () =>
    calls.filter((c) => c.url.includes('/admin/sweeps/')).length;
  const initial = detailCalls();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_999);
  });
  expect(detailCalls()).toBe(initial);
  status = 'SUCCEEDED';
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(detailCalls()).toBe(initial + 1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180_000);
  });
  expect(detailCalls()).toBe(initial + 1);
});

test('keeps configuration errors visible', async () => {
  createStatus = 409;
  renderPage();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Queue party incremental sweep',
    }),
  );
  expect(
    await screen.findByText(/Qomon party space is disabled/),
  ).toBeInTheDocument();
});

test('hides the tab and prevents access for a non-sysadmin', async () => {
  manageSystem = false;
  const router = renderPage();
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/admin/periods'),
  );
  expect(screen.queryByRole('link', { name: 'Sweep' })).not.toBeInTheDocument();
  expect(calls.some((c) => c.url.includes('/admin/sweeps'))).toBe(false);
});
