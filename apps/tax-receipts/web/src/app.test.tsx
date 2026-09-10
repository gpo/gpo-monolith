import { render, screen, waitFor } from '@testing-library/react';
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
      if (String(url).endsWith('/health')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'gpo-tax-receipts-api',
            time: new Date().toISOString(),
            db: 'up',
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

test('the shell renders the dashboard and reports API health', async () => {
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
  expect(await screen.findByText('Phase 0 shell')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('db up')).toBeInTheDocument());
});
