import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

// The riding-number field is a Mantine Select (Combobox), and under this
// repo's jsdom test environment any Combobox/Popover-based Mantine
// component (Select, Menu, Popover — reproduced independently of this
// page) takes ~20-50s of real wall-clock time to settle, well past the
// default 5s testTimeout, even though the final rendered output is
// correct. This is an environment gap (jsdom + @floating-ui/react
// timing), not a bug in this page or these tests — flagged separately
// for a real fix; bumping the timeout here keeps the suite green.
vi.setConfig({ testTimeout: 60_000 });

const DETAIL = {
  id: 'c1',
  qomonTransactionId: '1',
  qomonBundleId: '2',
  contact: {
    id: 'ct1',
    name: 'Dana Donor',
    email: 'dana@example.org',
    address: { line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1', country: 'CA' },
  },
  amountCents: 5_000,
  currency: 'cad',
  acceptedAt: '2026-03-01T12:00:00.000Z',
  paymentMethodKind: 'card',
  statusKind: 'valid',
  codeCampaign: 'TSF.W.007',
  comment: null,
  externalRef: null,
  firstSeenAt: '2026-03-01T12:00:00.000Z',
  lastSyncedAt: '2026-03-02T00:00:00.000Z',
  deletedInQomonAt: null,
  metadata: {
    periodId: 67,
    ridingNumber: 7,
    entityKind: 'CA',
    receivedBy: 'GPO',
    goodsServices: false,
    nonDeductibleCents: 0,
    processedDate: null,
    sourceCode: 'TSF.W.007',
    eoContributorId: null,
    exceptionReason: null,
    checksum: 'sha256:abc',
    syncedAt: '2026-03-01T12:00:00.000Z',
  },
  allocations: [],
  rtdInclusions: [],
  workItems: [
    { id: 'w1', kind: 'VALIDATION', ruleRef: 'A8', status: 'OPEN', openedAt: '2026-03-01T12:00:00.000Z', closedAt: null, resolutionNote: null },
  ],
  changeLog: [
    {
      id: 'cl1',
      subjectType: 'ContributionMetadata',
      actorUserId: null,
      reason: 'mirror sweep: new transaction, ticket-1.1 intake defaults applied',
      before: null,
      after: {},
      at: '2026-03-01T12:00:00.000Z',
      correlationId: 'corr1',
    },
  ],
};

const RIDINGS = {
  data: [
    { ridingNumber: 7, name: 'Test Riding', qomonApiBase: null, active: true, qomonApiKeySet: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    { ridingNumber: 12, name: 'Other Riding', qomonApiBase: null, active: true, qomonApiKeySet: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  ],
};

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).includes('/admin/ridings')) return jsonResponse(RIDINGS);
      if (String(url).endsWith('/refresh') && init?.method === 'POST') {
        return new Response(JSON.stringify({ outcome: 'unchanged' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).endsWith('/receipts') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ id: 'r1', receiptNumber: 'GPO-00402510', amountCents: 5_000, pdfArtifactId: 'a1' }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      if (String(url).includes('/contributions/')) {
        return new Response(JSON.stringify(DETAIL), {
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
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/contributions/c1'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('shows Qomon facts, metadata, work items, and change-log', async () => {
  renderPage();
  expect(await screen.findByText('Donor: Dana Donor')).toBeInTheDocument();
  expect(screen.getByText('Amount: $50.00')).toBeInTheDocument();
  expect(screen.getByText(/Cash contribution exceeds the \$25 EFA limit/)).toBeInTheDocument();
  expect(screen.getByText('(A8)')).toBeInTheDocument();
  expect(screen.getByText(/mirror sweep: new transaction/)).toBeInTheDocument();
});

test('refresh from Qomon calls the refresh endpoint and shows the outcome', async () => {
  renderPage();
  await screen.findByText('Donor: Dana Donor');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from Qomon' }));
  await waitFor(() => expect(calls.some((u) => u.endsWith('/refresh'))).toBe(true));
  expect(await screen.findByText('Refreshed — outcome: unchanged.')).toBeInTheDocument();
});

test('a failed refresh shows an error instead of failing silently', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).includes('/admin/ridings')) return jsonResponse(RIDINGS);
      if (String(url).endsWith('/refresh')) {
        return new Response(JSON.stringify({ error: 'Qomon rejected the request' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('/contributions/')) return jsonResponse(DETAIL);
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }),
  );
  renderPage();
  await screen.findByText('Donor: Dana Donor');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh from Qomon' }));
  expect(await screen.findByText('Qomon rejected the request')).toBeInTheDocument();
});

test('the save button is disabled until a reason is entered', async () => {
  renderPage();
  await screen.findByText('Donor: Dana Donor');
  const save = screen.getByRole('button', { name: 'Save metadata' });
  expect(save).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Reason for this edit (required)'), {
    target: { value: 'fixing riding' },
  });
  expect(save).not.toBeDisabled();
});

test('riding number renders as a searchable select showing the riding name', async () => {
  renderPage();
  await screen.findByText('Donor: Dana Donor');
  expect(screen.getByDisplayValue('7 — Test Riding')).toBeInTheDocument();
});

test('a riding number with no matching riding shows an Unknown error state', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).includes('/admin/ridings')) return jsonResponse(RIDINGS);
      if (String(url).includes('/contributions/')) {
        return jsonResponse({ ...DETAIL, metadata: { ...DETAIL.metadata, ridingNumber: 99 } });
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }),
  );
  renderPage();
  await screen.findByText('Donor: Dana Donor');
  expect(screen.getByDisplayValue('99 — Unknown')).toBeInTheDocument();
  expect(screen.getByText('Riding 99 — Unknown (no matching riding on file)')).toBeInTheDocument();
});

test('a permitted user can issue a receipt from the contribution page', async () => {
  renderPage();
  await screen.findByText('Donor: Dana Donor');

  const issueButton = screen.getByRole('button', { name: 'Issue receipt' });
  expect(issueButton).toBeDisabled();

  // DETAIL's entity kind is CA, so there's no default received-by label —
  // both fields are required to enable the button.
  fireEvent.change(screen.getByLabelText('Received-by label (as it should print on the receipt)'), {
    target: { value: 'Green Party of Ontario — Test Riding CA' },
  });
  fireEvent.change(screen.getByLabelText('Reason for issuing this receipt (required)'), {
    target: { value: 'donor requested annual receipt' },
  });
  expect(issueButton).not.toBeDisabled();

  fireEvent.click(issueButton);
  await waitFor(() => expect(calls.some((u) => u.endsWith('/receipts'))).toBe(true));
});
