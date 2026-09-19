import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

let calls: Array<{ url: string; method?: string; body?: string }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).includes('/admin/periods')) return jsonResponse({ data: [] });
      if (String(url).includes('/admin/contribution-limits')) return jsonResponse({ data: [] });
      if (String(url).includes('/admin/business-day-calendars')) return jsonResponse({ data: [] });
      if (String(url).includes('/admin/users')) return jsonResponse({ data: [] });
      if (String(url).includes('/admin/kill-switch')) {
        if (init?.method === 'POST') return jsonResponse({ engaged: true, reason: 'CEO request' });
        return jsonResponse({ engaged: false, reason: null });
      }
      return jsonResponse({ error: 'not found' }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(initialPath = '/admin') {
  const router = makeRouter(createMemoryHistory({ initialEntries: [initialPath] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return router;
}

test('shows the periods section by default, redirecting bare /admin to /admin/periods', async () => {
  const router = renderPage();
  expect(await screen.findByRole('link', { name: 'Periods' })).toHaveAttribute(
    'data-variant',
    'filled',
  );
  await waitFor(() => expect(calls.some((c) => c.url.includes('/admin/periods'))).toBe(true));
  expect(router.state.location.pathname).toBe('/admin/periods');
});

test('linking straight to a section path renders that section', async () => {
  renderPage('/admin/kill-switch');
  expect(await screen.findByText('disengaged')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Kill switch' })).toHaveAttribute('data-variant', 'filled');
});

test('switching to the kill switch section loads its status and can engage it', async () => {
  renderPage();
  await screen.findByRole('link', { name: 'Periods' });
  fireEvent.click(screen.getByRole('link', { name: 'Kill switch' }));

  expect(await screen.findByText('disengaged')).toBeInTheDocument();

  const engageButton = screen.getByRole('button', { name: 'Engage (stop all issuance)' });
  expect(engageButton).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'CEO request' } });
  expect(engageButton).not.toBeDisabled();
  fireEvent.click(engageButton);

  await waitFor(() =>
    expect(calls.some((c) => c.url.includes('/admin/kill-switch') && c.method === 'POST')).toBe(true),
  );
  const call = calls.find((c) => c.url.includes('/admin/kill-switch') && c.method === 'POST');
  expect(JSON.parse(call!.body!)).toMatchObject({ engaged: true, reason: 'CEO request' });
});

test('validation rules section lists rules without fetching anything new', async () => {
  renderPage();
  await screen.findByRole('link', { name: 'Periods' });
  await waitFor(() => expect(calls.some((c) => c.url.includes('/admin/periods'))).toBe(true));
  const callsBeforeSwitch = calls.length;

  fireEvent.click(screen.getByRole('link', { name: 'Validation rules' }));

  expect(await screen.findByText('A1')).toBeInTheDocument();
  expect(screen.getByText("Acceptance date is outside its period's window")).toBeInTheDocument();
  expect(calls.length).toBe(callsBeforeSwitch);
});
