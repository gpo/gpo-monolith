import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Tooltip,
} from '@mantine/core';
import { api, ApiError, type RtdDraftRow, type RtdFilingSummary } from '../api.js';

/**
 * RTD filings (ticket 2.8, screens.md screen 9): the filing table (every
 * `RtdFiling` with artifact and status) plus the draft builder (unreported
 * over-threshold rows with per-row business days remaining and gate-check
 * results), export format choice, and the stamp step.
 *
 * DC-1A generation is NOT built into this screen: screens.md's own wording
 * — "DC-1A amendments generate from owed-to-EO items and appear as linked
 * filings" — frames the trigger as coming from the owed-to-EO queue, which
 * nothing creates yet (ticket 2.4's header comment: that's the
 * correction-action flow, ticket 3.10, not built). This screen only shows
 * amendments as linked filings once one exists; the API route to generate
 * one (`POST /rtd/contributions/:id/dc1a`) is ready for whichever screen
 * ends up triggering it.
 */

function centsToDisplay(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DraftRowGate({ row }: { row: RtdDraftRow }) {
  if (row.gateFindings.length === 0) return null;
  return (
    <Tooltip label={`Blocked by ${row.gateFindings.map((f) => f.ruleRef).join(', ')} — resolve in the work queue first`}>
      <Badge color="red">{row.gateFindings.map((f) => f.ruleRef).join(', ')}</Badge>
    </Tooltip>
  );
}

function DueBadge({ row }: { row: RtdDraftRow }) {
  if (row.overdue) return <Badge color="red">Overdue</Badge>;
  if (row.businessDaysRemaining <= 5) return <Badge color="orange">{row.businessDaysRemaining}d left</Badge>;
  return <Badge color="gray">{row.businessDaysRemaining}d left</Badge>;
}

function DraftBuilder() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [year, setYear] = useState(new Date().getFullYear());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [format, setFormat] = useState<'CSV' | 'PIPE'>('CSV');
  const [error, setError] = useState<string | null>(null);

  const draft = useQuery({
    queryKey: ['rtd-draft', year],
    queryFn: () => api.getRtdDraft(year),
  });

  const selectableRows = useMemo(
    () => (draft.data?.rows ?? []).filter((r) => r.gateFindings.length === 0),
    [draft.data],
  );

  const stamp = useMutation({
    mutationFn: () => api.stampRtdFiling({ year, contributionIds: [...selected], reason, format }),
    onSuccess: () => {
      setError(null);
      setSelected(new Set());
      setReason('');
      void qc.invalidateQueries({ queryKey: ['rtd-draft', year] });
      return qc.invalidateQueries({ queryKey: ['rtd-filings'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to stamp the filing.'),
  });

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      selectableRows.length > 0 && selectableRows.every((r) => prev.has(r.contributionId))
        ? new Set()
        : new Set(selectableRows.map((r) => r.contributionId)),
    );
  }

  const canStamp = me.data?.can.stampRtdFilings ?? false;

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Draft builder</Text>
          <NumberInput label="Year" value={year} onChange={(v) => setYear(typeof v === 'number' ? v : year)} w={120} />
        </Group>

        {draft.isLoading ? (
          <Loader size="sm" />
        ) : draft.isError ? (
          <Text c="red">Failed to load the draft.</Text>
        ) : draft.data && draft.data.rows.length > 0 ? (
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>
                  <Checkbox
                    checked={selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.contributionId))}
                    onChange={toggleAll}
                    aria-label="Select all eligible rows"
                  />
                </Table.Th>
                <Table.Th>Contributor</Table.Th>
                <Table.Th>Deposit date</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Aggregate</Table.Th>
                <Table.Th>Due</Table.Th>
                <Table.Th>Gate</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {draft.data.rows.map((row) => (
                <Table.Tr key={row.contributionId}>
                  <Table.Td>
                    <Checkbox
                      checked={selected.has(row.contributionId)}
                      disabled={row.gateFindings.length > 0}
                      onChange={() => toggleRow(row.contributionId)}
                      aria-label={`Select ${row.contactFirstName} ${row.contactLastName}`}
                    />
                  </Table.Td>
                  <Table.Td>
                    {row.contactFirstName} {row.contactLastName}
                  </Table.Td>
                  <Table.Td>{new Date(row.acceptedAt).toLocaleDateString()}</Table.Td>
                  <Table.Td>{centsToDisplay(row.amountCents)}</Table.Td>
                  <Table.Td>{centsToDisplay(row.aggregateAfterCents)}</Table.Td>
                  <Table.Td>
                    <DueBadge row={row} />
                  </Table.Td>
                  <Table.Td>
                    <DraftRowGate row={row} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed">No unreported over-threshold deposits for {year}.</Text>
        )}

        {!canStamp && (
          <Alert color="yellow">Only the filer role (or a CFO designate) may stamp a new filing.</Alert>
        )}
        <Group align="flex-end">
          <NativeSelect
            label="Format"
            data={[
              { value: 'CSV', label: 'CSV' },
              { value: 'PIPE', label: 'Pipe-delimited (.txt)' },
            ]}
            value={format}
            onChange={(e) => setFormat(e.currentTarget.value as 'CSV' | 'PIPE')}
          />
          <TextInput
            label="Reason (required)"
            placeholder="e.g. period-end RTD filing"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button
            onClick={() => stamp.mutate()}
            loading={stamp.isPending}
            disabled={!canStamp || selected.size === 0 || reason.trim().length < 3}
          >
            Stamp filing ({selected.size} row{selected.size === 1 ? '' : 's'})
          </Button>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
      </Stack>
    </Card>
  );
}

function ArchiveControls({ filing }: { filing: RtdFilingSummary }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [cfoName, setCfoName] = useState('');
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archive = useMutation({
    mutationFn: () => api.archiveRtdFiling(filing.id, { cfoName, reason }),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      return qc.invalidateQueries({ queryKey: ['rtd-filings'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to archive the filing.'),
  });

  if (filing.artifactId) {
    return (
      <Text component="a" href={api.rtdFilingDownloadUrl(filing.id)} c="blue" size="sm">
        Download
      </Text>
    );
  }
  if (!(me.data?.can.fileRtdFilings ?? false)) {
    return (
      <Text c="dimmed" size="sm">
        Not yet archived
      </Text>
    );
  }
  if (!open) {
    return (
      <Button size="xs" variant="light" onClick={() => setOpen(true)}>
        Archive
      </Button>
    );
  }
  return (
    <Stack gap={4} miw={220}>
      <TextInput size="xs" placeholder="CFO name" value={cfoName} onChange={(e) => setCfoName(e.currentTarget.value)} />
      <TextInput size="xs" placeholder="Reason" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      <Group gap="xs">
        <Button
          size="xs"
          loading={archive.isPending}
          disabled={cfoName.trim().length === 0 || reason.trim().length < 3}
          onClick={() => archive.mutate()}
        >
          Confirm
        </Button>
        <Button size="xs" variant="subtle" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </Group>
      {error && (
        <Text c="red" size="xs">
          {error}
        </Text>
      )}
    </Stack>
  );
}

function FilingTable() {
  const filings = useQuery({ queryKey: ['rtd-filings'], queryFn: api.listRtdFilings });
  const byId = useMemo(() => new Map((filings.data?.data ?? []).map((f) => [f.id, f])), [filings.data]);

  if (filings.isLoading) return <Loader />;
  if (filings.isError) return <Text c="red">Failed to load RTD filings.</Text>;
  if (!filings.data || filings.data.data.length === 0) {
    return (
      <Card withBorder>
        <Text c="dimmed">No RTD filings yet.</Text>
      </Card>
    );
  }

  return (
    <Table striped withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>Kind</Table.Th>
          <Table.Th>Rows</Table.Th>
          <Table.Th>Generated</Table.Th>
          <Table.Th></Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {filings.data.data.map((filing) => (
          <Table.Tr key={filing.id}>
            <Table.Td>
              <Text size="sm">{filing.name}</Text>
              {filing.amendsFilingId && (
                <Text size="xs" c="dimmed">
                  amends {byId.get(filing.amendsFilingId)?.name ?? filing.amendsFilingId}
                </Text>
              )}
            </Table.Td>
            <Table.Td>
              <Badge color={filing.kind === 'DC1A_AMENDMENT' ? 'grape' : 'blue'}>
                {filing.kind === 'DC1A_AMENDMENT' ? 'DC-1A' : 'Initial'}
              </Badge>
            </Table.Td>
            <Table.Td>{filing.rowCount}</Table.Td>
            <Table.Td>{new Date(filing.generatedAt).toLocaleString()}</Table.Td>
            <Table.Td>
              <ArchiveControls filing={filing} />
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function RtdFilingsPage() {
  return (
    <Stack gap="lg">
      <Title order={2}>RTD filings</Title>
      <DraftBuilder />
      <FilingTable />
    </Stack>
  );
}
