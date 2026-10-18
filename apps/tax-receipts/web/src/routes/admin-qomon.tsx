import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Checkbox, Group, Loader, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { ApiError, api, type QomonSettingsInput } from '../api.js';

/**
 * The party-level Qomon space (api/src/qomon/settings.ts). Off until a
 * system administrator enables it here with an API key; nothing in the
 * environment turns it on. The key is write-only: the page shows only
 * whether one is on file. Saves need a reason and are change-logged
 * (subject `QomonSettings`), without the key.
 */
export function QomonSettingsSection() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['qomon-settings'], queryFn: api.getQomonSettings, retry: false });
  const [enabled, setEnabled] = useState(false);
  const [apiBase, setApiBase] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setApiBase(settings.data.apiBase);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (input: QomonSettingsInput) => api.setQomonSettings(input),
    onSuccess: () => {
      setApiKey('');
      setReason('');
      // contributor ownership follows this setting (D13)
      return Promise.all([
        qc.invalidateQueries({ queryKey: ['qomon-settings'] }),
        qc.invalidateQueries({ queryKey: ['contact-settings'] }),
      ]);
    },
  });

  if (settings.isLoading) return <Loader />;
  if (settings.error instanceof ApiError && settings.error.status === 403) {
    return <Alert color="blue">Only a system administrator can see and change the Qomon settings.</Alert>;
  }
  if (settings.isError || !settings.data) return <Alert color="red">Failed to load the Qomon settings.</Alert>;

  const s = settings.data;
  const changed = enabled !== s.enabled || apiBase.trim() !== s.apiBase || apiKey.trim().length > 0;
  const keyMissing = enabled && !s.apiKeySet && apiKey.trim().length === 0;

  function submit() {
    save.mutate({
      ...(enabled !== s.enabled ? { enabled } : {}),
      ...(apiBase.trim() !== s.apiBase ? { apiBase: apiBase.trim() } : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      reason: reason.trim(),
    });
  }

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Qomon (party space)</Text>
          <Badge color={s.enabled ? 'green' : 'gray'} size="lg">
            {s.enabled ? 'Enabled' : 'Off'}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          While Qomon is off, contributors are kept in this tool only, Qomon contacts cannot be edited,
          and the party mirror sweep does not run. Enabled, a contributor added or edited here is
          written to Qomon first. Ridings with their own space are set up under Ridings.
        </Text>
        <Checkbox
          label="Enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
        />
        <TextInput
          label="API base URL"
          value={apiBase}
          onChange={(e) => setApiBase(e.currentTarget.value)}
          maw={480}
        />
        <PasswordInput
          label="API key"
          description={
            s.apiKeySet
              ? 'A key is on file. It is never shown; enter a new one to replace it.'
              : 'No key on file.'
          }
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
          autoComplete="off"
          maw={480}
        />
        <TextInput
          label="Reason (required)"
          placeholder="e.g. connect the party space"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          maw={480}
        />
        {keyMissing && <Alert color="yellow">Enter an API key to enable Qomon.</Alert>}
        <Group>
          <Button
            onClick={submit}
            loading={save.isPending}
            disabled={!changed || keyMissing || reason.trim().length < 3}
          >
            Save
          </Button>
        </Group>
        {save.isError && (
          <Alert color="red">{save.error instanceof ApiError ? save.error.message : 'Failed to save.'}</Alert>
        )}
      </Stack>
    </Card>
  );
}
