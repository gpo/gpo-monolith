import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
} from '@tanstack/react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { makeRouter } from './router.js';
import { ME, jsonResponse } from './test/fixtures.js';

function renderApp() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a logged-out visit shows only the login form, not the site', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/auth/me')) {
        return jsonResponse({ error: 'not authenticated' }, 401);
      }
      return jsonResponse({ data: [] });
    }),
  );

  renderApp();

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.queryByText('GPO Tax Receipts & Contributions')).not.toBeInTheDocument();
  expect(screen.queryByText('Spaces')).not.toBeInTheDocument();
});

test('a signed-in visit shows the shell and the space dashboard', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/auth/me')) {
        return jsonResponse(ME);
      }
      if (String(url).includes('/spaces')) {
        return jsonResponse({
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
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    }),
  );

  renderApp();

  expect(
    await screen.findByText('GPO Tax Receipts & Contributions'),
  ).toBeInTheDocument();
  expect(await screen.findByText('CA')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
});
