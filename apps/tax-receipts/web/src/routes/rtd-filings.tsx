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
 * RTD filings (ticket 2.8, screens.md screen 9; reworked for the
 * prepare/send redesign): the filing table (every `RtdFiling` with artifact
 * and send status) plus the draft builder (unreported over-threshold rows
 * with per-row business days remaining and gate-check results), export
 * format choice, and the prepare step. A filing's send confirmation is a
 * separate action lower down the table — see `SendControls` — so nothing is
 * treated as "EO has seen this" until a human confirms it actually went
 * out.
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
  const [cfoName, setCfoName] = useState('');
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

  const prepare = useMutation({
    mutationFn: () => api.prepareRtdFiling({ year, contributionIds: [...selected], reason, cfoName, format }),
    onSuccess: () => {
      setError(null);
      setSelected(new Set());
      setReason('');
      void qc.invalidateQueries({ queryKey: ['rtd-draft', year] });
      return qc.invalidateQueries({ queryKey: ['rtd-filings'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to prepare the filing.'),
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

  const canPrepare = me.data?.can.prepareRtdFilings ?? false;

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

        {!canPrepare && (
          <Alert color="yellow">Only the filer role (or a CFO designate) may prepare a new filing.</Alert>
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
            label="CFO name (required)"
            placeholder="printed on the filing"
            value={cfoName}
            onChange={(e) => setCfoName(e.currentTarget.value)}
          />
          <TextInput
            label="Reason (required)"
            placeholder="e.g. period-end RTD filing"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button
            onClick={() => prepare.mutate()}
            loading={prepare.isPending}
            disabled={!canPrepare || selected.size === 0 || reason.trim().length < 3 || cfoName.trim().length === 0}
          >
            Prepare filing ({selected.size} row{selected.size === 1 ? '' : 's'})
          </Button>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
      </Stack>
    </Card>
  );
}

function SendControls({ filing }: { filing: RtdFilingSummary }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => api.sendRtdFiling(filing.id, { reason }),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      return qc.invalidateQueries({ queryKey: ['rtd-filings'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to mark the filing sent.'),
  });

  const download = filing.artifactId ? (
    <Text component="a" href={api.rtdFilingDownloadUrl(filing.id)} c="blue" size="sm">
      Download
    </Text>
  ) : null;

  if (filing.submittedAt) {
    return (
      <Stack gap={2}>
        {download}
        <Badge color="green" size="sm">
          Sent {new Date(filing.submittedAt).toLocaleDateString()}
        </Badge>
      </Stack>
    );
  }
  if (!(me.data?.can.sendRtdFilings ?? false)) {
    return (
      <Stack gap={2}>
        {download}
        <Text c="dimmed" size="xs">
          Not yet sent
        </Text>
      </Stack>
    );
  }
  if (!open) {
    return (
      <Stack gap={2}>
        {download}
        <Button size="xs" variant="light" onClick={() => setOpen(true)}>
          Send
        </Button>
      </Stack>
    );
  }
  return (
    <Stack gap={4} miw={220}>
      {download}
      <TextInput
        size="xs"
        placeholder="Reason (e.g. emailed to EO 2026-03-06)"
        value={reason}
        onChange={(e) => setReason(e.currentTarget.value)}
      />
      <Group gap="xs">
        <Button
          size="xs"
          loading={send.isPending}
          disabled={reason.trim().length < 3}
          onClick={() => send.mutate()}
        >
          Confirm sent
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
              <SendControls filing={filing} />
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
