import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { api } from '../api.js';

const MIN_LENGTH = 12;

/**
 * Account menu > Change password (EO evaluation row 12). The server
 * re-checks the current password and signs out the user's other sessions;
 * this one stays signed in.
 */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useMutation({ mutationFn: () => api.changePassword(current, next) });

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && next.length >= MIN_LENGTH && confirm === next;

  return (
    <Modal opened onClose={onClose} title="Change password">
      {change.isSuccess ? (
        <Stack gap="sm">
          <Alert color="green">
            Your password has been changed.
            {change.data.otherSessionsSignedOut > 0 &&
              ` ${change.data.otherSessionsSignedOut} other signed-in session(s) were signed out.`}
          </Alert>
          <Group justify="flex-end">
            <Button onClick={onClose}>Done</Button>
          </Group>
        </Stack>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) change.mutate();
          }}
        >
          <Stack gap="sm">
            <PasswordInput
              label="Current password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.currentTarget.value)}
            />
            <PasswordInput
              label="New password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.currentTarget.value)}
              error={tooShort ? `At least ${MIN_LENGTH} characters` : undefined}
            />
            <PasswordInput
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
              error={mismatch ? 'Does not match the new password' : undefined}
            />
            <Text size="xs" c="dimmed">
              Changing your password signs you out everywhere else.
            </Text>
            {change.isError && <Alert color="red">{change.error.message}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!ready} loading={change.isPending}>
                Change password
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
