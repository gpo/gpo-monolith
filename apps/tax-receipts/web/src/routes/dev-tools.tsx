import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Anchor, Button, Card, Group, NativeSelect, Stack, Table, Text, Title } from '@mantine/core';
import { ApiError, api, type SweepResult } from '../api.js';

/**
 * Dev-only convenience page (never routed/linked outside `import.meta.env.DEV`,
 * see router.tsx). A thin wrapper over sysadmin-only endpoints — it adds no
 * privilege of its own, the server still enforces the sysadmin check.
 */
export function DevToolsPage() {
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental');
  const [target, setTarget] = useState('party');
  const ridings = useQuery({ queryKey: ['admin-ridings'], queryFn: api.listRidings });
  const ridingNumber = target === 'party' ? undefined : Number(target);
  const sweep = useMutation({ mutationFn: () => api.syncSweep(mode, ridingNumber) });

  const notConfigured = sweep.error instanceof ApiError && sweep.error.status === 404;

  return (
    <Stack gap="lg">
      <Title order={2}>Dev tools</Title>
      <Card withBorder>
        <Stack gap="sm">
          <Text fw={600}>Qomon mirror sweep</Text>
          <Text size="sm" c="dimmed">
            Manually triggers POST /internal/sync/sweep (sysadmin only, ticket 1.1). No
            cron exists yet, so this is the only way to pull new spaces in locally. A
            riding with its own Qomon space (Admin &gt; Ridings) can be swept on its own
            instead of the party space.
          </Text>
          <Group grow maw={450}>
            <NativeSelect
              label="Mode"
              data={['incremental', 'full']}
              value={mode}
              onChange={(e) => setMode(e.currentTarget.value as 'incremental' | 'full')}
            />
            <NativeSelect
              label="Space"
              data={[
                { value: 'party', label: 'Party space (QOMON_API_KEY)' },
                ...(ridings.data?.data.map((r) => ({
                  value: String(r.ridingNumber),
                  label: `Riding ${r.ridingNumber} — ${r.name}${r.active ? '' : ' (inactive)'}`,
                })) ?? []),
              ]}
              value={target}
              onChange={(e) => setTarget(e.currentTarget.value)}
            />
          </Group>
          <Group>
            <Button onClick={() => sweep.mutate()} loading={sweep.isPending}>
              Run sweep
            </Button>
          </Group>
          {notConfigured && (
            <Alert color="yellow">
              404 — {ridingNumber
                ? `no riding ${ridingNumber} on file (Admin > Ridings).`
                : 'no Qomon client is configured on the API. Set QOMON_API_KEY (and QOMON_API_BASE) in apps/tax-receipts/api/.env and restart the API.'}
            </Alert>
          )}
          {sweep.isError && !notConfigured && (
            <Alert color="red">{sweep.error.message}</Alert>
          )}
          {sweep.isSuccess && <SweepSummary result={sweep.data} />}
          {sweep.isSuccess && sweep.data.contactFetchFailures.length > 0 && (
            <Alert color="orange">
              <Text size="sm" fw={600}>
                {sweep.data.contactFetchFailures.length} transaction(s) skipped — Qomon 404'd
                their contact:
              </Text>
              {sweep.data.contactFetchFailures.map((f) => (
                <Text size="sm" key={f.qomonTransactionId}>
                  transaction {f.qomonTransactionId} (contact {f.qomonContactId}): {f.message}
                </Text>
              ))}
              <Text size="sm" c="dimmed">
                Not lost — a full sweep retries these until the contact resolves.
              </Text>
            </Alert>
          )}
        </Stack>
      </Card>
      <DonorPrecheckOutboxCard />
    </Stack>
  );
}

/**
 * Stand-in inbox for the donor pre-check (ticket 3.9) until a real email
 * provider exists (ticket 3.6, O24): every outstanding, unexpired
 * confirmation token, each with a link straight to the public confirm page
 * — click one exactly as a donor would click the link in an email.
 */
function DonorPrecheckOutboxCard() {
  const outbox = useQuery({
    queryKey: ['donor-precheck-outbox'],
    queryFn: api.listOutstandingDonorPrechecks,
  });

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Donor pre-check outbox</Text>
          <Button size="xs" variant="light" onClick={() => outbox.refetch()} loading={outbox.isFetching}>
            Refresh
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Every pre-check sent from a space's issuance wizard, not yet confirmed or expired. No real email
          goes out (ticket 3.6) — open a donor's link here to test the confirm page as they would see it.
        </Text>
        {outbox.isLoading ? (
          <Text size="sm" c="dimmed">
            Loading…
          </Text>
        ) : outbox.data && outbox.data.data.length > 0 ? (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Donor</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Sent</Table.Th>
                <Table.Th>Expires</Table.Th>
                <Table.Th></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {outbox.data.data.map((row) => (
                <Table.Tr key={row.confirmationToken}>
                  <Table.Td>{row.contactName}</Table.Td>
                  <Table.Td>{row.email ?? '—'}</Table.Td>
                  <Table.Td>{new Date(row.precheckSentAt).toLocaleString()}</Table.Td>
                  <Table.Td>{new Date(row.confirmationTokenExpiresAt).toLocaleString()}</Table.Td>
                  <Table.Td>
                    <Anchor href={`/donor-precheck/${row.confirmationToken}`} target="_blank" rel="noreferrer">
                      Open confirm page ↗
                    </Anchor>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm" c="dimmed">
            Nothing outstanding — send one from a space's issuance wizard.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

function SweepSummary({ result }: { result: SweepResult }) {
  const rows: Array<[string, string | number]> = [
    ['Mode', result.mode],
    ['Pulled', result.pulled],
    ['Created', result.created],
    ['Refreshed', result.refreshed],
    ['Diff-queued', result.diffQueued],
    ['Unchanged', result.unchanged],
    ['Sync incidents', result.syncIncidents],
    ['More to pull', result.hasMore ? 'yes — run again' : 'no'],
  ];
  return (
    <Table>
      <Table.Tbody>
        {rows.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td>{label}</Table.Td>
            <Table.Td>{value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
