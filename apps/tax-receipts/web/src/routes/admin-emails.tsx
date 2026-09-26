import { Fragment, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  NativeSelect,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { ApiError, api, type EmailLogFilters, type EmailLogRow } from '../api.js';

/**
 * Admin > Emails: the live-sending switch and the log of every email the
 * tool has queued or sent (receipts and donor pre-checks). Sysadmin-only on
 * the server; a pre-check body carries a live confirmation link.
 *
 * Live sending needs the environment to allow it (EMAIL_LIVE_SENDING_ALLOWED,
 * production only) as well as this switch. Anywhere else the switch is
 * locked off and every send is simulated: recorded as sent, with nothing
 * reaching the provider. A simulated email can be played a delivered or
 * bounced event here, to exercise what a real provider report would do.
 */
export function EmailsSection() {
  return (
    <Stack gap="lg">
      <EmailSettingsCard />
      <EmailLogCard />
    </Stack>
  );
}

function EmailSettingsCard() {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const settings = useQuery({ queryKey: ['email-settings'], queryFn: api.getEmailSettings });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setLiveSending(enabled, reason),
    onSuccess: () => {
      setReason('');
      return qc.invalidateQueries({ queryKey: ['email-settings'] });
    },
  });

  if (settings.isLoading) return <Loader />;
  if (settings.isError || !settings.data) {
    return <Alert color="red">Failed to load the email settings.</Alert>;
  }
  const s = settings.data;
  const locked = !s.liveSendingAllowed || s.provider === 'dev';

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Email sending</Text>
          <Badge color={s.mode === 'live' ? 'red' : 'gray'} size="lg">
            {s.mode === 'live' ? 'LIVE: emails go to donors' : 'Simulated: nothing is sent'}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          Provider: {s.provider}. Simulated sends go through every step (marked sent, receipt marked
          delivered) without reaching the provider.
        </Text>
        {!s.liveSendingAllowed && (
          <Alert color="blue">
            Live sending is locked off in this environment. Only an environment with
            EMAIL_LIVE_SENDING_ALLOWED=true (production) can turn it on.
          </Alert>
        )}
        {s.liveSendingAllowed && s.provider === 'dev' && (
          <Alert color="blue">The dev provider sends nothing; configure EMAIL_PROVIDER to send for real.</Alert>
        )}
        <TextInput
          label="Reason (required to change)"
          placeholder="e.g. production go-live"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          disabled={locked && !s.liveSendingEnabled}
          maw={480}
        />
        <Switch
          label="Send real email"
          checked={s.liveSendingEnabled}
          disabled={(locked && !s.liveSendingEnabled) || reason.trim().length < 3 || toggle.isPending}
          onChange={(e) => toggle.mutate(e.currentTarget.checked)}
        />
        {toggle.isError && (
          <Alert color="red">{toggle.error instanceof ApiError ? toggle.error.message : 'Failed to save.'}</Alert>
        )}
      </Stack>
    </Card>
  );
}

const STATUSES = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED'];

function statusColor(status: string): string {
  if (status === 'BOUNCED' || status === 'FAILED') return 'red';
  if (status === 'COMPLAINED' || status === 'DELAYED') return 'orange';
  if (status === 'QUEUED' || status === 'SENDING') return 'gray';
  return 'green';
}

function EmailLogCard() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Omit<EmailLogFilters, 'cursor'>>({});
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const log = useInfiniteQuery({
    queryKey: ['email-log', filters],
    queryFn: ({ pageParam }) => api.listEmails({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const dispatch = useMutation({
    mutationFn: api.dispatchEmails,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-log'] }),
  });

  const rows = log.data?.pages.flatMap((p) => p.data) ?? [];
  const setFilter = (key: keyof EmailLogFilters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value || undefined }));

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Email log</Text>
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={() => dispatch.mutate()} loading={dispatch.isPending}>
              Send queued now
            </Button>
            <Button size="xs" variant="default" onClick={() => log.refetch()} loading={log.isFetching}>
              Refresh
            </Button>
          </Group>
        </Group>
        {dispatch.isSuccess && (
          <Text size="sm">
            {dispatch.data.sent} {dispatch.data.mode === 'simulated' ? 'simulated' : 'sent'},{' '}
            {dispatch.data.retrying} to retry, {dispatch.data.failed} failed
            {dispatch.data.heldByKillSwitch && '; receipt email held by the kill switch'}
            {dispatch.data.dailyLimitReached && '; daily limit reached'}.
          </Text>
        )}
        <Group align="flex-end" gap="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFilter('q', search.trim());
            }}
          >
            <TextInput
              label="Search"
              placeholder="Address, donor, or receipt number"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              w={280}
            />
          </form>
          <NativeSelect
            label="Status"
            data={[{ value: '', label: 'Any' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
            value={filters.status ?? ''}
            onChange={(e) => setFilter('status', e.currentTarget.value)}
          />
          <NativeSelect
            label="Kind"
            data={[
              { value: '', label: 'Any' },
              { value: 'RECEIPT', label: 'Receipt' },
              { value: 'PRECHECK', label: 'Pre-check' },
            ]}
            value={filters.purpose ?? ''}
            onChange={(e) => setFilter('purpose', e.currentTarget.value)}
          />
          <NativeSelect
            label="Sent for real?"
            data={[
              { value: '', label: 'Either' },
              { value: 'false', label: 'Real' },
              { value: 'true', label: 'Simulated' },
            ]}
            value={filters.simulated ?? ''}
            onChange={(e) => setFilter('simulated', e.currentTarget.value)}
          />
        </Group>

        {log.isLoading ? (
          <Loader />
        ) : log.isError ? (
          <Alert color="red">Failed to load the email log.</Alert>
        ) : rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No emails match.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Queued</Table.Th>
                <Table.Th>To</Table.Th>
                <Table.Th>What</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Sent</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((m) => (
                <Fragment key={m.id}>
                  <EmailLogRowView row={m} open={openId === m.id} onToggle={() => setOpenId(openId === m.id ? null : m.id)} />
                  {openId === m.id && (
                    <Table.Tr>
                      <Table.Td colSpan={5}>
                        <EmailDetailView id={m.id} />
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {log.hasNextPage && (
          <Group>
            <Button variant="default" size="xs" onClick={() => log.fetchNextPage()} loading={log.isFetchingNextPage}>
              Load more
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

function EmailLogRowView({ row: m, open, onToggle }: { row: EmailLogRow; open: boolean; onToggle: () => void }) {
  return (
    <Table.Tr onClick={onToggle} style={{ cursor: 'pointer' }} aria-expanded={open}>
      <Table.Td>{new Date(m.queuedAt).toLocaleString()}</Table.Td>
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
        <Group gap={4}>
          <Badge color={statusColor(m.status)}>{m.status}</Badge>
          {m.simulated && (
            <Badge color="gray" variant="outline">
              simulated
            </Badge>
          )}
        </Group>
        {m.statusDetail && (
          <Text size="xs" c="dimmed">
            {m.statusDetail}
          </Text>
        )}
      </Table.Td>
      <Table.Td>{m.sentAt ? new Date(m.sentAt).toLocaleString() : '—'}</Table.Td>
    </Table.Tr>
  );
}

function EmailDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['email', id], queryFn: () => api.getEmail(id) });
  const simulate = useMutation({
    mutationFn: (type: 'delivered' | 'bounced') => api.simulateEmailEvent(id, type),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['email', id] }),
        qc.invalidateQueries({ queryKey: ['email-log'] }),
      ]),
  });

  if (detail.isLoading) return <Loader size="sm" />;
  if (!detail.data) return <Alert color="red">Failed to load this email.</Alert>;
  const d = detail.data;

  return (
    <Stack gap="xs">
      <Group gap="xl">
        <Text size="xs" c="dimmed">
          Provider: {d.provider ?? '—'}
        </Text>
        <Text size="xs" c="dimmed">
          Message id: {d.providerMessageId ?? '—'}
        </Text>
        <Text size="xs" c="dimmed">
          Attempts: {d.attempts}
        </Text>
        {d.receiptId && (
          <Text component="a" href={api.receiptPdfUrl(d.receiptId)} target="_blank" rel="noreferrer" size="xs" c="blue">
            Attached receipt PDF
          </Text>
        )}
      </Group>
      <Code block>{d.textBody}</Code>
      {d.events.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Provider event</Table.Th>
              <Table.Th>When</Table.Th>
              <Table.Th>Detail</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.events.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>{e.type}</Table.Td>
                <Table.Td>{new Date(e.occurredAt).toLocaleString()}</Table.Td>
                <Table.Td>{e.detail ?? '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {d.simulated && d.providerMessageId && (
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            Simulate a provider report:
          </Text>
          <Button size="compact-xs" variant="light" onClick={() => simulate.mutate('delivered')} loading={simulate.isPending}>
            Delivered
          </Button>
          <Button
            size="compact-xs"
            variant="light"
            color="red"
            onClick={() => simulate.mutate('bounced')}
            loading={simulate.isPending}
          >
            Bounced
          </Button>
        </Group>
      )}
      {simulate.isError && <Alert color="red">{simulate.error.message}</Alert>}
    </Stack>
  );
}
