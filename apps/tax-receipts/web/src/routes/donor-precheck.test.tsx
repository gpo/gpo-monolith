import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { jsonResponse } from '../test/fixtures.js';

let confirmResponse: { body: unknown; status: number } = {
  body: { contactId: 'ct1', year: 2028, delivery: 'EMAIL', addressConfirmedAt: '2028-01-01T00:00:00Z', addressSnapshotId: 'a1' },
  status: 200,
};
let meCalled = false;

beforeEach(() => {
  meCalled = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      // A donor visiting this link has no session — /auth/me must never be
      // called for this route (see router.tsx's RootLayout bypass), and if
      // it were, it should 401 rather than silently pass.
      if (String(url).includes('/auth/me')) {
        meCalled = true;
        return jsonResponse({ error: 'not authenticated' }, 401);
      }
      if (String(url).includes('/donor-precheck/') && String(url).includes('/confirm')) {
        return jsonResponse(confirmResponse.body, confirmResponse.status);
      }
      return jsonResponse({}, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(token = 'tok-1') {
  const router = makeRouter(createMemoryHistory({ initialEntries: [`/donor-precheck/${token}`] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

// Required fields render a trailing "*" inside the label element itself
// (Mantine's `required` prop), so an exact string match on the label text
// never matches — every query below uses a regex instead.
function fillAddress() {
  fireEvent.change(screen.getByLabelText(/Street address/), { target: { value: '42 Wallaby Way' } });
  fireEvent.change(screen.getByLabelText(/^City/), { target: { value: 'Ottawa' } });
  fireEvent.change(screen.getByLabelText(/^Province/), { target: { value: 'ON' } });
  fireEvent.change(screen.getByLabelText(/Postal code/), { target: { value: 'K1A0A1' } });
}

test('renders the confirm form with no session, and never calls /auth/me', async () => {
  renderPage();
  expect(await screen.findByText('Confirm your tax receipt details')).toBeInTheDocument();
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument(); // not the login form
  expect(meCalled).toBe(false);
});

test('submits the address and preference, and shows a thank-you on success', async () => {
  confirmResponse = {
    body: { contactId: 'ct1', year: 2028, delivery: 'EMAIL', addressConfirmedAt: '2028-01-01T00:00:00Z', addressSnapshotId: 'a1' },
    status: 200,
  };
  renderPage();
  await screen.findByText('Confirm your tax receipt details');
  fillAddress();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  expect(await screen.findByText(/your receipt will be sent by email/)).toBeInTheDocument();
});

test('shows an invalid-link message on a 404', async () => {
  confirmResponse = { body: { error: 'invalid token' }, status: 404 };
  renderPage();
  await screen.findByText('Confirm your tax receipt details');
  fillAddress();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  await waitFor(() => expect(screen.getByText(/invalid or has already been used/)).toBeInTheDocument());
});

test('shows an expired-link message on a 410', async () => {
  confirmResponse = { body: { error: 'expired' }, status: 410 };
  renderPage();
  await screen.findByText('Confirm your tax receipt details');
  fillAddress();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  await waitFor(() => expect(screen.getByText(/link has expired/)).toBeInTheDocument());
});
