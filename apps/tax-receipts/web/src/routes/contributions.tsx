import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
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
 * Contributions list (ticket 1.3, screens.md 2): server-side filters,
 * saved filters, column picker. Bulk edit (ticket 1.4) and the detail
 * screen (ticket 1.5) are separate, later work — this is read-only.
 */

interface Column {
  key: string;
  label: string;
  render: (row: ContributionListRow) => React.ReactNode;
}

const COLUMNS: Column[] = [
  { key: 'acceptedAt', label: 'Date', render: (r) => new Date(r.acceptedAt).toLocaleDateString() },
  { key: 'donor', label: 'Donor', render: (r) => r.contactName },
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
  const [filters, setFilters] = useState<ContributionListFilters>({});
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => loadVisibleColumns());
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters());
  const [saveName, setSaveName] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulated, setAccumulated] = useState<ContributionListRow[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const query = useQuery({
    queryKey: ['contributions', filters, cursor],
    queryFn: () => api.listContributions({ ...filters, cursor }),
  });

  const rows = cursor ? [...accumulated, ...(query.data?.data ?? [])] : (query.data?.data ?? []);
  const columns = useMemo(() => COLUMNS.filter((c) => visibleColumns.has(c.key)), [visibleColumns]);

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

      {query.isLoading ? (
        <Loader />
      ) : query.isError ? (
        <Text c="red">Failed to load contributions.</Text>
      ) : (
        <>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                {columns.map((c) => (
                  <Table.Th key={c.key}>{c.label}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id}>
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
