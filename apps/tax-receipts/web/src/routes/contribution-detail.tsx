import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  NativeSelect,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api, ApiError, type MetadataEditInput } from '../api.js';

/**
 * Contribution detail (ticket 1.5, screens.md 3): Qomon facts read-only,
 * metadata editable with a mandatory reason, allocations/receipts, RTD
 * inclusions, WorkItems, and the change-log slice for this contribution.
 * Sync state and a "refresh from Qomon" action.
 */

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ContributionDetailPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['contribution', id],
    queryFn: () => api.getContribution(id),
  });

  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Omit<MetadataEditInput, 'reason'> | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const detail = query.data;
  const activeForm =
    form ??
    (detail?.metadata
      ? {
          periodId: detail.metadata.periodId,
          ridingNumber: detail.metadata.ridingNumber,
          entityKind: detail.metadata.entityKind,
          receivedBy: detail.metadata.receivedBy,
          goodsServices: detail.metadata.goodsServices,
          nonDeductibleCents: detail.metadata.nonDeductibleCents,
          processedDate: detail.metadata.processedDate,
          sourceCode: detail.metadata.sourceCode,
          eoContributorId: detail.metadata.eoContributorId,
          exceptionReason: detail.metadata.exceptionReason,
          // external_ref lives on the Contribution row itself (a cache of
          // metadata.external_ref, data-model §2), not on ContributionMetadata
          externalRef: detail.externalRef,
        }
      : null);

  function updateForm<K extends keyof Omit<MetadataEditInput, 'reason'>>(
    key: K,
    value: Omit<MetadataEditInput, 'reason'>[K],
  ) {
    if (!activeForm) return;
    setForm({ ...activeForm, [key]: value });
  }

  const refresh = useMutation({
    mutationFn: () => api.refreshContribution(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contribution', id] }),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!activeForm) throw new Error('nothing to save');
      return api.editContributionMetadata(id, { ...activeForm, reason });
    },
    onSuccess: () => {
      setEditError(null);
      setReason('');
      setForm(null);
      return qc.invalidateQueries({ queryKey: ['contribution', id] });
    },
    onError: (err) => {
      setEditError(err instanceof ApiError ? err.message : 'Failed to save.');
    },
  });

  if (query.isLoading) return <Loader />;
  if (query.isError || !detail) return <Text c="red">Contribution not found.</Text>;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Contribution</Title>
        <Anchor to="/contributions">&larr; Back to list</Anchor>
      </Group>

      <Card withBorder>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600}>Qomon facts</Text>
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                last synced: {detail.lastSyncedAt ? new Date(detail.lastSyncedAt).toLocaleString() : 'never'}
              </Text>
              <Button size="xs" variant="light" onClick={() => refresh.mutate()} loading={refresh.isPending}>
                Refresh from Qomon
              </Button>
            </Group>
          </Group>
          {detail.deletedInQomonAt && (
            <Alert color="red">
              Sync incident: absent from Qomon as of {new Date(detail.deletedInQomonAt).toLocaleString()}.
            </Alert>
          )}
          <Group grow>
            <Text>Donor: {detail.contact.name}</Text>
            <Text>Amount: {money(detail.amountCents)}</Text>
            <Text>Accepted: {new Date(detail.acceptedAt).toLocaleDateString()}</Text>
            <Text>Status: {detail.statusKind}</Text>
          </Group>
          <Group grow>
            <Text>Payment method: {detail.paymentMethodKind ?? '—'}</Text>
            <Text>Code campaign: {detail.codeCampaign ?? '—'}</Text>
            <Text>External ref: {detail.externalRef ?? '—'}</Text>
          </Group>
          {detail.comment && <Text size="sm">Comment: {detail.comment}</Text>}
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="sm">
          <Text fw={600}>Metadata</Text>
          {!activeForm ? (
            <Text c="dimmed">
              No metadata yet — this contribution is waiting on intake derivation.
            </Text>
          ) : (
            <>
              <Group grow>
                <NumberInput
                  label="Period id"
                  value={activeForm.periodId}
                  onChange={(v) => updateForm('periodId', typeof v === 'number' ? v : activeForm.periodId)}
                />
                <NumberInput
                  label="Riding number"
                  min={1}
                  max={124}
                  value={activeForm.ridingNumber ?? undefined}
                  onChange={(v) => updateForm('ridingNumber', typeof v === 'number' ? v : null)}
                />
                <NativeSelect
                  label="Entity kind"
                  data={['PARTY', 'CA', 'CAMPAIGN']}
                  value={activeForm.entityKind}
                  onChange={(e) => updateForm('entityKind', e.currentTarget.value)}
                />
                <NativeSelect
                  label="Received by"
                  data={['GPO', 'ENTITY']}
                  value={activeForm.receivedBy}
                  onChange={(e) => updateForm('receivedBy', e.currentTarget.value)}
                />
              </Group>
              <Group grow align="flex-end">
                <NumberInput
                  label="Non-deductible ($)"
                  value={activeForm.nonDeductibleCents / 100}
                  onChange={(v) =>
                    updateForm('nonDeductibleCents', typeof v === 'number' ? Math.round(v * 100) : 0)
                  }
                />
                <Checkbox
                  label="Goods &amp; services"
                  checked={activeForm.goodsServices}
                  onChange={(e) => updateForm('goodsServices', e.currentTarget.checked)}
                />
                <TextInput
                  label="Source code"
                  value={activeForm.sourceCode}
                  onChange={(e) => updateForm('sourceCode', e.currentTarget.value)}
                />
              </Group>
              <TextInput
                label="Reason for this edit (required)"
                placeholder="e.g. CFO subspace intake review"
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
              {editError && <Alert color="red">{editError}</Alert>}
              <Group>
                <Button
                  onClick={() => save.mutate()}
                  loading={save.isPending}
                  disabled={reason.trim().length < 3}
                >
                  Save metadata
                </Button>
                {form && (
                  <Button variant="subtle" onClick={() => setForm(null)}>
                    Discard changes
                  </Button>
                )}
              </Group>
            </>
          )}
        </Stack>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Work items
        </Text>
        {detail.workItems.length === 0 ? (
          <Text c="dimmed">None.</Text>
        ) : (
          <Table>
            <Table.Tbody>
              {detail.workItems.map((w) => (
                <Table.Tr key={w.id}>
                  <Table.Td>{w.kind}</Table.Td>
                  <Table.Td>{w.ruleRef ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge color={w.status === 'OPEN' ? 'orange' : w.status === 'EXCEPTION' ? 'yellow' : 'green'}>
                      {w.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{new Date(w.openedAt).toLocaleDateString()}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Allocations &amp; receipts
        </Text>
        {detail.allocations.length === 0 ? (
          <Text c="dimmed">None issued yet.</Text>
        ) : (
          <Table>
            <Table.Tbody>
              {detail.allocations.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>{a.receipt.receiptNumber}</Table.Td>
                  <Table.Td>{a.receipt.status}</Table.Td>
                  <Table.Td>{money(a.amountCents)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Change-log
        </Text>
        {detail.changeLog.length === 0 ? (
          <Text c="dimmed">None yet.</Text>
        ) : (
          <Stack gap="xs">
            {detail.changeLog.map((c) => (
              <Group key={c.id} justify="space-between" wrap="nowrap">
                <Text size="sm">{c.reason}</Text>
                <Text size="xs" c="dimmed">
                  {new Date(c.at).toLocaleString()}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

function Anchor({ to, children }: { to: '/contributions'; children: React.ReactNode }) {
  return (
    <Link to={to}>
      <Text span c="blue" size="sm">
        {children}
      </Text>
    </Link>
  );
}
