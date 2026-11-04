import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const OFF = {
  enabled: false,
  apiBase: 'https://incoming.qomon.app',
  apiKeySet: false,
  updatedByUserId: null,
  updatedAt: null,
};

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let settings: { status: number; body: unknown } = { status: 200, body: OFF };

beforeEach(() => {
  calls = [];
  settings = { status: 200, body: OFF };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.includes('/auth/me')) return jsonResponse(ME);
      if (u.includes('/admin/qomon-settings')) {
        if (init?.method === 'PUT') return jsonResponse({ ...OFF, enabled: true, apiKeySet: true });
        return jsonResponse(settings.body, settings.status);
      }
      return jsonResponse({ error: 'not found' }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/admin/qomon'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('enables Qomon with a key and a reason, and needs the key first', async () => {
  renderPage();
  expect(await screen.findByText('Off')).toBeInTheDocument();
  expect(screen.getByText('No key on file.')).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Enabled'));
  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'connect the party space' } });
  expect(screen.getByText('Enter an API key to enable Qomon.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'secret-key-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  const put = calls.find((c) => c.method === 'PUT')!;
  expect(JSON.parse(put.body!)).toEqual({ enabled: true, apiKey: 'secret-key-123', reason: 'connect the party space' });
});

test('tells anyone but a system administrator that the settings are theirs', async () => {
  settings = { status: 403, body: { error: 'sysadmin only' } };
  renderPage();
  expect(await screen.findByText(/Only a system administrator/)).toBeInTheDocument();
});
