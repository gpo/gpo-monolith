import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Group, Modal, PasswordInput, Stack, TextInput } from '@mantine/core';
import { api } from '../api.js';

/**
 * Account menu > Edit profile (EO evaluation row 5): a user's own name and
 * email. The email is the sign-in name, so changing it asks for the current
 * password; the server enforces the same.
 */
export function ProfileModal({ name, email, onClose }: { name: string; email: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name, email, currentPassword: '' });
  const emailChanging = form.email.trim().toLowerCase() !== email.toLowerCase();
  const save = useMutation({
    mutationFn: () =>
      api.updateProfile({
        name: form.name,
        ...(emailChanging ? { email: form.email, currentPassword: form.currentPassword } : {}),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      onClose();
    },
  });
  const ready = form.name.trim().length > 0 && form.email.trim().length > 0 && (!emailChanging || form.currentPassword);

  return (
    <Modal opened onClose={onClose} title="Edit profile">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <Stack gap="sm">
          <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <TextInput
            label="Email (used to sign in)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
          />
          {emailChanging && (
            <PasswordInput
              label="Current password"
              description="Needed to change the email you sign in with."
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.currentTarget.value })}
            />
          )}
          {save.isError && <Alert color="red">{save.error.message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready} loading={save.isPending}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
