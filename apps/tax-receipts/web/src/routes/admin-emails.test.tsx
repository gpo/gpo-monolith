import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const LOCKED = {
  provider: 'resend',
  liveSendingAllowed: false,
  liveSendingEnabled: false,
  mode: 'simulated',
  updatedByUserId: null,
  updatedAt: null,
};

const ROW = {
  id: 'em1',
  purpose: 'RECEIPT',
  status: 'SENT',
  statusDetail: null,
  simulated: true,
  toAddress: 'emma@example.org',
  contactName: 'Emma Emailer',
  receiptId: 'r1',
  receiptNumber: 'GPO-00402510',
  subject: 'Your official contribution receipt',
  attempts: 1,
  queuedAt: '2026-12-01T15:00:00Z',
  sentAt: '2026-12-01T15:00:05Z',
  lastEventAt: null,
  provider: 'resend',
  providerMessageId: 'simulated_em1',
};

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let settings: unknown = LOCKED;

beforeEach(() => {
  calls = [];
  settings = LOCKED;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.includes('/auth/me')) return jsonResponse(ME);
      if (u.includes('/admin/email-settings')) {
        if (init?.method === 'PUT') return jsonResponse({ ...(settings as object), liveSendingEnabled: true, mode: 'live' });
        return jsonResponse(settings);
      }
      if (u.includes('/admin/emails/em1/simulate')) return jsonResponse({ applied: 1 });
      if (u.includes('/admin/emails/em1')) {
        return jsonResponse({ ...ROW, contactId: 'ct1', textBody: 'Emma Emailer\n\nRe: Receipt GPO-00402510', attachments: [], events: [] });
      }
      if (u.includes('/admin/emails')) return jsonResponse({ data: [ROW], nextCursor: null });
      return jsonResponse({ error: 'not found' }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/admin/emails'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('locks live sending off where the environment does not allow it', async () => {
  renderPage();
  expect(await screen.findByText('Simulated: nothing is sent')).toBeInTheDocument();
  expect(screen.getByText(/locked off in this environment/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Reason (required to change)'), { target: { value: 'try it' } });
  expect(screen.getByRole('switch', { name: 'Send real email' })).toBeDisabled();
});

test('turns live sending on with a reason where it is allowed', async () => {
  settings = { ...LOCKED, liveSendingAllowed: true };
  renderPage();
  const toggle = await screen.findByRole('switch', { name: 'Send real email' });
  expect(toggle).toBeDisabled(); // no reason yet

  fireEvent.change(screen.getByLabelText('Reason (required to change)'), { target: { value: 'production go-live' } });
  fireEvent.click(toggle);

  await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  const put = calls.find((c) => c.method === 'PUT')!;
  expect(JSON.parse(put.body!)).toEqual({ liveSendingEnabled: true, reason: 'production go-live' });
});

test('lists emails, filters them, and opens one to simulate a bounce', async () => {
  renderPage();
  expect(await screen.findByText('Receipt GPO-00402510')).toBeInTheDocument();
  expect(screen.getByText('simulated')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'BOUNCED' } });
  await waitFor(() => expect(calls.some((c) => c.url.includes('/admin/emails?status=BOUNCED'))).toBe(true));

  fireEvent.click(await screen.findByText('Emma Emailer'));
  expect(await screen.findByText(/Re: Receipt GPO-00402510/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Bounced' }));
  await waitFor(() => expect(calls.some((c) => c.url.includes('/admin/emails/em1/simulate'))).toBe(true));
  const sim = calls.find((c) => c.url.includes('/simulate'))!;
  expect(JSON.parse(sim.body!)).toEqual({ type: 'bounced' });
});
