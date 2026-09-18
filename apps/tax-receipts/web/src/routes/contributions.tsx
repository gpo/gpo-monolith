import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
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
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api, type ContributionListFilters, type ContributionListRow } from '../api.js';

/**
 * Contributions list (ticket 1.3, screens.md 2) with bulk edit (ticket 1.4,
 * PRD C2): server-side filters, saved filters, column picker, row
 * selection, and a bulk-action bar. The detail screen (ticket 1.5) is
 * linked from each donor cell.
 *
 * The bulk-edit bar exposes one field change at a time — the common cases
 * (PRD C2's "reassigning periods for an election window is one operation")
 * — not every field `POST /contributions/bulk-edit` accepts (goodsServices,
 * processedDate, eoContributorId, exceptionReason, externalRef are edge
 * cases better done per-row on the detail screen).
 */

type BulkField = 'periodId' | 'ridingNumber' | 'entityKind' | 'receivedBy' | 'nonDeductibleCents' | 'sourceCode';

const BULK_FIELDS: Array<{ value: BulkField; label: string }> = [
  { value: 'periodId', label: 'Period id' },
  { value: 'ridingNumber', label: 'Riding number' },
  { value: 'entityKind', label: 'Entity kind' },
  { value: 'receivedBy', label: 'Received by' },
  { value: 'nonDeductibleCents', label: 'Non-deductible ($)' },
  { value: 'sourceCode', label: 'Source code' },
];

interface Column {
  key: string;
  label: string;
  render: (row: ContributionListRow) => React.ReactNode;
}

const COLUMNS: Column[] = [
  { key: 'acceptedAt', label: 'Date', render: (r) => new Date(r.acceptedAt).toLocaleDateString() },
  {
    key: 'donor',
    label: 'Donor',
    render: (r) => (
      <Link to="/contributions/$id" params={{ id: r.id }}>
        <Text span c="blue">
          {r.contactName}
        </Text>
      </Link>
    ),
  },
  {
    key: 'amount',
    label: 'Amount',
    render: (r) => `$${(r.amountCents / 100).toFixed(2)}`,
  },
  { key: 'period', label: 'Period', render: (r) => r.periodId ?? '—' },
  { key: 'riding', label: 'Riding', render: (r) => r.ridingNumber ?? 'Party' },
  { key: 'entityKind', label: 'Entity', render: (r) => r.entityKind ?? '—' },
  { key: 'receivedBy', label: 'Received by', render: (r) => r.receivedBy ?? '—' },
  { key: 'sourceCode', label: 'Source code', render: (r) => r.sourceCode || '—' },
  {
    key: 'nonDeductible',
    label: 'Non-deductible',
    render: (r) => (r.nonDeductibleCents ? `$${(r.nonDeductibleCents / 100).toFixed(2)}` : '—'),
  },
  {
    key: 'receipt',
    label: 'Receipt',
    render: (r) => <Badge color={r.hasReceipt ? 'green' : 'gray'}>{r.hasReceipt ? 'issued' : 'none'}</Badge>,
  },
  {
    key: 'validation',
    label: 'Open flags',
    render: (r) =>
      r.openValidationCount > 0 ? (
        <Badge color="orange">{r.openValidationCount}</Badge>
      ) : (
        <Badge color="green">clear</Badge>
      ),
  },
];

const DEFAULT_VISIBLE = new Set(COLUMNS.map((c) => c.key));
const COLUMN_STORAGE_KEY = 'tax-receipts:contributions-list:columns';
const SAVED_FILTERS_STORAGE_KEY = 'tax-receipts:contributions-list:saved-filters';

function loadVisibleColumns(): Set<string> {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.filter((k) => COLUMNS.some((c) => c.key === k)));
  } catch {
    return DEFAULT_VISIBLE;
  }
}

interface SavedFilter {
  name: string;
  filters: ContributionListFilters;
}

function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(SAVED_FILTERS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedFilter[]) : [];
  } catch {
    return [];
  }
}

function persistSavedFilters(filters: SavedFilter[]): void {
  try {
    localStorage.setItem(SAVED_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // best-effort only (private browsing, storage disabled, etc.)
  }
}

export function ContributionsListPage() {
  const qc = useQueryClient();
  // drill-in from the space dashboard (ticket 1.10) arrives as search params
  const search = useSearch({ strict: false }) as Partial<ContributionListFilters>;
  const [filters, setFilters] = useState<ContributionListFilters>(() => ({
    ...(search.periodId !== undefined ? { periodId: Number(search.periodId) } : {}),
    ...(search.ridingNumber !== undefined ? { ridingNumber: Number(search.ridingNumber) } : {}),
    ...(search.partyLevelOnly ? { partyLevelOnly: true } : {}),
    ...(search.entityKind ? { entityKind: search.entityKind } : {}),
  }));
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => loadVisibleColumns());
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters());
  const [saveName, setSaveName] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<ContributionListRow[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkField | ''>('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkPartyLevel, setBulkPartyLevel] = useState(false);
  const [bulkReason, setBulkReason] = useState('');

  const query = useQuery({
    queryKey: ['contributions', filters, cursor],
    queryFn: () => api.listContributions({ ...filters, cursor }),
  });

  const rows = cursor ? [...accumulated, ...(query.data?.data ?? [])] : (query.data?.data ?? []);
  const columns = useMemo(() => COLUMNS.filter((c) => visibleColumns.has(c.key)), [visibleColumns]);

  const bulkEdit = useMutation({
    mutationFn: () => {
      const changes: Record<string, unknown> =
        bulkField === 'ridingNumber'
          ? { ridingNumber: bulkPartyLevel ? null : Number(bulkValue) }
          : bulkField === 'periodId' || bulkField === 'nonDeductibleCents'
            ? { [bulkField]: bulkField === 'nonDeductibleCents' ? Math.round(Number(bulkValue) * 100) : Number(bulkValue) }
            : { [bulkField as string]: bulkValue };
      return api.bulkEditContributions({
        contributionIds: [...selected],
        reason: bulkReason,
        changes,
      });
    },
    onSuccess: (result) => {
      setSelected(new Set(result.results.filter((r) => !r.ok).map((r) => r.contributionId)));
      return qc.invalidateQueries({ queryKey: ['contributions'] });
    },
  });

  function updateFilter<K extends keyof ContributionListFilters>(key: K, value: ContributionListFilters[K]) {
    setCursor(undefined);
    setAccumulated([]);
    setFilters((f) => {
      const next = { ...f };
      if (value === undefined || value === ('' as never)) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function loadMore() {
    if (query.data) setAccumulated(rows);
    setCursor(query.data?.nextCursor ?? undefined);
  }

  function toggleColumn(key: string) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort
      }
      return next;
    });
  }

  function saveCurrentFilter() {
    if (!saveName.trim()) return;
    const next = [...savedFilters.filter((f) => f.name !== saveName), { name: saveName, filters }];
    setSavedFilters(next);
    persistSavedFilters(next);
    setSaveName('');
  }

  function applySavedFilter(name: string | null) {
    const found = savedFilters.find((f) => f.name === name);
    if (!found) return;
    setCursor(undefined);
    setAccumulated([]);
    setFilters(found.filters);
  }

  function removeSavedFilter(name: string) {
    const next = savedFilters.filter((f) => f.name !== name);
    setSavedFilters(next);
    persistSavedFilters(next);
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const allSelected = rows.length > 0 && rows.every((r) => prev.has(r.id));
      return allSelected ? new Set() : new Set(rows.map((r) => r.id));
    });
  }

  return (
    <Stack gap="lg">
      <Title order={2}>Contributions</Title>

      <Card withBorder>
        <Stack gap="sm">
          <Group grow>
            <TextInput
              label="Donor (name or email)"
              placeholder="dana@example.org"
              value={filters.contactQuery ?? ''}
              onChange={(e) => updateFilter('contactQuery', e.currentTarget.value || undefined)}
            />
            <NumberInput
              label="Period id"
              value={filters.periodId}
              onChange={(v) => updateFilter('periodId', typeof v === 'number' ? v : undefined)}
            />
            <NumberInput
              label="Riding number"
              min={1}
              max={124}
              disabled={filters.partyLevelOnly}
              value={filters.ridingNumber}
              onChange={(v) => updateFilter('ridingNumber', typeof v === 'number' ? v : undefined)}
            />
            <NativeSelect
              label="Entity kind"
              data={['', 'PARTY', 'CA', 'CAMPAIGN']}
              value={filters.entityKind ?? ''}
              onChange={(e) => updateFilter('entityKind', e.currentTarget.value || undefined)}
            />
          </Group>
          <Group grow align="flex-end">
            <NumberInput
              label="Min amount ($)"
              value={filters.minAmountCents !== undefined ? filters.minAmountCents / 100 : undefined}
              onChange={(v) => updateFilter('minAmountCents', typeof v === 'number' ? Math.round(v * 100) : undefined)}
            />
            <NumberInput
              label="Max amount ($)"
              value={filters.maxAmountCents !== undefined ? filters.maxAmountCents / 100 : undefined}
              onChange={(v) => updateFilter('maxAmountCents', typeof v === 'number' ? Math.round(v * 100) : undefined)}
            />
            <TextInput
              type="date"
              label="Accepted from"
              value={filters.acceptedFrom ?? ''}
              onChange={(e) => updateFilter('acceptedFrom', e.currentTarget.value || undefined)}
            />
            <TextInput
              type="date"
              label="Accepted to"
              value={filters.acceptedTo ?? ''}
              onChange={(e) => updateFilter('acceptedTo', e.currentTarget.value || undefined)}
            />
          </Group>
          <Group>
            <Checkbox
              label="Party-level only"
              checked={filters.partyLevelOnly ?? false}
              onChange={(e) => updateFilter('partyLevelOnly', e.currentTarget.checked || undefined)}
            />
            <Checkbox
              label="Has open validation findings"
              checked={filters.hasOpenValidation ?? false}
              onChange={(e) => updateFilter('hasOpenValidation', e.currentTarget.checked || undefined)}
            />
            <Checkbox
              label="Has an issued receipt"
              checked={filters.hasReceipt ?? false}
              onChange={(e) => updateFilter('hasReceipt', e.currentTarget.checked || undefined)}
            />
          </Group>
        </Stack>
      </Card>

      <Group justify="space-between">
        <Group>
          <TextInput
            placeholder="Save filter as…"
            value={saveName}
            onChange={(e) => setSaveName(e.currentTarget.value)}
            w={200}
          />
          <Button variant="light" onClick={saveCurrentFilter} disabled={!saveName.trim()}>
            Save current filters
          </Button>
          {savedFilters.length > 0 && (
            <NativeSelect
              aria-label="Load a saved filter"
              data={['', ...savedFilters.map((f) => f.name)]}
              onChange={(e) => applySavedFilter(e.currentTarget.value || null)}
              w={220}
            />
          )}
          {savedFilters.map((f) => (
            <Badge
              key={f.name}
              variant="outline"
              style={{ cursor: 'pointer' }}
              rightSection={
                <Text
                  span
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSavedFilter(f.name);
                  }}
                >
                  ×
                </Text>
              }
              onClick={() => applySavedFilter(f.name)}
            >
              {f.name}
            </Badge>
          ))}
        </Group>

        <Button variant="default" onClick={() => setColumnsOpen((v) => !v)}>
          Columns
        </Button>
      </Group>

      {columnsOpen && (
        <Paper withBorder p="sm">
          <Group>
            {COLUMNS.map((c) => (
              <Checkbox
                key={c.key}
                label={c.label}
                checked={visibleColumns.has(c.key)}
                onChange={() => toggleColumn(c.key)}
              />
            ))}
          </Group>
        </Paper>
      )}

      {(selected.size > 0 || bulkEdit.data) && (
        <Paper withBorder p="sm">
          <Stack gap="xs">
            {selected.size > 0 && <Text fw={600}>{selected.size} selected</Text>}
            {selected.size > 0 && (
              <>
                <Group grow>
                  <NativeSelect
                    label="Field to change"
                    data={['', ...BULK_FIELDS.map((f) => f.label)]}
                    value={BULK_FIELDS.find((f) => f.value === bulkField)?.label ?? ''}
                    onChange={(e) => {
                      const found = BULK_FIELDS.find((f) => f.label === e.currentTarget.value);
                      setBulkField(found?.value ?? '');
                      setBulkValue('');
                    }}
                  />
                  {bulkField === 'ridingNumber' ? (
                    <Group>
                      <Checkbox
                        label="Party-level (no riding)"
                        checked={bulkPartyLevel}
                        onChange={(e) => setBulkPartyLevel(e.currentTarget.checked)}
                      />
                      {!bulkPartyLevel && (
                        <NumberInput
                          label="New riding number"
                          min={1}
                          max={124}
                          value={bulkValue}
                          onChange={(v) => setBulkValue(String(v ?? ''))}
                        />
                      )}
                    </Group>
                  ) : bulkField === 'entityKind' ? (
                    <NativeSelect
                      label="New entity kind"
                      data={['', 'PARTY', 'CA', 'CAMPAIGN']}
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.currentTarget.value)}
                    />
                  ) : bulkField === 'receivedBy' ? (
                    <NativeSelect
                      label="New received by"
                      data={['', 'GPO', 'ENTITY']}
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.currentTarget.value)}
                    />
                  ) : bulkField === 'periodId' || bulkField === 'nonDeductibleCents' ? (
                    <NumberInput
                      label="New value"
                      value={bulkValue}
                      onChange={(v) => setBulkValue(String(v ?? ''))}
                    />
                  ) : bulkField === 'sourceCode' ? (
                    <TextInput label="New value" value={bulkValue} onChange={(e) => setBulkValue(e.currentTarget.value)} />
                  ) : (
                    <div />
                  )}
                  <TextInput
                    label="Reason (required)"
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.currentTarget.value)}
                  />
                </Group>
                <Group>
                  <Button
                    onClick={() => bulkEdit.mutate()}
                    loading={bulkEdit.isPending}
                    disabled={!bulkField || (!bulkValue && !bulkPartyLevel) || bulkReason.trim().length < 3}
                  >
                    Apply to {selected.size} row{selected.size === 1 ? '' : 's'}
                  </Button>
                  <Button variant="subtle" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </Button>
                </Group>
              </>
            )}
            {bulkEdit.data && (
              <Alert color={bulkEdit.data.failed > 0 ? 'orange' : 'green'}>
                {bulkEdit.data.succeeded} succeeded, {bulkEdit.data.failed} failed.
                {bulkEdit.data.failed > 0 && ' Failed rows stay selected below.'}
                {selected.size === 0 && (
                  <Button size="xs" variant="subtle" ml="sm" onClick={() => bulkEdit.reset()}>
                    Dismiss
                  </Button>
                )}
              </Alert>
            )}
          </Stack>
        </Paper>
      )}

      {query.isLoading ? (
        <Loader />
      ) : query.isError ? (
        <Text c="red">Failed to load contributions.</Text>
      ) : (
        <>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>
                  <Checkbox
                    aria-label="Select all"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={toggleAllVisible}
                  />
                </Table.Th>
                {columns.map((c) => (
                  <Table.Th key={c.key}>{c.label}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    <Checkbox
                      aria-label={`Select ${row.contactName}`}
                      checked={selected.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                    />
                  </Table.Td>
                  {columns.map((c) => (
                    <Table.Td key={c.key}>{c.render(row)}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rows.length === 0 && (
            <Text c="dimmed" ta="center">
              No contributions match these filters.
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
