import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const EMPTY_LIST = { data: [] };

const ONE_CLEAN_REPORT = {
  data: [
    {
      id: 'er1',
      kind: 'ALL',
      periodId: 67,
      ridingNumber: null,
      entityKind: 'PARTY',
      generatedAt: '2026-06-01T13:00:00.000Z',
      sentToCfoAt: null,
      artifactId: 'a1',
      rowCount: 3,
      dirty: false,
    },
  ],
};

const ONE_DIRTY_REPORT = {
  data: [
    {
      id: 'er1',
      kind: 'ALL',
      periodId: 67,
      ridingNumber: null,
      entityKind: 'PARTY',
      generatedAt: '2026-06-01T13:00:00.000Z',
      sentToCfoAt: null,
      artifactId: 'a1',
      rowCount: 3,
      dirty: true,
    },
  ],
};

const DIRTY_DETAIL = {
  report: { id: 'er1', kind: 'ALL', periodId: 67, ridingNumber: null, entityKind: 'PARTY', generatedAt: '2026-06-01T13:00:00.000Z', sentToCfoAt: null, artifactId: 'a1' },
  drift: {
    status: 'dirty',
    diff: {
      changed: [
        {
          key: 'GPO-00402510',
          before: {},
          after: {},
          fields: [{ field: 'Contributor_ID', before: '', after: '198176' }],
        },
      ],
      added: [],
      removed: [],
    },
  },
};

const GENERATE_RESULT = { entityReportId: 'er2', artifactId: 'a2', rowCount: 1, csv: 'header\nrow' };

let calls: Array<{ url: string; body?: string }> = [];
let listResponse: unknown = EMPTY_LIST;
let detailResponse: unknown = DIRTY_DETAIL;

beforeEach(() => {
  calls = [];
  listResponse = EMPTY_LIST;
  detailResponse = DIRTY_DETAIL;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as string | undefined });
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).match(/\/entity-reports\/er1$/)) return jsonResponse(detailResponse);
      if (String(url).includes('/entity-reports') && init?.method === 'POST') {
        return jsonResponse(GENERATE_RESULT, 201);
      }
      if (String(url).includes('/entity-reports')) return jsonResponse(listResponse);
      return jsonResponse({ data: [] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/spaces/67/PARTY/entity-reports'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('shows an empty state when nothing has been generated yet', async () => {
  renderPage();
  expect(await screen.findByText('No reports generated yet for this space.')).toBeInTheDocument();
});

test('lists a clean report with its status badge', async () => {
  listResponse = ONE_CLEAN_REPORT;
  renderPage();
  expect(await screen.findByText('ALL')).toBeInTheDocument();
  expect(screen.getByText('Clean')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
});

test('flags a dirty report and shows the field-level diff on expand', async () => {
  listResponse = ONE_DIRTY_REPORT;
  renderPage();
  expect(await screen.findByText('Dirty — changed since generated')).toBeInTheDocument();

  fireEvent.click(screen.getByText('View changes'));

  expect(await screen.findByText('Contributor_ID')).toBeInTheDocument();
  expect(screen.getByText('198176')).toBeInTheDocument();
});

test('generates a report with the entered label and reason', async () => {
  renderPage();
  await screen.findByText('No reports generated yet for this space.');

  const generateButton = screen.getByRole('button', { name: 'Generate' });
  expect(generateButton).toBeDisabled(); // no reason yet

  fireEvent.change(screen.getByPlaceholderText('e.g. period-end filing'), {
    target: { value: 'annual filing' },
  });
  expect(generateButton).not.toBeDisabled(); // PARTY prefills a label already

  fireEvent.click(generateButton);

  await waitFor(() =>
    expect(calls.some((c) => c.url.includes('/periods/67/entity-reports') && c.body)).toBe(true),
  );
  const call = calls.find((c) => c.url.endsWith('/periods/67/entity-reports') && c.body)!;
  expect(JSON.parse(call.body!)).toMatchObject({
    kind: 'ALL',
    entityKind: 'PARTY',
    ridingNumber: null,
    politicalEntityLabel: 'Green Party of Ontario',
    reason: 'annual filing',
  });
});
