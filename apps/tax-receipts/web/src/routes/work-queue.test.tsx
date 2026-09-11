import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';

const VALIDATION_PAGE = {
  data: [
    {
      id: 'w1',
      kind: 'VALIDATION',
      subjectType: 'Contribution',
      subjectId: 'c1',
      contactId: 'ct1',
      contactName: 'Dana Donor',
      ruleRef: 'A8',
      dueAt: null,
      status: 'OPEN',
      assigneeUserId: null,
      resolutionNote: null,
      openedAt: '2026-03-01T00:00:00.000Z',
      closedAt: null,
    },
  ],
  nextCursor: null,
};
const EMPTY_PAGE = { data: [], nextCursor: null };

let calls: Array<{ url: string; body?: string }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string | undefined });
      if (String(url).endsWith('/resolve') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ...VALIDATION_PAGE.data[0], status: 'RESOLVED' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('kind=VALIDATION')) {
        return new Response(JSON.stringify(VALIDATION_PAGE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(EMPTY_PAGE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/work-queue'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('shows the validation tab by default with its items', async () => {
  renderPage();
  expect(await screen.findByText('Dana Donor')).toBeInTheDocument();
  expect(screen.getByText('A8')).toBeInTheDocument();
});

test('switching tabs re-queries by kind', async () => {
  renderPage();
  await screen.findByText('Dana Donor');
  calls = [];
  fireEvent.click(screen.getByRole('button', { name: 'Diff queue' }));
  await waitFor(() => expect(calls.some((c) => c.url.includes('kind=DIFF'))).toBe(true));
});

test('resolving an item requires a note and posts the outcome', async () => {
  renderPage();
  await screen.findByText('Dana Donor');

  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  const confirm = screen.getByRole('button', { name: 'Confirm' });
  expect(confirm).toBeDisabled();

  fireEvent.change(screen.getByPlaceholderText('Resolution note'), { target: { value: 'fixed it' } });
  expect(confirm).not.toBeDisabled();
  fireEvent.click(confirm);

  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/resolve'))).toBe(true));
  const call = calls.find((c) => c.url.endsWith('/resolve'));
  expect(JSON.parse(call!.body!)).toMatchObject({ reason: 'fixed it', outcome: 'RESOLVED' });
});
