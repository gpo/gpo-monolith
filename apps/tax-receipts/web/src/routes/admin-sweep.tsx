import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { api } from '../api.js';

const labels = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  SUCCEEDED_WITH_WARNINGS: 'Succeeded with warnings',
  FAILED: 'Failed',
} as const;

export function SweepSection() {
  const navigate = useNavigate();
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const runId = new URLSearchParams(search).get('runId');
  const qc = useQueryClient();
  const run = useQuery({
    queryKey: ['sweep-run', runId],
    queryFn: () => api.sweepRun(runId!),
    enabled: !!runId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) =>
      query.state.data &&
      ['QUEUED', 'RUNNING'].includes(query.state.data.status)
        ? 60_000
        : false,
  });
  const create = useMutation({
    mutationFn: api.queuePartySweep,
    onSuccess: async (queued) => {
      qc.setQueryData(['sweep-run', queued.id], queued);
      await navigate({ to: '/admin/sweep', search: { runId: queued.id } });
    },
  });
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Qomon sweeps</Text>
          <Button
            size="xs"
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Queue party full sweep
          </Button>
        </Group>
        <Text size="sm">
          Scan all transactions in the party Qomon space. You can leave this
          page while the sweep runs.
        </Text>
        {create.isError && <Alert color="red">{create.error.message}</Alert>}
        {run.isError && (
          <Alert color="red">Could not load sweep: {run.error.message}</Alert>
        )}
        {runId && run.isLoading && <Loader />}
        {run.data && (
          <>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Target</Table.Th>
                  <Table.Th>Mode</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td>Party</Table.Td>
                  <Table.Td>
                    {run.data.mode === 'full' ? 'Full' : 'Incremental'}
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={
                        run.data.status === 'FAILED'
                          ? 'red'
                          : run.data.status === 'SUCCEEDED_WITH_WARNINGS'
                            ? 'yellow'
                            : 'gray'
                      }
                    >
                      {labels[run.data.status]}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
            <Text size="sm">Run: {run.data.id}</Text>
            {run.data.result && (
              <Stack gap="xs">
                <Text>Transactions processed: {run.data.result.pulled}</Text>
                <Text>New payments: {run.data.result.created}</Text>
                <Text>Changed in Qomon: {run.data.result.changedInQomon}</Text>
                <Text>Unchanged: {run.data.result.unchanged}</Text>
                <Text>Metadata backfilled: {run.data.result.backfilled}</Text>
                <Text>Deletion incidents: {run.data.result.syncIncidents}</Text>
                {run.data.result.contactFetchFailures.map((failure) => (
                  <Alert key={failure.qomonTransactionId} color="yellow">
                    Transaction {failure.qomonTransactionId}, contact{' '}
                    {failure.qomonContactId}: {failure.message}
                  </Alert>
                ))}
              </Stack>
            )}
            {run.data.error && <Alert color="red">{run.data.error}</Alert>}
          </>
        )}
      </Stack>
    </Card>
  );
}
