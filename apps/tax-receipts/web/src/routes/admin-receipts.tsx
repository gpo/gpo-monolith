import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Card, Loader, Radio, Stack, Text, TextInput } from '@mantine/core';
import { ApiError, api, type ReceiptLayout } from '../api.js';

const LAYOUTS: { value: ReceiptLayout; label: string; description: string }[] = [
  {
    value: 'LEGACY',
    label: 'Original',
    description: 'The receipt as it has always been printed.',
  },
  {
    value: 'CONTRIBUTOR_TYPE',
    label: 'With contributor type',
    description: 'Adds "Contributor Type: Individual" above the contribution type.',
  },
];

/**
 * Receipt rendering settings (api/src/receipts/settings.ts). A layout change
 * applies to the next receipt PDF rendered (issue, reissue, reprint), never
 * to one already stored. Writes need `settings.administer` and a reason, and
 * are change-logged (subject `ReceiptSettings`).
 */
export function ReceiptSettingsSection() {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const settings = useQuery({ queryKey: ['receipt-settings'], queryFn: api.getReceiptSettings });
  const save = useMutation({
    mutationFn: (layout: ReceiptLayout) => api.setReceiptLayout(layout, reason),
    onSuccess: () => {
      setReason('');
      return qc.invalidateQueries({ queryKey: ['receipt-settings'] });
    },
  });

  if (settings.isLoading) return <Loader />;
  if (settings.isError || !settings.data) {
    return <Alert color="red">Failed to load the receipt settings.</Alert>;
  }

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text fw={600}>Receipt layout</Text>
        <Text size="sm" c="dimmed">
          Applies to receipts rendered from now on, including reissues and reprints. Receipts already
          issued keep the PDF they were issued with.
        </Text>
        <TextInput
          label="Reason (required to change the layout)"
          placeholder="e.g. Elections Ontario evaluation"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          maw={480}
        />
        <Radio.Group
          value={settings.data.receiptLayout}
          onChange={(value) => save.mutate(value as ReceiptLayout)}
        >
          <Stack gap="xs">
            {LAYOUTS.map((l) => (
              <Radio
                key={l.value}
                value={l.value}
                label={l.label}
                description={l.description}
                disabled={reason.trim().length < 3 || save.isPending}
              />
            ))}
          </Stack>
        </Radio.Group>
        {save.isError && (
          <Alert color="red">{save.error instanceof ApiError ? save.error.message : 'Failed to save.'}</Alert>
        )}
      </Stack>
    </Card>
  );
}
