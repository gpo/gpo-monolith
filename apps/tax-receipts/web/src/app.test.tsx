import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
} from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from './router.js';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/spaces')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                periodId: 67,
                ridingNumber: 84,
                entityKind: 'CA',
                stage: 'intake',
                stageOwner: null,
                contributionCount: 3,
                openWorkItemCount: 1,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ error: 'not authenticated' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the shell renders the space dashboard', async () => {
  const router = makeRouter(
    createMemoryHistory({ initialEntries: ['/'] }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );

  expect(
    await screen.findByText('GPO Tax Receipts & Contributions'),
  ).toBeInTheDocument();
  expect(await screen.findByText('CA')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText('Not signed in. Use the Sign in link.')).toBeInTheDocument();
});
