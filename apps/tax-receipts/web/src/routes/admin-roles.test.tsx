import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PermissionRow, RoleRow } from '../api.js';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

const PERMISSIONS: PermissionRow[] = [
  { key: 'system.manage', group: 'System', label: 'Full system access', description: 'Everything.' },
  { key: 'records.readAll', group: 'Records', label: 'Read all records', description: 'Read everything.' },
  { key: 'receipt.issue', group: 'Receipts', label: 'Issue receipts', description: 'Issue receipts.' },
];

const ROLES: RoleRow[] = [
  {
    key: 'sysadmin',
    name: 'System administrator',
    description: '',
    builtIn: true,
    locked: true,
    permissions: ['system.manage'],
    userCount: 1,
  },
  {
    key: 'riding_auditor',
    name: 'Riding Auditor',
    description: 'Reads one riding',
    builtIn: false,
    locked: false,
    permissions: ['records.readAll'],
    userCount: 0,
  },
];

let calls: Array<{ url: string; method?: string; body?: string }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).includes('/admin/permissions')) return jsonResponse({ data: PERMISSIONS });
      if (String(url).includes('/admin/roles')) {
        if (init?.method === 'POST') return jsonResponse({ ...ROLES[1], key: 'new' }, 201);
        if (init?.method === 'PATCH') return jsonResponse(ROLES[1]);
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return jsonResponse({ data: ROLES });
      }
      return jsonResponse({ error: 'not found' }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = makeRouter(createMemoryHistory({ initialEntries: ['/admin/roles'] }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('lists roles with their permissions as labels', async () => {
  renderPage();
  expect(await screen.findByText('Riding Auditor')).toBeInTheDocument();
  expect(screen.getByText('Locked')).toBeInTheDocument();
  expect(screen.getByText('Read all records')).toBeInTheDocument();
});

test('creates a role with the chosen permissions and a reason', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'New role' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Receipt Signer' } });
  fireEvent.click(within(dialog).getByLabelText('Issue receipts'));
  const create = within(dialog).getByRole('button', { name: 'Create role' });
  expect(create).toBeDisabled(); // no reason yet
  fireEvent.change(within(dialog).getByLabelText('Reason for this change (required)'), {
    target: { value: 'board appointed a signer' },
  });
  fireEvent.click(create);

  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  const post = calls.find((c) => c.method === 'POST')!;
  expect(post.url).toContain('/admin/roles');
  expect(JSON.parse(post.body!)).toEqual({
    name: 'Receipt Signer',
    description: '',
    permissions: ['receipt.issue'],
    reason: 'board appointed a signer',
  });
});

test('the locked sysadmin role opens read-only', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'View' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText('Full system access')).toBeDisabled();
  expect(within(dialog).queryByRole('button', { name: 'Save role' })).toBeNull();
});

test('deletes an unused custom role with a reason', async () => {
  renderPage();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Reason for this change (required)'), {
    target: { value: 'no longer needed' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete role' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  const del = calls.find((c) => c.method === 'DELETE')!;
  expect(del.url).toContain('/admin/roles/riding_auditor');
  expect(JSON.parse(del.body!)).toEqual({ reason: 'no longer needed' });
});
