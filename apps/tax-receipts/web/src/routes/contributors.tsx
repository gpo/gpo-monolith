import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Alert, Badge, Button, Card, Group, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import { api, type ContactSource, type FormattedAddress } from '../api.js';
import { ContactFormModal, ownershipNote } from '../components/contact-form-modal.js';
import { PageHeader } from '../components/PageHeader.js';
import { money } from './contribution-detail.js';

/**
 * Contributors (D13; EO evaluation rows 20 to 23): find a contributor, add
 * one, and see and edit one's details with their change history. Where a
 * record lives (Qomon or this tool) is shown on every row.
 */

function formatAddress(a: FormattedAddress | null | undefined): string {
  if (!a) return '';
  return `${a.line1}, ${a.city} ${a.province} ${a.postalCode}`;
}

export function SourceBadge({ source }: { source: ContactSource }) {
  return source === 'qomon' ? (
    <Badge variant="light" color="blue">
      Qomon
    </Badge>
  ) : (
    <Badge variant="light" color="gray">
      This tool
    </Badge>
  );
}

export function ContributorsPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const query = search.trim();
  const list = useQuery({
    queryKey: ['contacts', query],
    queryFn: () => api.listContacts({ query: query.length >= 2 ? query : undefined }),
  });

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <PageHeader title="Contributors" backTo="/" backLabel="Back to dashboard" />
        {me.data?.can.addContacts && <Button onClick={() => setAdding(true)}>Add a contributor</Button>}
      </Group>

      <TextInput
        label="Search"
        placeholder="Name or email (two letters or more)"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        maw={400}
      />

      {list.isLoading ? (
        <Loader />
      ) : list.isError ? (
        <Text c="red">Failed to load contributors.</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Address</Table.Th>
              <Table.Th>Kept in</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.data?.data.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>
                  <Link to="/contributors/$id" params={{ id: c.id }}>
                    {c.name}
                  </Link>
                </Table.Td>
                <Table.Td>{c.email ?? '—'}</Table.Td>
                <Table.Td>
                  {c.formattedAddress ? (
                    formatAddress(c.formattedAddress)
                  ) : (
                    <Text span size="sm" c="orange">
                      no address
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <SourceBadge source={c.qomonContactId === null ? 'tool' : 'qomon'} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {list.data?.data.length === 0 && (
        <Text c="dimmed" ta="center">
          No contributors match.
        </Text>
      )}

      {adding && (
        <ContactFormModal
          contact={null}
          onClose={() => setAdding(false)}
          onSaved={(saved) => void navigate({ to: '/contributors/$id', params: { id: saved.id } })}
        />
      )}
    </Stack>
  );
}

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value);
}

export function ContributorDetailPage({ id }: { id: string }) {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const detail = useQuery({ queryKey: ['contact', id], queryFn: () => api.getContact(id) });
  const [editing, setEditing] = useState(false);

  if (detail.isLoading) return <Loader />;
  if (detail.isError || !detail.data) return <Text c="red">Contributor not found.</Text>;
  const c = detail.data;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <PageHeader title={c.name} backTo="/contributors" backLabel="Back to contributors" />
        {me.data?.can.editContacts && c.editable && !c.mergedIntoId && (
          <Button onClick={() => setEditing(true)}>Edit contributor</Button>
        )}
      </Group>

      {c.mergedIntoId && (
        <Alert color="orange">
          This contributor was merged into{' '}
          <Link to="/contributors/$id" params={{ id: c.mergedIntoId }}>
            another record
          </Link>
          ; edit that one instead.
        </Alert>
      )}
      {!c.editable && (
        <Alert color="gray">
          This is a Qomon contact and Qomon is not connected here, so it cannot be edited in this tool.
        </Alert>
      )}

      <Card withBorder>
        <Stack gap="xs">
          <Group gap="xs">
            <Text fw={600}>Details</Text>
            <SourceBadge source={c.source} />
          </Group>
          <Group grow>
            <Text>First name: {c.firstName ?? '—'}</Text>
            <Text>Last name: {c.lastName ?? '—'}</Text>
            <Text>Contributor type: Individual</Text>
          </Group>
          <Group grow>
            <Text>Email: {c.email ?? '—'}</Text>
            <Text>Contributor id: {c.id}</Text>
            <Text>Qomon contact: {c.qomonContactId ?? 'none (kept in this tool)'}</Text>
          </Group>
          <Text size="sm" c={c.formattedAddress ? undefined : 'orange'}>
            Address:{' '}
            {c.formattedAddress
              ? `${formatAddress(c.formattedAddress)}, ${c.formattedAddress.country}`
              : 'none on file; a receipt cannot be issued until one is added'}
          </Text>
          <Text size="xs" c="dimmed">
            {ownershipNote('edit', c.source)}
            {c.lastSyncedAt && ` Last copied from Qomon ${new Date(c.lastSyncedAt).toLocaleString()}.`}
          </Text>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Contributions</Text>
          {c.contributions.length === 0 ? (
            <Text size="sm" c="dimmed">
              None yet.
            </Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Accepted</Table.Th>
                  <Table.Th>Amount</Table.Th>
                  <Table.Th>Entity</Table.Th>
                  <Table.Th>Period</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {c.contributions.map((k) => (
                  <Table.Tr key={k.id}>
                    <Table.Td>
                      <Link to="/contributions/$id" params={{ id: k.id }}>
                        {new Date(k.acceptedAt).toLocaleDateString()}
                      </Link>
                    </Table.Td>
                    <Table.Td>{money(k.amountCents)}</Table.Td>
                    <Table.Td>
                      {k.entityKind ?? '—'}
                      {k.ridingNumber !== null ? ` (riding ${k.ridingNumber})` : ''}
                    </Table.Td>
                    <Table.Td>{k.periodId ?? '—'}</Table.Td>
                    <Table.Td>{k.status}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Change history</Text>
          {c.changeLog.length === 0 ? (
            <Text size="sm" c="dimmed">
              No recorded changes.
            </Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>At</Table.Th>
                  <Table.Th>By</Table.Th>
                  <Table.Th>Reason</Table.Th>
                  <Table.Th>Before</Table.Th>
                  <Table.Th>After</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {c.changeLog.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>{new Date(e.at).toLocaleString()}</Table.Td>
                    <Table.Td>{e.actorName ?? 'System'}</Table.Td>
                    <Table.Td>{e.reason}</Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                        {jsonCell(e.before)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                        {jsonCell(e.after)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Card>

      {editing && <ContactFormModal contact={c} onClose={() => setEditing(false)} />}
    </Stack>
  );
}
