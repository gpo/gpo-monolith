import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const DANA = { id: 'ct1', name: 'Dana Donor', email: 'dana@example.org', qomonContactId: null };
const SAM = { id: 'ct2', name: 'Sam Spouse', email: null, qomonContactId: null };

const PAYMENT = {
  id: 'p1',
  contactId: 'ct1',
  contactName: 'Dana Donor',
  amountCents: 10_000,
  receivedAt: '2026-04-10T17:00:00.000Z',
  method: 'CHEQUE',
  state: 'RECEIVED',
  source: 'MANUAL',
  externalRef: 'cheque-1042',
  attributedCents: 6_000,
  unattributedCents: 4_000,
  contributions: [{ id: 'c1', contactName: 'Dana Donor', amountCents: 6_000, status: 'ACTIVE' }],
};

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let me = ME;
let paymentResponse: { status: number; body: unknown } = { status: 201, body: {} };

beforeEach(() => {
  calls = [];
  me = ME;
  paymentResponse = {
    status: 201,
    body: { paymentId: 'p9', contributions: [{ id: 'c9', amountCents: 10_000, periodId: 67, flags: [] }] },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.includes('/auth/me')) return jsonResponse(me);
      if (u.includes('/contacts?query=')) {
        return jsonResponse({ data: u.includes('sam') ? [SAM] : [DANA] });
      }
      if (u.includes('/intake-preview')) {
        return jsonResponse({ descriptive: { period_id: 67, riding_number: null, entity_kind: 'PARTY', received_by: 'GPO' }, flags: [] });
      }
      if (u.includes('/admin/periods')) return jsonResponse({ data: [{ id: 67, name: '2026 Annual' }] });
      if (u.includes('/admin/ridings')) return jsonResponse({ data: [{ ridingNumber: 12, name: 'Brampton West', active: true }] });
      if (u.endsWith('/payments') && init?.method === 'POST') return jsonResponse(paymentResponse.body, paymentResponse.status);
      if (u.endsWith('/payments/p1/contributions') && init?.method === 'POST') {
        return jsonResponse({ contributionId: 'c2', remainingCents: 0, flags: [] }, 201);
      }
      if (u.endsWith('/payments/p1')) return jsonResponse(PAYMENT);
      return jsonResponse({ data: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function pickDonor(label: string | RegExp, search: string, name: string, container?: HTMLElement) {
  const scope = container ? within(container) : screen;
  // a Mantine Select labels both its input and its option list
  const input = await scope.findByRole('textbox', { name: label });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: search } });
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

function body(match: (c: (typeof calls)[number]) => boolean) {
  const call = calls.find(match);
  return call ? JSON.parse(call.body!) : undefined;
}

test('the contributions list offers Add payment only to someone who can enter payments', async () => {
  renderAt('/contributions');
  expect(await screen.findByRole('link', { name: 'Add payment' })).toHaveAttribute('href', '/payments/new');
});

test('the Add payment button is hidden from someone who cannot enter payments', async () => {
  me = { ...ME, can: { ...ME.can, enterPayments: false } };
  renderAt('/contributions');
  await screen.findByRole('heading', { name: 'Contributions' });
  await waitFor(() => expect(calls.some((c) => c.url.includes('/auth/me'))).toBe(true));
  expect(screen.queryByRole('link', { name: 'Add payment' })).not.toBeInTheDocument();
});

test('records a payment with one contribution covering it, sending only what the operator chose', async () => {
  renderAt('/payments/new');
  await pickDonor('Donor who paid', 'dana', 'Dana Donor');
  fireEvent.change(screen.getByLabelText('Amount ($)', { selector: 'input:not(:disabled)' }), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Received on'), { target: { value: '2026-04-10' } });
  fireEvent.change(screen.getByLabelText('Cheque number or processor reference'), { target: { value: 'cheque-1042' } });
  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'cheque at the office' } });

  // what the derivation will do is shown before anything is saved
  expect(await screen.findByText('Will be filed in 2026 Annual.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));

  expect(await screen.findByText('Payment recorded')).toBeInTheDocument();
  expect(body((c) => c.url.endsWith('/payments') && c.method === 'POST')).toEqual({
    reason: 'cheque at the office',
    contactId: 'ct1',
    amountCents: 10_000,
    receivedAt: '2026-04-10T17:00:00.000Z',
    method: 'CHEQUE',
    externalRef: 'cheque-1042',
    contributions: [
      {
        amountCents: 10_000,
        descriptive: { entity_kind: 'PARTY', riding_number: null, received_by: 'GPO', goods_services: false },
      },
    ],
  });
  expect(screen.getByRole('link', { name: 'Open the contribution' })).toHaveAttribute('href', '/contributions/c9');
});

test('asks for what is missing before it sends anything', async () => {
  renderAt('/payments/new');
  await screen.findByText('Add a payment');
  fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
  expect(await screen.findByText('Pick the donor who paid.')).toBeInTheDocument();

  await pickDonor('Donor who paid', 'dana', 'Dana Donor');
  fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
  expect(await screen.findByText('Enter the payment amount.')).toBeInTheDocument();
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});

test('splits a payment across two contributions and checks the total before saving', async () => {
  renderAt('/payments/new');
  await pickDonor('Donor who paid', 'dana', 'Dana Donor');
  fireEvent.change(screen.getByLabelText('Amount ($)', { selector: 'input:not(:disabled)' }), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'joint cheque' } });

  fireEvent.click(screen.getByRole('button', { name: 'Split across more contributions' }));
  const cards = await screen.findAllByText(/^Contribution [12]$/);
  expect(cards).toHaveLength(2);

  const amounts = screen.getAllByLabelText('Amount ($)');
  // [payment amount, contribution 1, contribution 2]
  fireEvent.change(amounts[2]!, { target: { value: '70' } });
  fireEvent.change(amounts[1]!, { target: { value: '60' } });
  expect(await screen.findByText(/\$130\.00 of \$100\.00 attributed/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
  expect(await screen.findByText(/add up to \$130\.00, more than the \$100\.00 payment/)).toBeInTheDocument();
  expect(calls.some((c) => c.url.endsWith('/payments') && c.method === 'POST')).toBe(false);

  fireEvent.change(screen.getAllByLabelText('Amount ($)')[2]!, { target: { value: '40' } });
  paymentResponse = {
    status: 201,
    body: {
      paymentId: 'p9',
      contributions: [
        { id: 'c8', amountCents: 6_000, periodId: 67, flags: [] },
        { id: 'c9', amountCents: 4_000, periodId: 67, flags: [] },
      ],
    },
  };
  fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
  expect(await screen.findByText(/its 2 contributions were recorded/)).toBeInTheDocument();
  const sent = body((c) => c.url.endsWith('/payments') && c.method === 'POST');
  expect(sent.contributions.map((c: { amountCents: number }) => c.amountCents)).toEqual([6_000, 4_000]);
});

test('a CA contribution needs its riding', async () => {
  renderAt('/payments/new');
  await pickDonor('Donor who paid', 'dana', 'Dana Donor');
  fireEvent.change(screen.getByLabelText('Amount ($)', { selector: 'input:not(:disabled)' }), { target: { value: '25' } });
  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'ca gift' } });
  fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'CA' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
  expect(await screen.findByText('A CA or campaign contribution needs its riding number.')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Riding (1 to 124)'), { target: { value: '12' } });
  expect(await screen.findByText('Brampton West')).toBeInTheDocument();
});

test('shows the server\'s refusal', async () => {
  paymentResponse = { status: 422, body: { error: 'no reporting period covers this date; choose a period or configure one first' } };
  renderAt('/payments/new');
  await pickDonor('Donor who paid', 'dana', 'Dana Donor');
  fireEvent.change(screen.getByLabelText('Amount ($)', { selector: 'input:not(:disabled)' }), { target: { value: '25' } });
  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'old cheque' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
  expect(await screen.findByText(/no reporting period covers this date/)).toBeInTheDocument();
});

test('attributes the rest of a payment to another donor', async () => {
  renderAt('/payments/p1/attribute');
  expect(await screen.findByText(/\$60\.00 attributed, \$40\.00 unattributed/)).toBeInTheDocument();

  await pickDonor(/^Donor/, 'sam', 'Sam Spouse');
  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'the other half was Sam' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add contribution' }));

  expect(await screen.findByText('The whole payment is now attributed.')).toBeInTheDocument();
  expect(body((c) => c.url.endsWith('/payments/p1/contributions'))).toMatchObject({
    reason: 'the other half was Sam',
    amountCents: 4_000,
    contactId: 'ct2',
  });
});

test('refuses to add more than is unattributed', async () => {
  renderAt('/payments/p1/attribute');
  await screen.findByText(/\$40\.00 unattributed/);
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '50' } });
  fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'too much' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add contribution' }));
  expect(await screen.findByText('Only $40.00 of this payment is unattributed.')).toBeInTheDocument();
});
