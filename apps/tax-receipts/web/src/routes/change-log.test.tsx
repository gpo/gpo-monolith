import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';

const PAGE = {
  data: [
    {
      id: 'e1',
      subjectType: 'ContributionMetadata',
      subjectId: 'c1',
      actorUserId: null,
      actorName: null,
      reason: 'mirror sweep: new transaction, ticket-1.1 intake defaults applied',
      before: null,
      after: { periodId: 67 },
      at: '2026-03-01T12:00:00.000Z',
      correlationId: 'corr1',
    },
  ],
  nextCursor: null,
};

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/change-log')) {
        return new Response(JSON.stringify(PAGE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/change-log'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('lists entries with reason, actor, and before/after', async () => {
  renderPage();
  expect(await screen.findByText(/mirror sweep: new transaction/)).toBeInTheDocument();
  expect(screen.getByText('System')).toBeInTheDocument();
  expect(screen.getByText('ContributionMetadata (c1)')).toBeInTheDocument();
});

test('a subject-id filter re-queries with the param set', async () => {
  renderPage();
  await screen.findByText(/mirror sweep/);
  calls = [];
  fireEvent.change(screen.getByLabelText('Subject id'), { target: { value: 'c1' } });
  await waitFor(() => expect(calls.some((u) => u.includes('subjectId=c1'))).toBe(true));
});

test('the export link points at the CSV export endpoint with current filters', async () => {
  renderPage();
  await screen.findByText(/mirror sweep/);
  fireEvent.change(screen.getByLabelText('Subject id'), { target: { value: 'c1' } });
  const link = await screen.findByRole('link', { name: 'Export CSV (for EO)' });
  expect(link).toHaveAttribute('href', expect.stringContaining('/change-log/export'));
  expect(link).toHaveAttribute('href', expect.stringContaining('subjectId=c1'));
});
