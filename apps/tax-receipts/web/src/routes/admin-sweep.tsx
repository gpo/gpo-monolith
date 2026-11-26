import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  Navigate,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NativeSelect,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  api,
  type RidingRow,
  type SweepHistoryFilters,
  type SweepRun,
} from '../api.js';
import { PageHeader } from '../components/PageHeader.js';

const labels: Record<SweepRun['status'], string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  SUCCEEDED_WITH_WARNINGS: 'Succeeded with warnings',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  SKIPPED: 'Skipped',
};
const active = (run: SweepRun) => ['QUEUED', 'RUNNING'].includes(run.status);
const targetLabel = (run: SweepRun, ridings: RidingRow[]) => {
  if (run.target.kind === 'party') return 'Party';
  const number = run.target.ridingNumber;
  const riding = ridings.find((r) => r.ridingNumber === number);
  return riding ? `${riding.name} (Riding ${number})` : `Riding ${number}`;
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

function Status({ run }: { run: SweepRun }) {
  return (
    <Badge
      variant="light"
      color={
        run.status === 'FAILED'
          ? 'red'
          : run.status === 'SUCCEEDED_WITH_WARNINGS'
            ? 'yellow'
            : run.status === 'SUCCEEDED'
              ? 'green'
              : 'gray'
      }
    >
      {labels[run.status]}
    </Badge>
  );
}

function QueueSweepModal({
  ridings,
  onClose,
  onQueued,
}: {
  ridings: RidingRow[];
  onClose: () => void;
  onQueued: (run: SweepRun) => Promise<void>;
}) {
  const [mode, setMode] = useState<SweepRun['mode']>('incremental');
  const [target, setTarget] = useState('party');
  const create = useMutation({
    mutationFn: api.queueSweep,
    onSuccess: onQueued,
  });
  return (
    <Modal opened onClose={onClose} title="New sweep">
      <Stack gap="sm">
        <NativeSelect
          label="Mode"
          value={mode}
          onChange={(event) =>
            setMode(event.currentTarget.value as SweepRun['mode'])
          }
          data={[
            { value: 'incremental', label: 'Incremental' },
            { value: 'full', label: 'Full' },
          ]}
        />
        <NativeSelect
          label="Target"
          value={target}
          onChange={(event) => setTarget(event.currentTarget.value)}
          data={[
            { value: 'party', label: 'Party' },
            ...ridings
              .filter((r) => r.active && r.qomonApiKeySet)
              .map((r) => ({
                value: String(r.ridingNumber),
                label: `${r.ridingNumber} — ${r.name}`,
              })),
          ]}
        />
        <Text size="sm">
          Incremental imports changes since the last successful sweep. Full
          examines all transactions. You can leave this page while work runs.
        </Text>
        {create.isError && <Alert color="red">{create.error.message}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            onClick={() =>
              create.mutate({
                mode,
                target:
                  target === 'party'
                    ? { kind: 'party' }
                    : { kind: 'riding', ridingNumber: Number(target) },
              })
            }
          >
            Queue sweep
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RunDetails({ run, ridings }: { run: SweepRun; ridings: RidingRow[] }) {
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Sweep details</Text>
        <Text>Run: {run.id}</Text>
        <Group>
          <Status run={run} />
          <Text>{targetLabel(run, ridings)}</Text>
          <Text>{run.mode === 'full' ? 'Full' : 'Incremental'}</Text>
        </Group>
        <Text>
          Trigger: {run.triggerSource === 'MANUAL' ? 'Manual' : 'Scheduled'}
        </Text>
        <Text>Requester: {run.requestedByUserId ?? '—'}</Text>
        <Text>Queued: {date(run.queuedAt)}</Text>
        <Text>Started: {date(run.startedAt)}</Text>
        <Text>Completed: {date(run.completedAt)}</Text>
        <Text>
          Duration: {run.durationMs === null ? '—' : `${run.durationMs} ms`}
        </Text>
        <Text>Attempts: {run.attemptCount}</Text>
        {run.result && (
          <>
            <Text>Result mode: {run.result.mode}</Text>
            <Text>Transactions processed: {run.result.pulled}</Text>
            <Text>New payments: {run.result.created}</Text>
            <Text>Changed in Qomon: {run.result.changedInQomon}</Text>
            <Text>Unchanged: {run.result.unchanged}</Text>
            <Text>Metadata backfilled: {run.result.backfilled}</Text>
            <Text>Deletion incidents: {run.result.syncIncidents}</Text>
            <Text>Cursor: {JSON.stringify(run.result.cursor)}</Text>
            <Text>Has more: {run.result.hasMore ? 'Yes' : 'No'}</Text>
            {run.result.contactFetchFailures.map((failure) => (
              <Alert key={failure.qomonTransactionId} color="yellow">
                Transaction {failure.qomonTransactionId}, contact{' '}
                {failure.qomonContactId}: {failure.message}
              </Alert>
            ))}
          </>
        )}
        {run.error && (
          <Alert color={run.status === 'SKIPPED' ? 'yellow' : 'red'}>
            {run.error}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

export function SweepSection() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const location = useRouterState({ select: (s) => s.location });
  const runId = new URLSearchParams(location.searchStr).get('runId');
  if (!me.data?.can.manageSystem || location.pathname !== '/admin/sweep')
    return null;
  if (runId)
    return <Navigate to="/admin/sweep/$id" params={{ id: runId }} replace />;
  return <SweepContent />;
}

export function SweepDetailPage({ id }: { id: string }) {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  if (me.isLoading) return <Loader />;
  if (!me.data?.can.manageSystem) return <Navigate to="/admin/sweep" replace />;
  return <SweepDetailContent id={id} />;
}

function SweepDetailContent({ id }: { id: string }) {
  const ridings = useQuery({
    queryKey: ['admin-ridings'],
    queryFn: api.listRidings,
  });
  const run = useQuery({
    queryKey: ['sweep-run', id],
    queryFn: () => api.sweepRun(id),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) =>
      query.state.data && active(query.state.data) ? 60_000 : false,
  });
  return (
    <Stack gap="lg">
      <PageHeader
        title="Sweep details"
        backTo="/admin/sweep"
        backLabel="Back to sweeps"
      />
      {run.isLoading && <Loader />}
      {run.isError && (
        <Alert color="red">Could not load sweep: {run.error.message}</Alert>
      )}
      {run.data && (
        <RunDetails run={run.data} ridings={ridings.data?.data ?? []} />
      )}
    </Stack>
  );
}

function SweepContent() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState<SweepHistoryFilters>({});
  const [ridingFilter, setRidingFilter] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const ridings = useQuery({
    queryKey: ['admin-ridings'],
    queryFn: api.listRidings,
  });
  const history = useQuery({
    queryKey: ['sweep-history', filters, cursors.at(-1)],
    queryFn: () => api.sweepHistory({ ...filters, cursor: cursors.at(-1) }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) =>
      query.state.data?.data.some(active) ? 60_000 : false,
  });
  function filter(key: keyof SweepHistoryFilters, value: string) {
    setFilters((old) => ({ ...old, [key]: value || undefined }));
    setCursors([]);
  }
  return (
    <Stack gap="sm">
      <Card withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>Qomon sweeps</Text>
            <Button size="xs" onClick={() => setCreating(true)}>
              New sweep
            </Button>
          </Group>
          {ridings.isError && (
            <Alert color="red">
              Could not load riding targets: {ridings.error.message}
            </Alert>
          )}
          <Group align="flex-end">
            <NativeSelect
              label="Status filter"
              value={filters.status ?? ''}
              onChange={(e) => filter('status', e.currentTarget.value)}
              data={[
                { value: '', label: 'All statuses' },
                ...Object.entries(labels).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
            <NativeSelect
              label="Mode filter"
              value={filters.mode ?? ''}
              onChange={(e) => filter('mode', e.currentTarget.value)}
              data={[
                { value: '', label: 'All modes' },
                { value: 'incremental', label: 'Incremental' },
                { value: 'full', label: 'Full' },
              ]}
            />
            <NativeSelect
              label="Trigger filter"
              value={filters.triggerSource ?? ''}
              onChange={(e) => filter('triggerSource', e.currentTarget.value)}
              data={[
                { value: '', label: 'All triggers' },
                { value: 'MANUAL', label: 'Manual' },
                { value: 'SCHEDULED', label: 'Scheduled' },
              ]}
            />
            <NativeSelect
              label="Target filter"
              value={filters.target ?? ''}
              onChange={(e) => {
                setRidingFilter('');
                filter('target', e.currentTarget.value);
              }}
              data={[
                { value: '', label: 'All targets' },
                { value: 'party', label: 'Party' },
                ...(ridings.data?.data ?? []).map((r) => ({
                  value: `riding:${r.ridingNumber}`,
                  label: `${r.ridingNumber} — ${r.name}`,
                })),
                ...(filters.target?.startsWith('riding:') &&
                !(ridings.data?.data ?? []).some(
                  (r) => `riding:${r.ridingNumber}` === filters.target,
                )
                  ? [
                      {
                        value: filters.target,
                        label: `Riding ${filters.target.split(':')[1]}`,
                      },
                    ]
                  : []),
              ]}
            />
            <TextInput
              label="Riding number filter"
              description="Find a riding even if it is no longer configured"
              value={ridingFilter}
              inputMode="numeric"
              error={
                ridingFilter &&
                (!/^[1-9][0-9]*$/.test(ridingFilter) ||
                  Number(ridingFilter) > 2147483647)
                  ? 'Enter a positive riding number'
                  : undefined
              }
              onChange={(e) => {
                const value = e.currentTarget.value;
                setRidingFilter(value);
                if (
                  !value ||
                  (/^[1-9][0-9]*$/.test(value) && Number(value) <= 2147483647)
                )
                  filter('target', value ? `riding:${value}` : '');
              }}
            />
          </Group>
          {history.isError && (
            <Alert color="red">
              Could not load sweep history: {history.error.message}
            </Alert>
          )}
          {history.isLoading && <Loader />}
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Status</Table.Th>
                <Table.Th>Target</Table.Th>
                <Table.Th>Started</Table.Th>
                <Table.Th>Mode</Table.Th>
                <Table.Th>Trigger</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {history.data?.data.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Status run={row} />
                  </Table.Td>
                  <Table.Td>
                    {targetLabel(row, ridings.data?.data ?? [])}
                  </Table.Td>
                  <Table.Td>{date(row.startedAt)}</Table.Td>
                  <Table.Td>
                    {active(row)
                      ? '—'
                      : row.mode === 'full'
                        ? 'Full'
                        : 'Incremental'}
                  </Table.Td>
                  <Table.Td>
                    {active(row)
                      ? '—'
                      : row.triggerSource === 'MANUAL'
                        ? 'Manual'
                        : 'Scheduled'}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Button
                      size="xs"
                      variant="subtle"
                      renderRoot={(props) => (
                        <Link
                          {...props}
                          to="/admin/sweep/$id"
                          params={{ id: row.id }}
                        />
                      )}
                    >
                      Details
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {history.data?.data.length === 0 && (
            <Text c="dimmed">No sweep runs found.</Text>
          )}
          <Group justify="flex-end">
            <Button
              size="xs"
              variant="default"
              disabled={!cursors.length || history.isFetching}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Newer
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={!history.data?.nextCursor || history.isFetching}
              onClick={() =>
                setCursors((old) => [...old, history.data!.nextCursor!])
              }
            >
              Older
            </Button>
          </Group>
        </Stack>
      </Card>
      {creating && (
        <QueueSweepModal
          ridings={ridings.data?.data ?? []}
          onClose={() => setCreating(false)}
          onQueued={async (queued) => {
            qc.setQueryData(['sweep-run', queued.id], queued);
            setFilters({});
            setRidingFilter('');
            setCursors([]);
            await qc.invalidateQueries({ queryKey: ['sweep-history'] });
            setCreating(false);
            await navigate({
              to: '/admin/sweep/$id',
              params: { id: queued.id },
            });
          }}
        />
      )}
    </Stack>
  );
}
