import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Card, Group, NativeSelect, Stack, Table, Text, Title } from '@mantine/core';
import { ApiError, api, type SweepResult } from '../api.js';

/**
 * Dev-only convenience page (never routed/linked outside `import.meta.env.DEV`,
 * see router.tsx). A thin wrapper over sysadmin-only endpoints — it adds no
 * privilege of its own, the server still enforces the sysadmin check.
 */
export function DevToolsPage() {
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental');
  const sweep = useMutation({ mutationFn: () => api.syncSweep(mode) });

  const notConfigured = sweep.error instanceof ApiError && sweep.error.status === 404;

  return (
    <Stack gap="lg">
      <Title order={2}>Dev tools</Title>
      <Card withBorder>
        <Stack gap="sm">
          <Text fw={600}>Qomon mirror sweep</Text>
          <Text size="sm" c="dimmed">
            Manually triggers POST /internal/sync/sweep (sysadmin only, ticket 1.1). No
            cron exists yet, so this is the only way to pull new spaces in locally.
          </Text>
          <Group grow maw={300}>
            <NativeSelect
              label="Mode"
              data={['incremental', 'full']}
              value={mode}
              onChange={(e) => setMode(e.currentTarget.value as 'incremental' | 'full')}
            />
          </Group>
          <Group>
            <Button onClick={() => sweep.mutate()} loading={sweep.isPending}>
              Run sweep
            </Button>
          </Group>
          {notConfigured && (
            <Alert color="yellow">
              404 — no Qomon client is configured on the API. Set QOMON_API_KEY (and
              QOMON_API_BASE) in apps/tax-receipts/api/.env and restart the API.
            </Alert>
          )}
          {sweep.isError && !notConfigured && (
            <Alert color="red">{sweep.error.message}</Alert>
          )}
          {sweep.isSuccess && <SweepSummary result={sweep.data} />}
        </Stack>
      </Card>
    </Stack>
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
