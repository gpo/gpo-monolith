import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeRouter } from '../router.js';
import { ME, jsonResponse } from '../test/fixtures.js';

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let passwordResponse: () => Response;

beforeEach(() => {
  calls = [];
  passwordResponse = () => jsonResponse({ ok: true, otherSessionsSignedOut: 2 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      if (String(url).includes('/auth/me')) return jsonResponse(ME);
      if (String(url).includes('/auth/password')) return passwordResponse();
      if (String(url).includes('/auth/profile')) return jsonResponse({ name: 'Terry T.', email: 'terry@example.org' });
      if (String(url).includes('/admin/users')) {
        if (init?.method === 'POST') return jsonResponse({ ok: true, sessionsSignedOut: 1 });
        if (init?.method === 'PATCH') return jsonResponse({});
        return jsonResponse({
          data: [
            {
              id: 'u2',
              name: 'Pat Filer',
              email: 'pat@example.org',
              role: 'filer',
              roleName: 'Filer',
              active: true,
              isCfoDesignate: false,
              allRidings: true,
              ridingGrants: [],
            },
          ],
        });
      }
      if (String(url).includes('/admin/roles')) return jsonResponse({ data: [] });
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

async function openChangePassword() {
  renderAt('/');
  fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Change password' }));
  return screen.findByRole('dialog');
}

function fill(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

test('changes the password from the account menu', async () => {
  const dialog = await openChangePassword();
  const submit = within(dialog).getByRole('button', { name: 'Change password' });
  fill(dialog, 'Current password', 'old-pass-phrase');
  fill(dialog, 'New password', 'new-pass-phrase-123');
  fill(dialog, 'Confirm new password', 'new-pass-phrase-12');
  expect(within(dialog).getByText('Does not match the new password')).toBeInTheDocument();
  expect(submit).toBeDisabled();

  fill(dialog, 'Confirm new password', 'new-pass-phrase-123');
  fireEvent.click(submit);

  expect(await within(dialog).findByText(/Your password has been changed/)).toBeInTheDocument();
  expect(within(dialog).getByText(/2 other signed-in session\(s\) were signed out/)).toBeInTheDocument();
  const post = calls.find((c) => c.url.includes('/auth/password'))!;
  expect(JSON.parse(post.body!)).toEqual({ currentPassword: 'old-pass-phrase', newPassword: 'new-pass-phrase-123' });
});

test('shows the server error for a wrong current password', async () => {
  passwordResponse = () => jsonResponse({ error: 'the current password is incorrect' }, 400);
  const dialog = await openChangePassword();
  fill(dialog, 'Current password', 'wrong');
  fill(dialog, 'New password', 'new-pass-phrase-123');
  fill(dialog, 'Confirm new password', 'new-pass-phrase-123');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
  expect(await within(dialog).findByText('the current password is incorrect')).toBeInTheDocument();
});

test('an admin resets a user password with a reason', async () => {
  renderAt('/admin/users');
  fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }));
  const dialog = await screen.findByRole('dialog');
  fill(dialog, 'Temporary password (12+ chars)', 'temporary-pass-phrase');
  fill(dialog, 'Reason (required)', 'forgot password');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
  expect(await within(dialog).findByText(/Password reset/)).toBeInTheDocument();
  await waitFor(() => expect(calls.some((c) => c.url.includes('/admin/users/u2/password'))).toBe(true));
  const post = calls.find((c) => c.url.includes('/admin/users/u2/password'))!;
  expect(JSON.parse(post.body!)).toEqual({ newPassword: 'temporary-pass-phrase', reason: 'forgot password' });
});

test('edits own name without a password, but asks for one when the email changes', async () => {
  renderAt('/');
  fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit profile' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByLabelText('Current password')).toBeNull();
  fill(dialog, 'Name', 'Terry T.');
  fill(dialog, 'Email (used to sign in)', 'terry.t@example.org');
  const save = within(dialog).getByRole('button', { name: 'Save' });
  expect(save).toBeDisabled();
  fill(dialog, 'Current password', 'my-pass-phrase');
  fireEvent.click(save);
  await waitFor(() => expect(calls.some((c) => c.url.includes('/auth/profile'))).toBe(true));
  const patch = calls.find((c) => c.url.includes('/auth/profile'))!;
  expect(JSON.parse(patch.body!)).toEqual({
    name: 'Terry T.',
    email: 'terry.t@example.org',
    currentPassword: 'my-pass-phrase',
  });
});

test('an admin edits a user name and email with a reason', async () => {
  renderAt('/admin/users');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog');
  fill(dialog, 'Name', 'Pat Filer-Smith');
  fill(dialog, 'Reason (required)', 'legal name change');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  const patch = calls.find((c) => c.method === 'PATCH')!;
  expect(patch.url).toContain('/admin/users/u2');
  expect(JSON.parse(patch.body!)).toEqual({
    name: 'Pat Filer-Smith',
    email: 'pat@example.org',
    reason: 'legal name change',
  });
});
