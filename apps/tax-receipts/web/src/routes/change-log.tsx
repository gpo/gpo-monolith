import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Anchor,
  Button,
  Card,
  Group,
  Loader,
  NativeSelect,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api, type ChangeLogFilters, type ChangeLogRow } from '../api.js';

/**
 * Change-log explorer (ticket 1.11, screens.md 12): the audit surface
 * underpinning guarantee G4, part of the EO virtual-evaluation demo script.
 * Filter by subject, actor, correlation id, date; every entry shows
 * before/after and reason; exportable as CSV.
 */

const SUBJECT_TYPES = [
  '',
  'Contribution',
  'ContributionMetadata',
  'Contact',
  'AddressSnapshot',
  'Receipt',
  'ReceiptAllocation',
  'RtdFiling',
  'RtdInclusion',
  'EntityReport',
  'EOForm',
  'WorkItem',
  'Period',
  'ContributionLimit',
  'DonorCyclePreference',
  'SpaceState',
  'ReconciliationMark',
  'User',
  'IssuanceKillSwitch',
];

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const s = JSON.stringify(value);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

export function ChangeLogPage() {
  const [filters, setFilters] = useState<ChangeLogFilters>({});
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<ChangeLogRow[]>([]);

  const query = useQuery({
    queryKey: ['change-log', filters, cursor],
    queryFn: () => api.listChangeLog({ ...filters, cursor }),
  });
  const rows = cursor ? [...accumulated, ...(query.data?.data ?? [])] : (query.data?.data ?? []);

  function updateFilter<K extends keyof ChangeLogFilters>(key: K, value: ChangeLogFilters[K]) {
    setCursor(undefined);
    setAccumulated([]);
    setFilters((f) => {
      const next = { ...f };
      if (!value) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function loadMore() {
    if (query.data) setAccumulated(rows);
    setCursor(query.data?.nextCursor ?? undefined);
  }

  return (
    <Stack gap="lg">
      <Title order={2}>Change-log explorer</Title>

      <Card withBorder>
        <Group grow>
          <NativeSelect
            label="Subject type"
            data={SUBJECT_TYPES}
            value={filters.subjectType ?? ''}
            onChange={(e) => updateFilter('subjectType', e.currentTarget.value || undefined)}
          />
          <TextInput
            label="Subject id"
            value={filters.subjectId ?? ''}
            onChange={(e) => updateFilter('subjectId', e.currentTarget.value || undefined)}
          />
          <TextInput
            label="Actor user id"
            value={filters.actorUserId ?? ''}
            onChange={(e) => updateFilter('actorUserId', e.currentTarget.value || undefined)}
          />
          <TextInput
            label="Correlation id"
            value={filters.correlationId ?? ''}
            onChange={(e) => updateFilter('correlationId', e.currentTarget.value || undefined)}
          />
        </Group>
        <Group grow mt="sm">
          <TextInput
            type="date"
            label="From"
            value={filters.dateFrom ?? ''}
            onChange={(e) => updateFilter('dateFrom', e.currentTarget.value || undefined)}
          />
          <TextInput
            type="date"
            label="To"
            value={filters.dateTo ?? ''}
            onChange={(e) => updateFilter('dateTo', e.currentTarget.value || undefined)}
          />
        </Group>
      </Card>

      <Group>
        <Anchor href={api.changeLogExportUrl(filters)} target="_blank" rel="noreferrer">
          <Button variant="light">Export CSV (for EO)</Button>
        </Anchor>
      </Group>

      {query.isLoading ? (
        <Loader />
      ) : query.isError ? (
        <Text c="red">Failed to load the change-log.</Text>
      ) : (
        <>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>At</Table.Th>
                <Table.Th>Subject</Table.Th>
                <Table.Th>Actor</Table.Th>
                <Table.Th>Reason</Table.Th>
                <Table.Th>Before</Table.Th>
                <Table.Th>After</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>{new Date(e.at).toLocaleString()}</Table.Td>
                  <Table.Td>
                    {e.subjectType} ({e.subjectId})
                  </Table.Td>
                  <Table.Td>{e.actorName ?? 'System'}</Table.Td>
                  <Table.Td>{e.reason}</Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {jsonCell(e.before)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {jsonCell(e.after)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rows.length === 0 && (
            <Text c="dimmed" ta="center">
              No change-log entries match these filters.
            </Text>
          )}
          {query.data?.nextCursor && (
            <Group justify="center">
              <Button variant="light" onClick={loadMore} loading={query.isFetching}>
                Load more
              </Button>
            </Group>
          )}
        </>
      )}
    </Stack>
  );
}
