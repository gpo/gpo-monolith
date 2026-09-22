import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const EMPTY_DRAFT = { year: 2026, asOf: '2026-03-06T15:00:00.000Z', rows: [] };
const EMPTY_FILINGS = { data: [] };

const ONE_DRAFT_ROW = {
  year: 2026,
  asOf: '2026-03-06T15:00:00.000Z',
  rows: [
    {
      contributionId: 'c1',
      contactId: 'donor1',
      contactFirstName: 'Dana',
      contactLastName: 'Donor',
      amountCents: 20_001,
      acceptedAt: '2026-03-01T12:00:00.000Z',
      contributionYear: 2026,
      aggregateAfterCents: 20_001,
      periodId: 67,
      eoContributorId: null,
      dueDate: '2026-03-25',
      businessDaysRemaining: 10,
      overdue: false,
      gateFindings: [],
    },
  ],
};

const ONE_BLOCKED_ROW = {
  year: 2026,
  asOf: '2026-03-06T15:00:00.000Z',
  rows: [
    {
      ...ONE_DRAFT_ROW.rows[0],
      contributionId: 'c2',
      gateFindings: [{ workItemId: 'w1', ruleRef: 'B1' }],
    },
  ],
};

const ONE_FILING = {
  data: [
    {
      id: 'f1',
      name: '2026_RTD_8_030620261000',
      kind: 'INITIAL',
      format: 'CSV',
      generatedAt: '2026-03-06T15:00:00.000Z',
      submittedAt: null,
      submittedBy: null,
      artifactId: null,
      amendsFilingId: null,
      rowCount: 1,
    },
  ],
};

const STAMP_RESULT = { rtdFilingId: 'f1', filingName: '2026_RTD_8_030620261000', stampedCount: 1 };

let calls: Array<{ url: string; body?: string }> = [];
let draftResponse: unknown = EMPTY_DRAFT;
let filingsResponse: unknown = EMPTY_FILINGS;

beforeEach(() => {
  calls = [];
  draftResponse = EMPTY_DRAFT;
  filingsResponse = EMPTY_FILINGS;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string | undefined });
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).includes('/rtd/draft')) return jsonResponse(draftResponse);
      if (String(url).endsWith('/rtd/filings') && init?.method === 'POST') {
        return jsonResponse(STAMP_RESULT, 201);
      }
      if (String(url).endsWith('/rtd/filings')) return jsonResponse(filingsResponse);
      return jsonResponse({ data: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/rtd-filings'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('shows empty states when nothing is drafted or filed yet', async () => {
  renderPage();
  expect(await screen.findByText(/No unreported over-threshold deposits/)).toBeInTheDocument();
  expect(screen.getByText('No RTD filings yet.')).toBeInTheDocument();
});

test('lists a draft row and lets it be selected for stamping', async () => {
  draftResponse = ONE_DRAFT_ROW;
  renderPage();
  expect(await screen.findByText('Dana Donor')).toBeInTheDocument();
  expect(screen.getAllByText('$200.01')).toHaveLength(2); // amount and aggregate

  const checkbox = screen.getByLabelText('Select Dana Donor');
  expect(checkbox).not.toBeDisabled();
  fireEvent.click(checkbox);
  expect(screen.getByRole('button', { name: /Stamp filing \(1 row\)/ })).toBeInTheDocument();
});

test('disables a gate-blocked row and shows its rule', async () => {
  draftResponse = ONE_BLOCKED_ROW;
  renderPage();
  await screen.findByText('Dana Donor');
  expect(screen.getByText('B1')).toBeInTheDocument();
  expect(screen.getByLabelText('Select Dana Donor')).toBeDisabled();
});

test('stamps the selected row with the entered reason and format', async () => {
  draftResponse = ONE_DRAFT_ROW;
  renderPage();
  await screen.findByText('Dana Donor');
  fireEvent.click(screen.getByLabelText('Select Dana Donor'));
  fireEvent.change(screen.getByPlaceholderText('e.g. period-end RTD filing'), {
    target: { value: 'first filing' },
  });

  const stampButton = screen.getByRole('button', { name: /Stamp filing \(1 row\)/ });
  expect(stampButton).not.toBeDisabled();
  fireEvent.click(stampButton);

  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/rtd/filings') && c.body)).toBe(true));
  const call = calls.find((c) => c.url.endsWith('/rtd/filings') && c.body)!;
  expect(JSON.parse(call.body!)).toMatchObject({
    year: 2026,
    contributionIds: ['c1'],
    reason: 'first filing',
    format: 'CSV',
  });
});

test('lists a stamped filing and offers to archive it when unarchived', async () => {
  filingsResponse = ONE_FILING;
  renderPage();
  expect(await screen.findByText('2026_RTD_8_030620261000')).toBeInTheDocument();
  expect(screen.getByText('Initial')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
});
