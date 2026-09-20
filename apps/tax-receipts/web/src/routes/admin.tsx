import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FileButton,
  Group,
  Loader,
  Modal,
  NativeSelect,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
// Imported from the validation/rules.js subpath, not the package barrel
// ('@gpo/tax-receipts-core') — the barrel re-exports metadata.ts, whose
// node:crypto usage Vite can't tree-shake out of a browser build (see
// rule-labels.ts's doc comment). validation/rules.js's own dependency
// chain has no node:crypto import, so this subpath is browser-safe.
import { IMPLEMENTED_RULE_REFS } from '@gpo/tax-receipts-core/validation/rules.js';
import { api, type RidingImportRow, type RidingRow } from '../api.js';
import { ChangeLogPage } from './change-log.js';
import { DevToolsPage } from './dev-tools.js';
import { RULE_LABELS } from '../rule-labels.js';

/**
 * Annual settings and admin (ticket 1.12, screens.md 11): periods,
 * ContributionLimit buckets, users/roles, the RTD holiday calendar,
 * per-riding Qomon spaces, and the kill switch. All writes are sysadmin-only
 * server-side; a 403 here just means "ask a sysadmin."
 *
 * The "Validation rules" section is a read-only reference (no writes, no
 * fetch) — see ValidationRulesSection's own doc comment below.
 *
 * Not built: the receipt letter template (Phase 3, no template system
 * exists) and RTD "CFO name" / sign-off threshold (no schema field or spec
 * value for either — see api/src/routes/admin.ts).
 */

/**
 * Each admin section lives at its own path under /admin (e.g. /admin/ridings)
 * rather than behind in-page tab state, so a section can be linked to or
 * reloaded directly. router.tsx builds the child routes from this array;
 * AdminLayout below builds the nav from it too, so a new section only needs
 * an entry here. `devOnly` sections (Dev tools) are kept out of both in
 * production — see visibleAdminSections below.
 */
export const ADMIN_SECTIONS = [
  { slug: 'periods', label: 'Periods', component: () => <PeriodsSection />, devOnly: false },
  { slug: 'contribution-limits', label: 'Contribution limits', component: () => <ContributionLimitsSection />, devOnly: false },
  { slug: 'rtd-holidays', label: 'RTD holidays', component: () => <HolidaysSection />, devOnly: false },
  { slug: 'ridings', label: 'Ridings', component: () => <RidingsSection />, devOnly: false },
  { slug: 'users', label: 'Users', component: () => <UsersSection />, devOnly: false },
  { slug: 'kill-switch', label: 'Kill switch', component: () => <KillSwitchSection />, devOnly: false },
  { slug: 'validation-rules', label: 'Validation rules', component: () => <ValidationRulesSection />, devOnly: false },
  { slug: 'change-log', label: 'Change log', component: () => <ChangeLogPage />, devOnly: false },
  { slug: 'dev-tools', label: 'Dev tools', component: () => <DevToolsPage />, devOnly: true },
] as const satisfies ReadonlyArray<{ slug: string; label: string; component: () => JSX.Element; devOnly: boolean }>;

/** Sections actually shown/routed: devOnly ones only outside production. */
export const visibleAdminSections = ADMIN_SECTIONS.filter((s) => !s.devOnly || import.meta.env.DEV);

function KillSwitchSection() {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const status = useQuery({ queryKey: ['kill-switch'], queryFn: api.killSwitch });
  const toggle = useMutation({
    mutationFn: (engaged: boolean) => api.setKillSwitch(engaged, reason),
    onSuccess: () => {
      setReason('');
      return qc.invalidateQueries({ queryKey: ['kill-switch'] });
    },
  });

  if (status.isLoading) return <Loader />;
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Issuance kill switch</Text>
          <Badge color={status.data?.engaged ? 'red' : 'green'}>
            {status.data?.engaged ? 'ENGAGED — issuance stopped' : 'disengaged'}
          </Badge>
        </Group>
        {status.data?.reason && <Text size="sm" c="dimmed">Reason on record: {status.data.reason}</Text>}
        <TextInput
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Group>
          <Button
            color="red"
            disabled={reason.trim().length < 3 || status.data?.engaged}
            loading={toggle.isPending}
            onClick={() => toggle.mutate(true)}
          >
            Engage (stop all issuance)
          </Button>
          <Button
            variant="light"
            disabled={reason.trim().length < 3 || !status.data?.engaged}
            loading={toggle.isPending}
            onClick={() => toggle.mutate(false)}
          >
            Disengage
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function PeriodsSection() {
  const qc = useQueryClient();
  const periods = useQuery({ queryKey: ['admin-periods'], queryFn: api.listPeriods });
  const [form, setForm] = useState({ id: '', name: '', kind: 'ANNUAL', startsAt: '', endsAt: '' });
  const save = useMutation({
    mutationFn: () =>
      api.savePeriod(Number(form.id), {
        name: form.name,
        kind: form.kind,
        ridingNumbers: [],
        startsAt: form.startsAt,
        endsAt: form.endsAt,
      }),
    onSuccess: () => {
      setForm({ id: '', name: '', kind: 'ANNUAL', startsAt: '', endsAt: '' });
      return qc.invalidateQueries({ queryKey: ['admin-periods'] });
    },
  });

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text fw={600}>Periods</Text>
        {periods.isLoading ? (
          <Loader />
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Id</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Starts</Table.Th>
                <Table.Th>Ends</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {periods.data?.data.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>{p.id}</Table.Td>
                  <Table.Td>{p.name}</Table.Td>
                  <Table.Td>{p.kind}</Table.Td>
                  <Table.Td>{new Date(p.startsAt).toLocaleDateString()}</Table.Td>
                  <Table.Td>{new Date(p.endsAt).toLocaleDateString()}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Text size="sm" fw={600} mt="sm">
          Create or edit a period (an edit re-runs validation rule A1 for every contribution)
        </Text>
        <Group grow>
          <NumberInput label="Id (EO period id)" value={form.id} onChange={(v) => setForm({ ...form, id: String(v ?? '') })} />
          <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <NativeSelect
            label="Kind"
            data={['ANNUAL', 'GENERAL_ELECTION', 'BY_ELECTION']}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.currentTarget.value })}
          />
          <TextInput
            type="datetime-local"
            label="Starts at (UTC)"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.currentTarget.value })}
          />
          <TextInput
            type="datetime-local"
            label="Ends at (UTC)"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.currentTarget.value })}
          />
        </Group>
        <Group>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!form.id || !form.name || !form.startsAt || !form.endsAt}
          >
            Save period
          </Button>
        </Group>
        {save.isSuccess && <Alert color="green">Saved. Validation re-run against every mirrored contribution.</Alert>}
      </Stack>
    </Card>
  );
}

function ContributionLimitsSection() {
  const qc = useQueryClient();
  const limits = useQuery({ queryKey: ['admin-limits'], queryFn: api.listContributionLimits });
  const [form, setForm] = useState({ year: '', bucket: 'PARTY', amountCents: '', notes: '' });
  const save = useMutation({
    mutationFn: () =>
      api.saveContributionLimit({
        year: Number(form.year),
        bucket: form.bucket,
        amountCents: Math.round(Number(form.amountCents) * 100),
        notes: form.notes || null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-limits'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteContributionLimit(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-limits'] }),
  });

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text fw={600}>Contribution limit buckets</Text>
        {limits.isLoading ? (
          <Loader />
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Year</Table.Th>
                <Table.Th>Bucket</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Notes</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {limits.data?.data.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>{l.year}</Table.Td>
                  <Table.Td>{l.bucket}</Table.Td>
                  <Table.Td>${(l.amountCents / 100).toFixed(2)}</Table.Td>
                  <Table.Td>{l.notes ?? '—'}</Table.Td>
                  <Table.Td>
                    <Button size="xs" color="red" variant="subtle" onClick={() => remove.mutate(l.id)}>
                      Remove
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Group grow>
          <NumberInput label="Year" value={form.year} onChange={(v) => setForm({ ...form, year: String(v ?? '') })} />
          <NativeSelect
            label="Bucket"
            data={['PARTY', 'CA', 'CAMPAIGN', 'LEADERSHIP', 'CANDIDATE_SELF']}
            value={form.bucket}
            onChange={(e) => setForm({ ...form, bucket: e.currentTarget.value })}
          />
          <NumberInput
            label="Amount ($)"
            value={form.amountCents}
            onChange={(v) => setForm({ ...form, amountCents: String(v ?? '') })}
          />
          <TextInput label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} />
        </Group>
        <Group>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.year || !form.amountCents}>
            Save bucket
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function HolidaysSection() {
  const qc = useQueryClient();
  const calendars = useQuery({ queryKey: ['admin-holidays'], queryFn: api.listBusinessDayCalendars });
  const [year, setYear] = useState('');
  const [holidaysText, setHolidaysText] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.saveBusinessDayCalendar(
        Number(year),
        holidaysText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-holidays'] }),
  });

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text fw={600}>RTD business-day calendar (holidays)</Text>
        {calendars.isLoading ? (
          <Loader />
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Year</Table.Th>
                <Table.Th>Holidays</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {calendars.data?.data.map((c) => (
                <Table.Tr key={c.year}>
                  <Table.Td>{c.year}</Table.Td>
                  <Table.Td>{c.holidays.join(', ')}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Group grow>
          <NumberInput label="Year" value={year} onChange={(v) => setYear(String(v ?? ''))} />
          <TextInput
            label="Holidays (comma-separated YYYY-MM-DD)"
            value={holidaysText}
            onChange={(e) => setHolidaysText(e.currentTarget.value)}
          />
        </Group>
        <Group>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!year}>
            Save calendar
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

const EMPTY_RIDING_FORM = { ridingNumber: '', name: '', qomonApiKey: '', qomonApiBase: '', active: true };

function RidingsSection() {
  const qc = useQueryClient();
  const ridings = useQuery({ queryKey: ['admin-ridings'], queryFn: api.listRidings });
  const [modalOpened, setModalOpened] = useState(false);
  const [editingRiding, setEditingRiding] = useState<RidingRow | null>(null);
  const [form, setForm] = useState(EMPTY_RIDING_FORM);
  const save = useMutation({
    mutationFn: () => {
      const qomonApiBase = form.qomonApiBase || null;
      const qomonApiKey = form.qomonApiKey.trim();
      // Editing goes through PATCH so a blank key field leaves the existing
      // key in place instead of wiping it (PUT always overwrites it).
      if (editingRiding) {
        return api.updateRiding(editingRiding.ridingNumber, {
          name: form.name,
          qomonApiBase,
          active: form.active,
          ...(qomonApiKey ? { qomonApiKey } : {}),
        });
      }
      return api.saveRiding(Number(form.ridingNumber), {
        name: form.name,
        qomonApiKey,
        qomonApiBase,
        active: form.active,
      });
    },
    onSuccess: () => {
      setModalOpened(false);
      setForm(EMPTY_RIDING_FORM);
      return qc.invalidateQueries({ queryKey: ['admin-ridings'] });
    },
  });
  const remove = useMutation({
    mutationFn: (ridingNumber: number) => api.deleteRiding(ridingNumber),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-ridings'] }),
  });

  const [importParseError, setImportParseError] = useState<string | null>(null);
  const importRidings = useMutation({
    mutationFn: (rows: RidingImportRow[]) => api.importRidings(rows),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-ridings'] }),
  });
  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    setImportParseError(null);
    importRidings.reset();
    let rows: unknown;
    try {
      rows = JSON.parse(await file.text());
    } catch {
      setImportParseError(`${file.name} is not valid JSON`);
      return;
    }
    if (!Array.isArray(rows)) {
      setImportParseError(`${file.name} must contain a JSON array of ridings`);
      return;
    }
    importRidings.mutate(rows as RidingImportRow[]);
  };

  const openAddModal = () => {
    setEditingRiding(null);
    setForm(EMPTY_RIDING_FORM);
    setModalOpened(true);
  };
  const openEditModal = (riding: RidingRow) => {
    setEditingRiding(riding);
    setForm({
      ridingNumber: String(riding.ridingNumber),
      name: riding.name,
      qomonApiKey: '',
      qomonApiBase: riding.qomonApiBase ?? '',
      active: riding.active,
    });
    setModalOpened(true);
  };
  const closeModal = () => {
    setModalOpened(false);
    setEditingRiding(null);
    setForm(EMPTY_RIDING_FORM);
  };

  const hasKeyOnFile = editingRiding?.qomonApiKeySet ?? false;
  const trimmedKey = form.qomonApiKey.trim();
  const keyMissing = form.active && !trimmedKey && !hasKeyOnFile;
  const keyLabel = hasKeyOnFile
    ? 'Qomon API key (leave blank to keep the current one)'
    : `Qomon API key${form.active ? '' : ' (optional while inactive)'}`;

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Ridings (per-riding Qomon spaces)</Text>
          <Group gap="xs">
            <FileButton onChange={handleImportFile} accept="application/json">
              {(props) => (
                <Button size="xs" variant="default" loading={importRidings.isPending} {...props}>
                  Import from file
                </Button>
              )}
            </FileButton>
            <Button size="xs" onClick={openAddModal}>
              Add riding
            </Button>
          </Group>
        </Group>
        <Text size="sm" c="dimmed">
          A riding here runs its own Qomon space, separate from the party-level space
          (QOMON_API_KEY). A mirror sweep can target one by riding number instead of the
          party space (see Dev tools). The API key is never shown again once saved. Import
          upserts by riding number — re-importing an updated file never creates duplicates,
          and a blank key in the file leaves an existing riding's key in place.
        </Text>
        {importParseError && <Alert color="red">{importParseError}</Alert>}
        {importRidings.isError && <Alert color="red">{importRidings.error.message}</Alert>}
        {importRidings.isSuccess && (
          <Alert color="green">
            Imported {importRidings.data.imported} riding{importRidings.data.imported === 1 ? '' : 's'} (
            {importRidings.data.created} added, {importRidings.data.updated} updated).
          </Alert>
        )}
        {ridings.isLoading ? (
          <Loader />
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Riding #</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Api base</Table.Th>
                <Table.Th>Key on file</Table.Th>
                <Table.Th>Active</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ridings.data?.data.map((r) => (
                <Table.Tr key={r.ridingNumber}>
                  <Table.Td>{r.ridingNumber}</Table.Td>
                  <Table.Td>{r.name}</Table.Td>
                  <Table.Td>{r.qomonApiBase ?? '(default)'}</Table.Td>
                  <Table.Td>
                    {r.qomonApiKeySet ? (
                      <Text c="green" fw={700} span aria-label="Key on file">
                        ✓
                      </Text>
                    ) : (
                      <Text c="dimmed" span aria-label="No key on file">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={r.active ? 'green' : 'gray'}>{r.active ? 'Active' : 'Inactive'}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button size="xs" variant="subtle" onClick={() => openEditModal(r)}>
                        Edit
                      </Button>
                      <Button size="xs" color="red" variant="subtle" onClick={() => remove.mutate(r.ridingNumber)}>
                        Remove
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <Modal opened={modalOpened} onClose={closeModal} title={editingRiding ? `Edit riding ${editingRiding.ridingNumber}` : 'Add riding'}>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {editingRiding
              ? 'The API key is never shown again once saved, so it stays as-is unless you enter a new one.'
              : 'Adding a riding number that already exists replaces its space. An inactive riding may be saved without an API key.'}
          </Text>
          <NumberInput
            label="Riding # (1-124)"
            value={form.ridingNumber}
            onChange={(v) => setForm({ ...form, ridingNumber: String(v ?? '') })}
            disabled={!!editingRiding}
          />
          <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <TextInput
            label={keyLabel}
            value={form.qomonApiKey}
            onChange={(e) => setForm({ ...form, qomonApiKey: e.currentTarget.value })}
          />
          <TextInput
            label="Qomon API base (optional)"
            value={form.qomonApiBase}
            onChange={(e) => setForm({ ...form, qomonApiBase: e.currentTarget.value })}
          />
          <Checkbox
            label="Active"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.currentTarget.checked })}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!form.ridingNumber || !form.name || keyMissing}
            >
              Save riding
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.listUsers });
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'readonly' });
  const create = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: () => {
      setForm({ name: '', email: '', password: '', role: 'readonly' });
      return qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.updateUser(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text fw={600}>Users &amp; roles</Text>
        {users.isLoading ? (
          <Loader />
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>CFO designate</Table.Th>
                <Table.Th>Active</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.data?.data.map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td>{u.name}</Table.Td>
                  <Table.Td>{u.email}</Table.Td>
                  <Table.Td>{u.role}</Table.Td>
                  <Table.Td>{u.isCfoDesignate ? 'yes' : '—'}</Table.Td>
                  <Table.Td>
                    <Checkbox
                      checked={u.active}
                      onChange={(e) => toggleActive.mutate({ id: u.id, active: e.currentTarget.checked })}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Text size="sm" fw={600} mt="sm">
          New user
        </Text>
        <Group grow>
          <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
          <TextInput
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
          />
          <TextInput
            label="Temporary password (12+ chars)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
          />
          <NativeSelect
            label="Role"
            data={['sysadmin', 'party_cfo', 'administrator', 'rules_authority', 'bookkeeper', 'filer', 'process_owner', 'organizer', 'cfo', 'readonly']}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.currentTarget.value })}
          />
        </Group>
        <Group>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!form.name || !form.email || form.password.length < 12}
          >
            Create user
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

const RULE_CATEGORY_LABELS: Record<string, string> = {
  A: 'Contribution-level (A)',
  B: 'Donor-level (B)',
  C: 'Receipt & address (C)',
  E: 'Entity / sync integrity (E)',
  REP: 'Report-time (REP)',
};

function ruleCategory(ruleRef: string): string {
  return /^[A-Z]+/.exec(ruleRef)?.[0] ?? ruleRef;
}

const IMPLEMENTED_RULE_REF_SET: ReadonlySet<string> = new Set(IMPLEMENTED_RULE_REFS);

/** Static reference table, not a live rule engine (ticket asked for a
 *  reference, not dynamic evaluation). Sourced from RULE_LABELS
 *  (rule-labels.ts) rather than restated here, and RULE_LABELS is checked
 *  against @gpo/tax-receipts-core's IMPLEMENTED_RULE_REFS in
 *  rule-labels.test.ts — so a rule the engine can actually raise never
 *  goes undocumented on this page, even though the page itself doesn't
 *  re-run any rule logic. */
function ValidationRulesSection() {
  const groups = new Map<string, Array<{ ruleRef: string; label: string }>>();
  for (const [ruleRef, label] of Object.entries(RULE_LABELS)) {
    const category = ruleCategory(ruleRef);
    const entries = groups.get(category) ?? [];
    entries.push({ ruleRef, label });
    groups.set(category, entries);
  }

  return (
    <Card withBorder>
      <Stack gap="lg">
        <div>
          <Text fw={600}>Validation rules</Text>
          <Text size="sm" c="dimmed">
            Every rule the validation engine can raise against a contribution, grouped as in
            validation-rules.md. This is a static reference — it does not re-run any checks.
          </Text>
        </div>
        {[...groups.entries()].map(([category, rules]) => (
          <div key={category}>
            <Text size="sm" fw={600} mb="xs">
              {RULE_CATEGORY_LABELS[category] ?? category}
            </Text>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={80}>Rule</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th w={140}>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rules.map((r) => (
                  <Table.Tr key={r.ruleRef}>
                    <Table.Td>{r.ruleRef}</Table.Td>
                    <Table.Td>{r.label}</Table.Td>
                    <Table.Td>
                      <Badge color={IMPLEMENTED_RULE_REF_SET.has(r.ruleRef) ? 'green' : 'gray'}>
                        {IMPLEMENTED_RULE_REF_SET.has(r.ruleRef) ? 'Implemented' : 'Not yet implemented'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        ))}
      </Stack>
    </Card>
  );
}

export function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Stack gap="lg">
      <Title order={2}>Annual settings &amp; admin</Title>
      <Group>
        {visibleAdminSections.map((s) => {
          const to = `/admin/${s.slug}`;
          return (
            <Button
              key={s.slug}
              component={Link}
              to={to}
              variant={pathname === to ? 'filled' : 'default'}
            >
              {s.label}
            </Button>
          );
        })}
      </Group>
      <Outlet />
    </Stack>
  );
}
