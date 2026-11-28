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
  attemptCount: 0,
  durationMs: null,
};
let calls: { url: string; body?: string; method?: string }[];
let status: string;
let createStatus: number;
let manageSystem: boolean;
let historyRows: object[];
let result: object | null;
let nextCursor: string | null;
let detailStatus: number;
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  calls = [];
  historyRows = [];
  result = null;
  nextCursor = null;
  detailStatus = 200;
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
      if (String(url).includes('/admin/ridings'))
        return jsonResponse({
          data: [
            {
              ridingNumber: 7,
              name: 'Seven',
              active: true,
              qomonApiKeySet: true,
            },
          ],
        });
      if (String(url).includes('/admin/sweeps?'))
        return jsonResponse({ data: historyRows, nextCursor });
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
        return detailStatus === 404
          ? jsonResponse({ error: 'Sweep run not found' }, 404)
          : jsonResponse({
              ...run,
              status,
              result,
              error:
                status === 'FAILED' ? 'Qomon sweep execution failed' : null,
            });
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

test('queues party incremental work and opens its dedicated detail page', async () => {
  const router = renderPage();
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'New sweep',
    }),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Queue sweep' }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/admin/sweep/${id}`),
  );
  expect(
    await screen.findByText('Queued', { selector: 'span' }),
  ).toBeInTheDocument();
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
  renderPage(`/admin/sweep/${id}`);
  expect(
    await screen.findByText('Queued', { selector: 'span' }),
  ).toBeInTheDocument();
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
      name: 'New sweep',
    }),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Queue sweep' }));
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

test('queues a selected full riding sweep', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'New sweep' }));
  fireEvent.change(screen.getByLabelText('Mode'), {
    target: { value: 'full' },
  });
  fireEvent.change(screen.getByLabelText('Target'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Queue sweep' }));
  await screen.findByText(`Run: ${id}`);
  expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({
    target: { kind: 'riding', ridingNumber: 7 },
    mode: 'full',
  });
});

test('browses history, paginates, and resets pagination when filtering', async () => {
  historyRows = [
    { ...run, status: 'FAILED', target: { kind: 'riding', ridingNumber: 7 } },
  ];
  nextCursor = 'next-page';
  renderPage();
  expect(await screen.findByText('Seven (Riding 7)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Older' }));
  await waitFor(() =>
    expect(calls.some((c) => c.url.includes('cursor=next-page'))).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('Status filter'), {
    target: { value: 'FAILED' },
  });
  fireEvent.change(screen.getByLabelText('Mode filter'), {
    target: { value: 'full' },
  });
  fireEvent.change(screen.getByLabelText('Trigger filter'), {
    target: { value: 'MANUAL' },
  });
  fireEvent.change(screen.getByLabelText('Target filter'), {
    target: { value: 'riding:7' },
  });
  await waitFor(() => {
    const last = calls.filter((c) => c.url.includes('/admin/sweeps?')).at(-1)!;
    const query = new URL(last.url, 'https://test.example').searchParams;
    expect(Object.fromEntries(query)).toEqual({
      status: 'FAILED',
      mode: 'full',
      triggerSource: 'MANUAL',
      target: 'riding:7',
    });
  });
  expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();
  status = 'FAILED';
  fireEvent.click(screen.getByRole('link', { name: 'Details' }));
  expect(
    await screen.findByText('Qomon sweep execution failed'),
  ).toBeInTheDocument();
});

test('shows complete successful results and warning details', async () => {
  status = 'SUCCEEDED_WITH_WARNINGS';
  result = {
    mode: 'full',
    pulled: 9,
    created: 2,
    backfilled: 1,
    changedInQomon: 3,
    unchanged: 2,
    syncIncidents: 1,
    cursor: { since: '2026-11-01T00:00:00Z' },
    hasMore: false,
    contactFetchFailures: [
      {
        qomonTransactionId: '123',
        qomonContactId: 999,
        message: 'Qomon contact was not found; transaction skipped',
      },
    ],
  };
  renderPage(`/admin/sweep/${id}`);
  expect(
    await screen.findByText('Succeeded with warnings', { selector: 'span' }),
  ).toBeInTheDocument();
  for (const text of [
    'Transactions processed: 9',
    'New payments: 2',
    'Metadata backfilled: 1',
    'Changed in Qomon: 3',
    'Unchanged: 2',
    'Deletion incidents: 1',
    'Has more: No',
  ])
    expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.getByText(/Cursor:.*2026-11-01/)).toBeInTheDocument();
  expect(screen.getByText(/Transaction 123, contact 999/)).toBeInTheDocument();
});

test('polls displayed active history every minute and stops after completion', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  historyRows = [run];
  renderPage();
  expect(
    await screen.findByText('Queued', { selector: 'span' }),
  ).toBeInTheDocument();
  const count = () =>
    calls.filter((c) => c.url.includes('/admin/sweeps?')).length;
  const initial = count();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_999);
  });
  expect(count()).toBe(initial);
  historyRows = [{ ...run, status: 'SUCCEEDED' }];
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(count()).toBe(initial + 1);
  expect(
    await screen.findByText('Succeeded', { selector: 'span' }),
  ).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180_000);
  });
  expect(count()).toBe(initial + 1);
});

test('filters permanent history by a riding no longer in the directory', async () => {
  renderPage();
  const field = await screen.findByLabelText('Riding number filter');
  fireEvent.change(field, { target: { value: '999' } });
  await waitFor(() =>
    expect(calls.some((c) => c.url.includes('target=riding%3A999'))).toBe(true),
  );
});

test('opens details on a separate page with a back link to sweep history', async () => {
  historyRows = [run];
  const router = renderPage();
  const details = await screen.findByRole('link', { name: 'Details' });
  expect(details).toHaveAttribute('href', `/admin/sweep/${id}`);
  expect(screen.queryByText(`Run: ${id}`)).not.toBeInTheDocument();
  fireEvent.click(details);
  expect(await screen.findByText(`Run: ${id}`)).toBeInTheDocument();
  expect(screen.queryByLabelText('Status filter')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'New sweep' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: /Back to sweeps/ }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/admin/sweep'),
  );
  expect(
    await screen.findByRole('button', { name: 'New sweep' }),
  ).toBeInTheDocument();
  expect(screen.queryByText(`Run: ${id}`)).not.toBeInTheDocument();
});

test('redirects saved runId links to the dedicated detail page', async () => {
  const router = renderPage(`/admin/sweep?runId=${id}`);
  expect(await screen.findByText(`Run: ${id}`)).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(`/admin/sweep/${id}`);
  expect(calls.some((c) => c.url.includes('/admin/sweeps?'))).toBe(false);
});

test('prevents non-sysadmins from loading a direct detail link', async () => {
  manageSystem = false;
  const router = renderPage(`/admin/sweep/${id}`);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/admin/periods'),
  );
  expect(calls.some((c) => c.url.includes('/admin/sweeps'))).toBe(false);
});

test('keeps the back link available when a run cannot be found', async () => {
  detailStatus = 404;
  renderPage(`/admin/sweep/${id}`);
  expect(
    await screen.findByText('Could not load sweep: Sweep run not found'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Back to sweeps/ })).toHaveAttribute(
    'href',
    '/admin/sweep',
  );
  expect(calls.some((c) => c.url.includes('/admin/sweeps?'))).toBe(false);
});
