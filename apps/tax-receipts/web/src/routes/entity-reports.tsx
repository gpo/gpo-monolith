import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Group,
  Loader,
  NativeSelect,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { api, ApiError, type EntityReportDrift, type EntityReportSummaryRow } from '../api.js';
import { PageHeader } from '../components/PageHeader.js';
import { defaultPoliticalEntityLabel } from './contribution-detail.js';

/**
 * Entity reports (ticket 4.5, screens.md screen 10), per space: generate
 * ALL/S2P2, see the REP4/REP6 export gate's result, and — the "dirty flag
 * with the diff view" screens.md asks for — exactly which rendered fields
 * changed since a report was generated (rule E5).
 *
 * Combined (all-entities) generation, the AR-1 attachments bundle, and
 * ReconciliationMark UI are out of scope here — see PHASE-4-NOTES.md.
 */

interface EntityReportsParams {
  periodId: number;
  entityKind: string;
  ridingNumber: number | null;
}

function spaceLabel({ periodId, ridingNumber, entityKind }: EntityReportsParams): string {
  return `Period ${periodId} · ${ridingNumber !== null ? `Riding ${ridingNumber}` : 'Party'} · ${entityKind}`;
}

function driftBadge(status: EntityReportDrift['status'] | null) {
  if (status === 'dirty') return <Badge color="orange">Dirty — changed since generated</Badge>;
  if (status === 'blocked') return <Badge color="red">Export gate blocked</Badge>;
  if (status === 'clean') return <Badge color="green">Clean</Badge>;
  return <Badge color="gray">Not checked</Badge>;
}

function ReportDiffPanel({ id }: { id: string }) {
  const detail = useQuery({ queryKey: ['entity-report', id], queryFn: () => api.getEntityReport(id) });

  if (detail.isLoading) return <Loader size="sm" mt="xs" />;
  if (detail.isError || !detail.data) return <Text c="red" size="sm">Failed to load the diff.</Text>;

  const { drift } = detail.data;
  if (drift.status === 'blocked') {
    return (
      <Alert color="red" mt="xs">
        This space no longer passes the REP4/REP6 export gate — re-check before relying on this report.
      </Alert>
    );
  }
  if (drift.status === 'not-checked') {
    return (
      <Text c="dimmed" size="sm" mt="xs">
        Combined reports aren't drift-checked yet.
      </Text>
    );
  }
  if (!drift.diff || (drift.diff.changed.length === 0 && drift.diff.added.length === 0)) {
    return (
      <Text c="dimmed" size="sm" mt="xs">
        Nothing has changed since this report was generated.
      </Text>
    );
  }

  return (
    <Stack gap="xs" mt="xs">
      {drift.diff.changed.length > 0 && (
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Row</Table.Th>
              <Table.Th>Field</Table.Th>
              <Table.Th>Was</Table.Th>
              <Table.Th>Now</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {drift.diff.changed.flatMap((c) =>
              c.fields.map((f) => (
                <Table.Tr key={`${c.key}:${f.field}`}>
                  <Table.Td>{c.key}</Table.Td>
                  <Table.Td>{f.field}</Table.Td>
                  <Table.Td>{f.before}</Table.Td>
                  <Table.Td>{f.after}</Table.Td>
                </Table.Tr>
              )),
            )}
          </Table.Tbody>
        </Table>
      )}
      {drift.diff.added.length > 0 && (
        <Text size="sm" c="dimmed">
          {drift.diff.added.length} row(s) now in scope that weren't included when this report was generated —
          regenerate to pick them up.
        </Text>
      )}
    </Stack>
  );
}

export function EntityReportsPage(params: EntityReportsParams) {
  const { periodId, entityKind, ridingNumber } = params;
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const reports = useQuery({
    queryKey: ['entity-reports', periodId],
    queryFn: () => api.listEntityReports(periodId),
    select: (page) =>
      page.data.filter((r) => r.ridingNumber === ridingNumber && r.entityKind === entityKind),
  });

  const [kind, setKind] = useState<'ALL' | 'S2P2'>('ALL');
  const [politicalEntityLabel, setPoliticalEntityLabel] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const effectiveLabel = (politicalEntityLabel ?? defaultPoliticalEntityLabel(entityKind)).trim();

  const generate = useMutation({
    mutationFn: () =>
      api.generateEntityReport(periodId, {
        kind,
        entityKind: entityKind as 'PARTY' | 'CA' | 'CAMPAIGN',
        ridingNumber,
        politicalEntityLabel: effectiveLabel,
        reason,
      }),
    onSuccess: () => {
      setGenError(null);
      setReason('');
      return qc.invalidateQueries({ queryKey: ['entity-reports', periodId] });
    },
    onError: (err) => {
      setGenError(err instanceof ApiError ? err.message : 'Failed to generate the report.');
    },
  });

  const markSent = useMutation({
    mutationFn: (id: string) => api.markEntityReportSentToCfo(id, 'sent to CFO from the entity reports screen'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entity-reports', periodId] }),
  });

  const canGenerate = me.data?.can.generateEntityReports ?? false;
  const canShare = me.data?.can.shareEntityReports ?? false;

  return (
    <Stack gap="lg">
      <PageHeader title="Entity reports" backTo="/" backLabel="Back to spaces" />
      <Text c="dimmed">{spaceLabel(params)}</Text>

      <Card withBorder>
        <Stack gap="sm" maw={480}>
          <Text fw={600}>Generate a report</Text>
          {!canGenerate && (
            <Alert color="yellow">Only the party CFO, a designate, bookkeeper, or filer may generate reports.</Alert>
          )}
          <NativeSelect
            label="Report"
            data={[
              { value: 'ALL', label: 'ALL (annual contribution roster)' },
              { value: 'S2P2', label: 'S2P2 (over-$200 contributor aggregate)' },
            ]}
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as 'ALL' | 'S2P2')}
          />
          <TextInput
            label="Political entity label (as it should print on the file)"
            placeholder="e.g. Green Party of Ontario"
            value={politicalEntityLabel ?? defaultPoliticalEntityLabel(entityKind)}
            onChange={(e) => setPoliticalEntityLabel(e.currentTarget.value)}
          />
          <TextInput
            label="Reason for generating (required)"
            placeholder="e.g. period-end filing"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          {genError && <Alert color="red">{genError}</Alert>}
          <Group>
            <Button
              onClick={() => generate.mutate()}
              loading={generate.isPending}
              disabled={!canGenerate || reason.trim().length < 3 || effectiveLabel.length === 0}
            >
              Generate
            </Button>
          </Group>
        </Stack>
      </Card>

      {reports.isLoading ? (
        <Loader />
      ) : reports.isError ? (
        <Text c="red">Failed to load reports for this space.</Text>
      ) : reports.data && reports.data.length > 0 ? (
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Kind</Table.Th>
              <Table.Th>Generated</Table.Th>
              <Table.Th>Rows</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Sent to CFO</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {reports.data.map((row: EntityReportSummaryRow) => (
              <Fragment key={row.id}>
                <Table.Tr>
                  <Table.Td>{row.kind}</Table.Td>
                  <Table.Td>{new Date(row.generatedAt).toLocaleString()}</Table.Td>
                  <Table.Td>{row.rowCount}</Table.Td>
                  <Table.Td>{driftBadge(row.dirty === null ? null : row.dirty ? 'dirty' : 'clean')}</Table.Td>
                  <Table.Td>
                    {row.sentToCfoAt ? (
                      <Badge color="green">{new Date(row.sentToCfoAt).toLocaleDateString()}</Badge>
                    ) : canShare ? (
                      <Button size="xs" variant="light" loading={markSent.isPending} onClick={() => markSent.mutate(row.id)}>
                        Mark sent
                      </Button>
                    ) : (
                      <Badge color="gray">Not sent</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Text
                        component="a"
                        href={api.entityReportCsvUrl(row.id)}
                        c="blue"
                        size="sm"
                      >
                        Download CSV
                      </Text>
                      <Text
                        span
                        c="blue"
                        size="sm"
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                      >
                        {expandedId === row.id ? 'Hide changes' : 'View changes'}
                      </Text>
                    </Group>
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td colSpan={6} style={{ padding: expandedId === row.id ? undefined : 0, border: expandedId === row.id ? undefined : 'none' }}>
                    <Collapse in={expandedId === row.id}>
                      {expandedId === row.id && <ReportDiffPanel id={row.id} />}
                    </Collapse>
                  </Table.Td>
                </Table.Tr>
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Card withBorder>
          <Text c="dimmed">No reports generated yet for this space.</Text>
        </Card>
      )}
    </Stack>
  );
}
