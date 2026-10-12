import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const DETAIL = {
  id: 'c1',
  status: 'ACTIVE',
  supersedesId: null,
  contact: {
    id: 'ct1',
    name: 'Dana Donor',
    email: 'dana@example.org',
    address: { line1: '1 Main St', city: 'Toronto', province: 'ON', postalCode: 'M1M1M1', country: 'CA' },
  },
  amountCents: 10_000,
  acceptedAt: '2026-03-01T12:00:00.000Z',
  note: null,
  payment: {
    id: 'p1',
    contactId: 'ct1',
    contactName: 'Dana Donor',
    source: 'QOMON_IMPORT',
    method: 'CARD',
    state: 'RECEIVED',
    amountCents: 10_000,
    currency: 'cad',
    receivedAt: '2026-03-01T12:00:00.000Z',
    externalRef: null,
    payerName: null,
    note: null,
    unattributedCents: 0,
    contributions: [
      {
        id: 'c1',
        contactName: 'Dana Donor',
        amountCents: 10_000,
        periodId: 67,
        entityKind: 'PARTY',
        ridingNumber: null,
        leadershipContestantName: null,
        receivedBy: 'GPO',
        agencyContribution: false,
      },
    ],
  },
  qomon: null,
  metadata: {
    periodId: 67,
    ridingNumber: null,
    entityKind: 'PARTY',
    leadershipContestantId: null,
    leadershipContestantName: null,
    receivedBy: 'GPO',
    agencyContribution: false,
    goodsServices: false,
    nonDeductibleCents: 0,
    processedDate: null,
    sourceCode: '',
    exceptionReason: null,
  },
  allocations: [
    {
      id: 'a1',
      amountCents: 10_000,
      receipt: { id: 'r1', receiptNumber: 'GPO-00402510', status: 'ISSUED', issueDate: '2026-03-02T00:00:00.000Z', cancellationNotice: null },
    },
  ],
  rtdInclusions: [],
  workItems: [],
  changeLog: [],
};

const PLAN = {
  action: 'CORRECT_AMOUNT',
  changes: [
    {
      contributionId: 'c1',
      kind: 'supersede',
      before: { contactId: 'ct1', contactName: 'Dana Donor', amountCents: 10_000, entityKind: 'PARTY', ridingNumber: null },
      replacements: [
        { ref: 'new:0:0', contactName: 'Dana Donor', amountCents: 8_000, entityKind: 'PARTY', ridingNumber: null, nonDeductibleCents: 0 },
      ],
    },
  ],
  payments: [{ paymentId: 'p1', amountBeforeCents: 10_000, amountAfterCents: 8_000, stateBefore: 'RECEIVED', stateAfter: 'RECEIVED' }],
  cancelReceipts: [{ receiptId: 'r1', receiptNumber: 'GPO-00402510', contactName: 'Dana Donor', totalAmountCents: 10_000, hasPdf: true }],
  issueReceipts: [
    { key: 'k', contactName: 'Dana Donor', entityKind: 'PARTY', ridingNumber: null, totalAmountCents: 8_000, replacesReceiptNumber: 'GPO-00402510' },
  ],
  owedToEo: [{ kind: 'DC1A', description: 'contribution c1 was RTD-reported: a DC-1A amendment is owed' }],
  dirtyReports: [],
  labelsNeeded: [{ entityKind: 'PARTY', ridingNumber: null, key: 'PARTY:' }],
  followUps: ['Qomon still shows transaction 1 as Dana Donor, 100.00'],
  blockers: [] as string[],
};

const RESULT = {
  correlationId: 'corr',
  supersededContributionIds: ['c1'],
  refundedContributionIds: [],
  createdContributionIds: ['c2'],
  cancelledReceiptIds: ['r1'],
  issuedReceipts: [{ id: 'r2', receiptNumber: 'GPO-00402511', contactId: 'ct1', amountCents: 8_000 }],
  owedToEoWorkItemIds: ['w1'],
  followUps: [],
  validationFailures: [],
};

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let plan: typeof PLAN = PLAN;
let me = ME;
let detailStatus = 'ACTIVE';
let detail: object = DETAIL;

beforeEach(() => {
  calls = [];
  plan = PLAN;
  me = ME;
  detailStatus = 'ACTIVE';
  detail = DETAIL;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.includes('/auth/me')) return jsonResponse(me);
      if (u.endsWith('/corrections/preview')) return jsonResponse(plan);
      if (u.endsWith('/corrections') && init?.method === 'POST') {
        detailStatus = 'SUPERSEDED'; // the server retires the row on commit
        return jsonResponse(RESULT, 201);
      }
      if (u.endsWith('/receipts/r1/reprint')) return jsonResponse({ reprintId: 'rp1', kind: 'LOST_COPY', lost: true }, 201);
      if (u.endsWith('/payments/p1') && init?.method === 'PATCH') return jsonResponse({ id: 'p1' });
      if (u.endsWith('/contributions/c1/receipts')) return jsonResponse({ id: 'r9', receiptNumber: 'GPO-9' }, 201);
      if (u.includes('/contributions/c1')) return jsonResponse({ ...detail, status: detailStatus });
      return jsonResponse({ data: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openCorrection() {
  fireEvent.click(await screen.findByRole('button', { name: 'Correct' }));
  await screen.findByText('Correct this contribution');
}

function renderDetail() {
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

test('previews the cascade before it can be committed, then commits exactly the previewed request', async () => {
  renderDetail();
  await openCorrection();
  expect(screen.getByRole('button', { name: 'Commit correction' })).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/Corrected amount/), { target: { value: '80' } });
  fireEvent.change(screen.getByLabelText('Reason (required)', { selector: 'input[placeholder^="e.g. cheque"]' }), {
    target: { value: 'cheque was for $80' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview cascade' }));

  expect(await screen.findByText(/Cancel GPO-00402510/)).toBeInTheDocument();
  expect(screen.getByText(/it says it cancels and replaces GPO-00402510/)).toBeInTheDocument();
  expect(screen.getByText(/a DC-1A amendment is owed/)).toBeInTheDocument();
  expect(screen.getByText(/Qomon still shows transaction 1/)).toBeInTheDocument();

  const previewCall = calls.find((c) => c.url.endsWith('/corrections/preview'))!;
  expect(JSON.parse(previewCall.body!)).toMatchObject({
    action: 'CORRECT_AMOUNT',
    contributionId: 'c1',
    amountCents: 8_000,
    reason: 'cheque was for $80',
    politicalEntityLabel: 'Green Party of Ontario',
  });

  const commit = screen.getByRole('button', { name: 'Commit correction' });
  expect(commit).toBeEnabled();
  fireEvent.click(commit);

  expect(await screen.findByText('Correction committed')).toBeInTheDocument();
  expect(screen.getByText(/issued GPO-00402511/)).toBeInTheDocument();
  // the row is now history, and the summary of what the correction did stays on screen
  expect(await screen.findByText(/it is history, not the working record/)).toBeInTheDocument();
  expect(screen.getByText('Correction committed')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'open it' })).toHaveAttribute('href', '/contributions/c2');
  const commitCall = calls.find((c) => c.url.endsWith('/corrections') && c.method === 'POST')!;
  expect(JSON.parse(commitCall.body!)).toEqual(JSON.parse(previewCall.body!));
});

test('editing an input after a preview discards it, so the commit is always what was previewed', async () => {
  renderDetail();
  await openCorrection();
  fireEvent.change(screen.getByLabelText(/Corrected amount/), { target: { value: '80' } });
  fireEvent.change(screen.getByPlaceholderText('e.g. cheque was for $80, keyed as $100'), { target: { value: 'fix' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview cascade' }));
  await screen.findByText(/Cancel GPO-00402510/);

  fireEvent.change(screen.getByLabelText(/Corrected amount/), { target: { value: '70' } });

  await waitFor(() => expect(screen.queryByText(/Cancel GPO-00402510/)).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Commit correction' })).toBeDisabled();
});

test('a blocked cascade cannot be committed', async () => {
  plan = { ...PLAN, blockers: ['receipt issuance is disabled by the kill switch'] };
  renderDetail();
  await openCorrection();
  fireEvent.change(screen.getByLabelText(/Corrected amount/), { target: { value: '80' } });
  fireEvent.change(screen.getByPlaceholderText('e.g. cheque was for $80, keyed as $100'), { target: { value: 'fix' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview cascade' }));

  expect(await screen.findByText('receipt issuance is disabled by the kill switch')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Commit correction' })).toBeDisabled();
});

test('asks for a reason before it previews', async () => {
  renderDetail();
  await openCorrection();
  fireEvent.change(screen.getByLabelText(/Corrected amount/), { target: { value: '80' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview cascade' }));
  expect(await screen.findByText('Give a reason (at least three characters).')).toBeInTheDocument();
  expect(calls.some((c) => c.url.endsWith('/corrections/preview'))).toBe(false);
});

test('hides the correction action from someone who cannot correct contributions', async () => {
  me = { ...ME, can: { ...ME.can, correctContributions: false, correctReceipts: false } };
  renderDetail();
  await screen.findByText('Allocations & receipts');
  expect(screen.queryByRole('button', { name: 'Correct' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Correct receipt/ })).not.toBeInTheDocument();
});

test('reprints a receipt as a lost copy from the receipt menu', async () => {
  renderDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Correct receipt GPO-00402510' }));
  fireEvent.click(await screen.findByText('Reprint as a lost-receipt copy'));

  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'donor lost it' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/receipts/r1/reprint'))).toBe(true));
  const call = calls.find((c) => c.url.endsWith('/receipts/r1/reprint'))!;
  expect(JSON.parse(call.body!)).toEqual({
    kind: 'LOST_COPY',
    reason: 'donor lost it',
    politicalEntityLabel: 'Green Party of Ontario',
  });
  expect(await screen.findByText('Copy generated; the original is flagged lost.')).toBeInTheDocument();
});

const MANUAL = {
  ...DETAIL,
  payment: { ...DETAIL.payment, source: 'MANUAL', method: 'CHEQUE', externalRef: 'cheque-1042' },
  allocations: [],
};

test('a payment imported from Qomon is read-only, and the donor actions are gone', async () => {
  renderDetail();
  await screen.findByText('Allocations & receipts');
  // the payment's (from Qomon) and the contribution's (receipted)
  const edits = screen.getAllByRole('button', { name: 'Edit' });
  expect(edits).toHaveLength(2);
  for (const b of edits) expect(b).toBeDisabled();
  expect(screen.queryByRole('button', { name: /Edit donor/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Refresh donor/ })).not.toBeInTheDocument();
});

test('edits a manual payment in a modal, sending the payment fields with a reason', async () => {
  detail = MANUAL;
  renderDetail();
  expect(await screen.findByText('cheque-1042')).toBeInTheDocument();
  const [paymentEdit] = screen.getAllByRole('button', { name: 'Edit' });
  fireEvent.click(paymentEdit!);

  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Cheque number'), { target: { value: 'cheque-1043' } });
  fireEvent.change(within(dialog).getByLabelText('Received on'), { target: { value: '2026-03-02' } });
  const save = within(dialog).getByRole('button', { name: 'Save payment' });
  expect(save).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'mis-keyed cheque' } });
  fireEvent.click(save);

  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  const call = calls.find((c) => c.method === 'PATCH')!;
  expect(call.url).toMatch(/\/payments\/p1$/);
  expect(JSON.parse(call.body!)).toEqual({
    reason: 'mis-keyed cheque',
    receivedAt: '2026-03-02T17:00:00.000Z',
    method: 'CHEQUE',
    externalRef: 'cheque-1043',
    payerName: '',
    note: '',
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('issues a receipt from a modal', async () => {
  detail = MANUAL;
  renderDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Issue a receipt' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Remaining eligible: $100.00')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'annual receipt' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Issue receipt' }));

  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/contributions/c1/receipts'))).toBe(true));
  const call = calls.find((c) => c.url.endsWith('/contributions/c1/receipts'))!;
  expect(JSON.parse(call.body!)).toEqual({
    reason: 'annual receipt',
    delivery: 'MAIL',
    politicalEntityLabel: 'Green Party of Ontario',
  });
});
