import { useState, type ReactNode } from 'react';
import { Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import { ChangeEntryModal, changeSummary, type ChangeEntry } from './change-entry-modal.js';

type ChangeHistoryCardProps = {
  /** the record's change-log entries; only `at` is read here */
  entries: Array<{ at: string }>;
  /** the expanded list, rendered only while open */
  children: ReactNode;
};

/** The "Change history" card on a record's page. It starts collapsed with
 * the date of the latest change in its header, since the history is rarely
 * what someone opened the page for; a Show button expands the entries. */
export function ChangeHistoryCard({ entries, children }: ChangeHistoryCardProps) {
  const [open, setOpen] = useState(false);
  const latest = entries.reduce<string | null>((max, e) => (max === null || e.at > max ? e.at : max), null);
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Group gap="xs">
            <Text fw={600}>Change history</Text>
            <Text size="sm" c="dimmed">
              {latest ? `Last updated ${new Date(latest).toLocaleString()}` : 'No recorded changes'}
            </Text>
          </Group>
          {entries.length > 0 && (
            <Button size="xs" variant="subtle" onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide' : `Show ${entries.length} ${entries.length === 1 ? 'change' : 'changes'}`}
            </Button>
          )}
        </Group>
        {open && children}
      </Stack>
    </Card>
  );
}

type ChangeHistoryTableProps = {
  entries: Array<ChangeEntry & { id: string }>;
  /** shown in the modal title for entries that carry no subject type */
  subjectType?: string;
};

/** A record's change-log entries, one row each with a summary of what
 * changed; clicking a row opens the entry in full. Entries that carry their
 * subject type get a Record column, since a page can merge more than one
 * record's history (a contribution shows its payment's too). Pass as the
 * children of ChangeHistoryCard. */
export function ChangeHistoryTable({ entries, subjectType }: ChangeHistoryTableProps) {
  const [viewing, setViewing] = useState<ChangeEntry | null>(null);
  const showRecord = entries.some((e) => e.subjectType);
  return (
    <>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>At</Table.Th>
            <Table.Th>By</Table.Th>
            {showRecord && <Table.Th>Record</Table.Th>}
            <Table.Th>Reason</Table.Th>
            <Table.Th>Changes</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map((e) => (
            <Table.Tr
              key={e.id}
              onClick={() => setViewing(e)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  setViewing(e);
                }
              }}
              tabIndex={0}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td>{new Date(e.at).toLocaleString()}</Table.Td>
              <Table.Td>{e.actorName ?? 'System'}</Table.Td>
              {showRecord && <Table.Td>{e.subjectType}</Table.Td>}
              <Table.Td>{e.reason}</Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace">
                  {changeSummary(e)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {viewing && (
        <ChangeEntryModal entry={{ subjectType, ...viewing }} onClose={() => setViewing(null)} />
      )}
    </>
  );
}
