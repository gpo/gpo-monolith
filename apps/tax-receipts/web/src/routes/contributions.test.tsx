import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';

const PAGE = {
  data: [
    {
      id: 'c1',
      qomonTransactionId: '1',
      contactName: 'Dana Donor',
      contactEmail: 'dana@example.org',
      amountCents: 5_000,
      currency: 'cad',
      acceptedAt: '2026-03-01T12:00:00.000Z',
      statusKind: 'valid',
      periodId: 67,
      ridingNumber: 84,
      entityKind: 'CA',
      receivedBy: 'ENTITY',
      sourceCode: 'subspace:84',
      nonDeductibleCents: 0,
      hasReceipt: false,
      openValidationCount: 1,
      lastSyncedAt: null,
    },
  ],
  nextCursor: null,
};

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/contributions')) {
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
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/contributions'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('lists contributions with their columns', async () => {
  renderPage();
  expect(await screen.findByText('Dana Donor')).toBeInTheDocument();
  expect(screen.getByText('$50.00')).toBeInTheDocument();
  expect(screen.getByText('84')).toBeInTheDocument();
});

test('a donor-search filter re-queries with the query param set', async () => {
  renderPage();
  await screen.findByText('Dana Donor');
  calls = [];

  const input = screen.getByLabelText('Donor (name or email)');
  fireEvent.change(input, { target: { value: 'dana' } });

  await waitFor(() =>
    expect(calls.some((u) => u.includes('contactQuery=dana'))).toBe(true),
  );
});

test('the column picker can hide a column', async () => {
  renderPage();
  await screen.findByText('Dana Donor');
  expect(screen.getByRole('columnheader', { name: 'Source code' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
  fireEvent.click(await screen.findByLabelText('Source code'));

  await waitFor(() =>
    expect(screen.queryByRole('columnheader', { name: 'Source code' })).not.toBeInTheDocument(),
  );
});

test('saving a filter persists it to localStorage', async () => {
  renderPage();
  await screen.findByText('Dana Donor');

  fireEvent.change(screen.getByLabelText('Donor (name or email)'), { target: { value: 'dana' } });
  fireEvent.change(screen.getByPlaceholderText('Save filter as…'), { target: { value: 'My dana filter' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save current filters' }));

  expect(localStorage.getItem('tax-receipts:contributions-list:saved-filters')).toContain(
    'My dana filter',
  );
});
