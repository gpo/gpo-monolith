import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ContactDetail, ContactSource } from '../api.js';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const ADA: ContactDetail = {
  id: 'ct1',
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.org',
  contributorType: 'INDIVIDUAL',
  address: { housenumber: '12', street: 'Queen St', city: 'Guelph', state: 'ON', postalcode: 'N1H 1A1', country: 'CA' },
  formattedAddress: { line1: '12 Queen St', city: 'Guelph', province: 'ON', postalCode: 'N1H 1A1', country: 'CA' },
  qomonContactId: null,
  source: 'tool',
  lastSyncedAt: null,
  mergedIntoId: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  editable: true,
  contributions: [],
  changeLog: [
    {
      id: 'e1',
      actorUserId: 'u1',
      actorName: 'Terry Tester',
      reason: 'walk-in cheque',
      before: null,
      after: { name: 'Ada Lovelace' },
      at: '2026-10-01T12:00:00.000Z',
      correlationId: 'k1',
    },
  ],
};

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let me = ME;
let source: ContactSource = 'tool';
let detail: ContactDetail = ADA;

beforeEach(() => {
  calls = [];
  me = ME;
  source = 'tool';
  detail = ADA;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.includes('/auth/me')) return jsonResponse(me);
      if (u.endsWith('/contacts/settings')) return jsonResponse({ source });
      if (u.includes('/contacts?')) return jsonResponse({ data: [{ ...ADA, formattedAddress: ADA.formattedAddress }] });
      if (u.endsWith('/contacts') && init?.method === 'POST') return jsonResponse({ ...ADA, id: 'ct9' }, 201);
      if (u.endsWith('/contacts/ct1') && init?.method === 'PATCH') return jsonResponse(ADA);
      if (/\/contacts\/ct\d$/.test(u)) return jsonResponse(detail);
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
  return router;
}

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test('lists contributors with where each is kept', async () => {
  renderAt('/contributors');
  expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
  expect(screen.getByText('This tool')).toBeTruthy();
  expect(screen.getByText('12 Queen St, Guelph ON N1H 1A1')).toBeTruthy();
});

test('adds a tool-owned contributor with a reason, saying it stays in this tool', async () => {
  const router = renderAt('/contributors');
  fireEvent.click(await screen.findByRole('button', { name: 'Add a contributor' }));
  expect(await screen.findByText(/Qomon is not connected, so this contributor will be kept in this tool only/)).toBeTruthy();

  type(/First name/, 'Ada');
  type(/Last name/, 'Lovelace');
  type(/^Email/, 'ada@example.org');
  type(/^Street$/, 'Queen St');
  type(/^City/, 'Guelph');
  type(/Postal code/, 'N1H 1A1');
  const submit = screen.getByRole('button', { name: 'Add contributor' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true); // no reason yet
  type(/Reason/, 'walk-in cheque');
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);

  await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/contacts'))).toBe(true));
  const body = JSON.parse(calls.find((c) => c.method === 'POST')!.body!);
  expect(body).toEqual({
    reason: 'walk-in cheque',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.org',
    address: { housenumber: null, street: 'Queen St', city: 'Guelph', state: 'ON', postalcode: 'N1H 1A1', country: 'CA' },
    allowDuplicate: false,
  });
  await waitFor(() => expect(router.state.location.pathname).toBe('/contributors/ct9'));
});

test('holds back a likely duplicate until the operator confirms a different person', async () => {
  let attempts = 0;
  const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/contacts') && init?.method === 'POST') {
        calls.push({ url: String(url), method: 'POST', body: init.body as string });
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ error: 'this may be a contributor already on file: Ada Lovelace (ada@example.org)' }, 409)
          : jsonResponse({ ...ADA, id: 'ct9' }, 201);
      }
      return base(url, init);
    }),
  );
  renderAt('/contributors');
  fireEvent.click(await screen.findByRole('button', { name: 'Add a contributor' }));
  type(/First name/, 'William');
  type(/Last name/, 'King');
  type(/^Email/, 'ada@example.org');
  type(/Reason/, 'spouse of Ada');
  fireEvent.click(screen.getByRole('button', { name: 'Add contributor' }));
  expect(await screen.findByText(/already on file: Ada Lovelace/)).toBeTruthy();

  fireEvent.click(screen.getByLabelText(/different person/));
  fireEvent.click(screen.getByRole('button', { name: 'Add contributor' }));
  await waitFor(() => expect(attempts).toBe(2));
  const posts = calls.filter((c) => c.method === 'POST');
  expect(JSON.parse(posts[0]!.body!).allowDuplicate).toBe(false);
  expect(JSON.parse(posts[1]!.body!).allowDuplicate).toBe(true);
});

test('says a new contributor goes to Qomon first when Qomon is connected', async () => {
  source = 'qomon';
  renderAt('/contributors');
  fireEvent.click(await screen.findByRole('button', { name: 'Add a contributor' }));
  expect(await screen.findByText(/will be created in Qomon first/)).toBeTruthy();
});

test('refuses a half-filled address', async () => {
  renderAt('/contributors');
  fireEvent.click(await screen.findByRole('button', { name: 'Add a contributor' }));
  type(/First name/, 'Ada');
  type(/Last name/, 'Lovelace');
  type(/^City/, 'Guelph');
  type(/Reason/, 'walk-in cheque');
  expect(await screen.findByText(/or leave the address blank/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Add contributor' }) as HTMLButtonElement).disabled).toBe(true);
});

test('shows a contributor with type, change history, and an edit form', async () => {
  renderAt('/contributors/ct1');
  expect(await screen.findByText('Contributor type: Individual')).toBeTruthy();
  expect(screen.getByText('walk-in cheque')).toBeTruthy();
  expect(screen.getByText('Terry Tester')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Edit contributor' }));
  expect(((await screen.findByLabelText(/First name/)) as HTMLInputElement).value).toBe('Ada');
  type(/Last name/, 'King');
  type(/Reason/, 'married name');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/contacts/ct1'))).toBe(true));
  expect(JSON.parse(calls.find((c) => c.method === 'PATCH')!.body!)).toMatchObject({ lastName: 'King', reason: 'married name' });
});

test('offers no edit for a Qomon contact while Qomon is not connected', async () => {
  detail = { ...ADA, source: 'qomon', qomonContactId: '42', editable: false };
  renderAt('/contributors/ct1');
  expect(await screen.findByText(/Qomon is not connected here, so it cannot be edited/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit contributor' })).toBeNull();
});

test('hides add and edit from a user without contact.manage', async () => {
  me = { ...ME, can: { ...ME.can, addContacts: false, editContacts: false } };
  renderAt('/contributors');
  expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add a contributor' })).toBeNull();
});
