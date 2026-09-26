import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Anchor, Badge, Button, Card, Group, NativeSelect, Stack, Table, Text, Title } from '@mantine/core';
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
      <EmailOutboxCard />
      <DonorPrecheckOutboxCard />
    </Stack>
  );
}

/**
 * The email outbox (ticket 3.6): every queued or sent receipt and pre-check
 * email. "Send now" runs one dispatcher pass instead of waiting for the
 * background one. With the dev provider (nothing is really sent), each sent
 * email can be played a delivered or bounced event, which runs the same code
 * a real provider webhook does.
 */
function EmailOutboxCard() {
  const qc = useQueryClient();
  const outbox = useQuery({ queryKey: ['email-outbox'], queryFn: api.listOutboxEmails });
  const refresh = () => qc.invalidateQueries({ queryKey: ['email-outbox'] });
  const dispatch = useMutation({ mutationFn: api.dispatchEmails, onSuccess: refresh });
  const simulate = useMutation({
    mutationFn: (v: { id: string; type: 'delivered' | 'bounced' }) => api.simulateEmailEvent(v.id, v.type),
    onSuccess: refresh,
  });
  const isDev = outbox.data?.provider === 'dev';

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Email outbox</Text>
          <Group gap="xs">
            <Button size="xs" onClick={() => dispatch.mutate()} loading={dispatch.isPending}>
              Send now
            </Button>
            <Button size="xs" variant="light" onClick={() => outbox.refetch()} loading={outbox.isFetching}>
              Refresh
            </Button>
          </Group>
        </Group>
        <Text size="sm" c="dimmed">
          Provider: {outbox.data?.provider ?? '…'}
          {isDev && ' (sends nothing; simulate what a real provider would report)'}.
        </Text>
        {dispatch.isSuccess && (
          <Text size="sm">
            {dispatch.data.sent} sent, {dispatch.data.retrying} to retry, {dispatch.data.failed} failed
            {dispatch.data.heldByKillSwitch && '; receipt email held by the kill switch'}
            {dispatch.data.dailyLimitReached && '; daily limit reached'}.
          </Text>
        )}
        {(dispatch.isError || simulate.isError) && (
          <Alert color="red">{(dispatch.error ?? simulate.error)?.message}</Alert>
        )}
        {outbox.data && outbox.data.data.length > 0 ? (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>To</Table.Th>
                <Table.Th>What</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Queued</Table.Th>
                {isDev && <Table.Th></Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {outbox.data.data.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>
                    <Text size="sm">{m.contactName}</Text>
                    <Text size="xs" c="dimmed">
                      {m.toAddress}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{m.receiptNumber ? `Receipt ${m.receiptNumber}` : 'Pre-check'}</Text>
                    <Text size="xs" c="dimmed">
                      {m.subject}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={m.status === 'BOUNCED' || m.status === 'FAILED' ? 'red' : m.status === 'QUEUED' ? 'gray' : 'green'}>
                      {m.status}
                    </Badge>
                    {m.statusDetail && (
                      <Text size="xs" c="dimmed">
                        {m.statusDetail}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{new Date(m.queuedAt).toLocaleString()}</Table.Td>
                  {isDev && (
                    <Table.Td>
                      {m.providerMessageId && (
                        <Group gap={4} wrap="nowrap">
                          <Button size="compact-xs" variant="light" onClick={() => simulate.mutate({ id: m.id, type: 'delivered' })}>
                            Delivered
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="red"
                            onClick={() => simulate.mutate({ id: m.id, type: 'bounced' })}
                          >
                            Bounce
                          </Button>
                        </Group>
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm" c="dimmed">
            Nothing yet: send pre-checks or receipt emails from a space's issuance wizard.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Outstanding donor pre-check links (ticket 3.9): every unconfirmed,
 * unexpired confirmation token, each with a link straight to the public
 * confirm page. With the dev provider nothing reaches an inbox, so open a
 * donor's link here to test the confirm page as they would see it.
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
          Every pre-check sent from a space's issuance wizard, not yet confirmed or expired. Open a donor's
          link here to test the confirm page as they would see it.
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
    ['Backfilled', result.backfilled],
    ['Changed in Qomon (incident opened)', result.changedInQomon],
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
