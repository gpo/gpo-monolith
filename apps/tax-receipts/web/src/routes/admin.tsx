import { useState } from 'react';
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
} from '@mantine/core';
import { api } from '../api.js';

/**
 * Annual settings and admin (ticket 1.12, screens.md 11): periods,
 * ContributionLimit buckets, users/roles, the RTD holiday calendar, and the
 * kill switch. All writes are sysadmin-only server-side; a 403 here just
 * means "ask a sysadmin."
 *
 * Not built: the receipt letter template (Phase 3, no template system
 * exists) and RTD "CFO name" / sign-off threshold (no schema field or spec
 * value for either — see api/src/routes/admin.ts).
 */

const SECTIONS = ['Periods', 'Contribution limits', 'RTD holidays', 'Users', 'Kill switch'] as const;
type Section = (typeof SECTIONS)[number];

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

export function AdminPage() {
  const [section, setSection] = useState<Section>('Periods');

  return (
    <Stack gap="lg">
      <Title order={2}>Annual settings &amp; admin</Title>
      <Group>
        {SECTIONS.map((s) => (
          <Button key={s} variant={section === s ? 'filled' : 'default'} onClick={() => setSection(s)}>
            {s}
          </Button>
        ))}
      </Group>

      {section === 'Periods' && <PeriodsSection />}
      {section === 'Contribution limits' && <ContributionLimitsSection />}
      {section === 'RTD holidays' && <HolidaysSection />}
      {section === 'Users' && <UsersSection />}
      {section === 'Kill switch' && <KillSwitchSection />}
    </Stack>
  );
}
