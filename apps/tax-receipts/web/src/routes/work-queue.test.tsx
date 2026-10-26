import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const VALIDATION_PAGE = {
  data: [
    {
      id: 'w1',
      kind: 'VALIDATION',
      subjectType: 'Contribution',
      subjectId: 'c1',
      contactId: 'ct1',
      contactName: 'Dana Donor',
      ruleRef: 'A8',
      dueAt: null,
      status: 'OPEN',
      assigneeUserId: null,
      resolutionNote: null,
      openedAt: '2026-03-01T00:00:00.000Z',
      closedAt: null,
    },
    {
      id: 'w2',
      kind: 'VALIDATION',
      subjectType: 'Contribution',
      subjectId: 'c2',
      contactId: 'ct2',
      contactName: 'Out Of Province Olive',
      ruleRef: 'B1',
      dueAt: null,
      status: 'EXCEPTION',
      assigneeUserId: null,
      resolutionNote: 'Ontario student at UBC',
      openedAt: '2026-03-01T00:00:00.000Z',
      closedAt: '2026-03-02T00:00:00.000Z',
    },
  ],
  nextCursor: null,
};
const EMPTY_PAGE = { data: [], nextCursor: null };

let calls: Array<{ url: string; method?: string; body?: string }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).endsWith('/resolve') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ...VALIDATION_PAGE.data[0], status: 'RESOLVED' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).endsWith('/exception') && init?.method === 'PATCH') {
        return new Response(JSON.stringify(VALIDATION_PAGE.data[1]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('kind=VALIDATION')) {
        return new Response(JSON.stringify(VALIDATION_PAGE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(EMPTY_PAGE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/work-queue'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('shows the validation tab by default with its items', async () => {
  renderPage();
  expect(await screen.findByText('Dana Donor')).toBeInTheDocument();
  expect(screen.getByText('Cash contribution exceeds the $25 EFA limit')).toBeInTheDocument();
  expect(screen.getByText('(A8)')).toBeInTheDocument();
});

test('switching tabs re-queries by kind', async () => {
  renderPage();
  await screen.findByText('Dana Donor');
  calls = [];
  fireEvent.click(screen.getByRole('button', { name: 'Diff queue' }));
  await waitFor(() => expect(calls.some((c) => c.url.includes('kind=DIFF'))).toBe(true));
});

test('resolving an item requires a note and posts the outcome', async () => {
  renderPage();
  await screen.findByText('Dana Donor');

  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  const dialog = await screen.findByRole('dialog', { name: 'Resolve work item' });
  const submit = within(dialog).getByRole('button', { name: 'Resolve' });
  expect(submit).toBeDisabled();

  fireEvent.change(within(dialog).getByLabelText(/Resolution note/), { target: { value: 'fixed it' } });
  expect(submit).not.toBeDisabled();
  fireEvent.click(submit);

  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/resolve'))).toBe(true));
  const call = calls.find((c) => c.url.endsWith('/resolve'));
  expect(JSON.parse(call!.body!)).toMatchObject({ reason: 'fixed it', outcome: 'RESOLVED' });
});

test('an exception opens in a modal with room for a long reason', async () => {
  renderPage();
  await screen.findByText('Dana Donor');

  fireEvent.click(screen.getByRole('button', { name: 'Exception' }));
  const dialog = await screen.findByRole('dialog', { name: 'Record an exception' });
  const reason = 'Ontario resident studying at UBC.\nHome address in Ottawa confirmed by phone.';
  fireEvent.change(within(dialog).getByLabelText(/Exception reason/), { target: { value: reason } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Record exception' }));

  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/resolve'))).toBe(true));
  const call = calls.find((c) => c.url.endsWith('/resolve'));
  expect(JSON.parse(call!.body!)).toEqual({ reason, outcome: 'EXCEPTION' });
});

test("editing an exception changes its reason and needs a reason for the edit", async () => {
  renderPage();
  await screen.findByText('Out Of Province Olive');

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit exception' });
  const note = within(dialog).getByLabelText(/Exception reason/);
  expect(note).toHaveValue('Ontario student at UBC');
  const save = within(dialog).getByRole('button', { name: 'Save exception' });
  expect(save).toBeDisabled();

  fireEvent.change(note, { target: { value: 'Ontario student at UBC; Ottawa home address confirmed' } });
  expect(save).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText(/Reason for the edit/), { target: { value: 'added how it was confirmed' } });
  expect(save).not.toBeDisabled();
  fireEvent.click(save);

  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  const call = calls.find((c) => c.method === 'PATCH');
  expect(call!.url).toMatch(/\/work-items\/w2\/exception$/);
  expect(JSON.parse(call!.body!)).toEqual({
    exceptionReason: 'Ontario student at UBC; Ottawa home address confirmed',
    reason: 'added how it was confirmed',
  });
});
