import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const BLOCKED_PREVIEW = {
  blocked: true,
  blockers: [
    {
      workItemId: 'w1',
      contributionId: 'c1',
      contactId: 'ct1',
      contactName: 'Dana Donor',
      kind: 'VALIDATION',
      ruleRef: 'B2',
    },
  ],
  lines: [],
  totals: { receiptCount: 0, amountCents: 0, emailCount: 0, mailCount: 0 },
};

const CLEAR_PREVIEW = {
  blocked: false,
  blockers: [],
  lines: [
    { contributionId: 'c1', contactId: 'ct1', contactName: 'Dana Donor', amountCents: 5_000, delivery: 'MAIL' },
    { contributionId: 'c2', contactId: 'ct2', contactName: 'Sam Supporter', amountCents: 3_000, delivery: 'EMAIL' },
  ],
  totals: { receiptCount: 2, amountCents: 8_000, emailCount: 1, mailCount: 1 },
};

const GENERATE_RESULT = {
  results: [
    { contributionId: 'c1', ok: true, receiptId: 'r1', receiptNumber: 'GPO-00402510', amountCents: 5_000 },
    { contributionId: 'c2', ok: true, receiptId: 'r2', receiptNumber: 'GPO-00402511', amountCents: 3_000 },
  ],
  succeeded: 2,
  failed: 0,
};

let calls: Array<{ url: string; body?: string }> = [];
let previewResponse: unknown = CLEAR_PREVIEW;

beforeEach(() => {
  calls = [];
  previewResponse = CLEAR_PREVIEW;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string | undefined });
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).includes('/issuance-preview')) return jsonResponse(previewResponse);
      if (String(url).includes('/receipts') && init?.method === 'POST') {
        return jsonResponse(GENERATE_RESULT);
      }
      return jsonResponse({ data: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/spaces/67/PARTY/issue'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('shows blockers and disables Next when the gate is dirty', async () => {
  previewResponse = BLOCKED_PREVIEW;
  renderPage();
  expect(await screen.findByText(/1 open work item\(s\) block issuance/)).toBeInTheDocument();
  expect(screen.getByText('Dana Donor')).toBeInTheDocument();
  expect(screen.getByText(/Donor is over a contribution limit/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next: generate' })).toBeDisabled();
});

test('previews totals and lines when the gate is clear', async () => {
  renderPage();
  expect(await screen.findByText('Sam Supporter')).toBeInTheDocument();
  expect(screen.getByText('$80.00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next: generate' })).not.toBeDisabled();
});

test('generates receipts and shows per-row results', async () => {
  renderPage();
  await screen.findByText('Sam Supporter');
  fireEvent.click(screen.getByRole('button', { name: 'Next: generate' }));

  const generateButton = await screen.findByRole('button', { name: 'Generate receipts' });
  expect(generateButton).toBeDisabled(); // no reason yet

  fireEvent.change(screen.getByPlaceholderText('e.g. period-end batch issuance'), {
    target: { value: 'period-end batch' },
  });
  expect(generateButton).not.toBeDisabled();

  fireEvent.click(generateButton);

  await waitFor(() => expect(calls.some((c) => c.url.includes('/receipts') && c.body)).toBe(true));
  const call = calls.find((c) => c.url.includes('/spaces/67/PARTY/receipts'))!;
  expect(JSON.parse(call.body!)).toMatchObject({
    reason: 'period-end batch',
    politicalEntityLabel: 'Green Party of Ontario',
  });

  expect(await screen.findByText('2 issued, 0 failed.')).toBeInTheDocument();
  expect(screen.getByText('GPO-00402510')).toBeInTheDocument();
  expect(screen.getByText('GPO-00402511')).toBeInTheDocument();
});
