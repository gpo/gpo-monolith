import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api, type WorkItemRow } from '../api.js';

/**
 * Work queue (ticket 1.8, screens.md 5): the unified WorkItem screen, tabs
 * by kind. Each item shows subject, donor, rule; resolving requires a note,
 * exception requires a reason (both map to the same `reason` field — see
 * work-items/resolve.ts). A plain button group stands in for tabs (Mantine's
 * `Tabs` wasn't tried; the column-picker precedent from 1.3 favours the
 * simplest thing that can't hit the Floating-UI/jsdom issue documented
 * there).
 */

const TABS: Array<{ kind: WorkItemRow['kind']; label: string }> = [
  { kind: 'VALIDATION', label: 'Validation' },
  { kind: 'DIFF', label: 'Diff queue' },
  { kind: 'OWED_TO_EO', label: 'Owed to EO' },
  { kind: 'SYNC_INCIDENT', label: 'Sync incidents' },
];

function statusColor(status: string): string {
  if (status === 'OPEN') return 'orange';
  if (status === 'EXCEPTION') return 'yellow';
  return 'green';
}

function WorkItemRowView({ item }: { item: WorkItemRow }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<'RESOLVED' | 'EXCEPTION' | null>(null);
  const [reason, setReason] = useState('');

  const resolve = useMutation({
    mutationFn: (outcome: 'RESOLVED' | 'EXCEPTION') => api.resolveWorkItem(item.id, { reason, outcome }),
    onSuccess: () => {
      setAction(null);
      setReason('');
      return qc.invalidateQueries({ queryKey: ['work-items'] });
    },
  });

  return (
    <Table.Tr>
      <Table.Td>
        <Link to="/contributions/$id" params={{ id: item.subjectId }}>
          <Text span c="blue" size="sm">
            {item.subjectType}
          </Text>
        </Link>
      </Table.Td>
      <Table.Td>{item.contactName ?? '—'}</Table.Td>
      <Table.Td>{item.ruleRef ?? '—'}</Table.Td>
      <Table.Td>{new Date(item.openedAt).toLocaleDateString()}</Table.Td>
      <Table.Td>{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : '—'}</Table.Td>
      <Table.Td>
        <Badge color={statusColor(item.status)}>{item.status}</Badge>
      </Table.Td>
      <Table.Td>
        {item.status !== 'OPEN' ? (
          <Text size="xs" c="dimmed">
            {item.resolutionNote}
          </Text>
        ) : action ? (
          <Group gap="xs" wrap="nowrap">
            <TextInput
              size="xs"
              placeholder={action === 'RESOLVED' ? 'Resolution note' : 'Exception reason'}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            <Button
              size="xs"
              loading={resolve.isPending}
              disabled={reason.trim().length < 3}
              onClick={() => resolve.mutate(action)}
            >
              Confirm
            </Button>
            <Button size="xs" variant="subtle" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </Group>
        ) : (
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={() => setAction('RESOLVED')}>
              Resolve
            </Button>
            <Button size="xs" variant="light" color="yellow" onClick={() => setAction('EXCEPTION')}>
              Exception
            </Button>
          </Group>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

export function WorkQueuePage() {
  const [kind, setKind] = useState<WorkItemRow['kind']>('VALIDATION');

  const query = useQuery({
    queryKey: ['work-items', kind],
    queryFn: () => api.listWorkItems({ kind }),
  });

  return (
    <Stack gap="lg">
      <Title order={2}>Work queue</Title>

      <Group>
        {TABS.map((t) => (
          <Button
            key={t.kind}
            variant={kind === t.kind ? 'filled' : 'default'}
            onClick={() => setKind(t.kind)}
          >
            {t.label}
          </Button>
        ))}
      </Group>

      {query.isLoading ? (
        <Loader />
      ) : query.isError ? (
        <Text c="red">Failed to load the work queue.</Text>
      ) : query.data && query.data.data.length > 0 ? (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Subject</Table.Th>
              <Table.Th>Donor</Table.Th>
              <Table.Th>Rule</Table.Th>
              <Table.Th>Opened</Table.Th>
              <Table.Th>Due</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Resolution</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {query.data.data.map((item) => (
              <WorkItemRowView key={item.id} item={item} />
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text c="dimmed">Nothing in this queue.</Text>
      )}
    </Stack>
  );
}
