import { useState } from 'react';
import { Badge, Button, Group, Modal, Stack, Table, Text } from '@mantine/core';
import type { ChangeLogRow } from '../api.js';

/** What the modal needs from a change-log entry. Record pages may omit the
 * subject, since it is the page's own record. */
export type ChangeEntry = Pick<
  ChangeLogRow,
  'reason' | 'before' | 'after' | 'at' | 'correlationId' | 'actorName'
> &
  Partial<Pick<ChangeLogRow, 'subjectType' | 'subjectId'>>;

export type FieldChange = {
  /** dotted path into the record, e.g. `address.postalCode` or `items.0` */
  field: string;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  before: unknown;
  after: unknown;
};

function isContainer(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Flattens nested objects and arrays to dotted paths; empty containers and
 * scalars are leaves. A non-object top-level value sits at the empty path. */
function flatten(
  value: unknown,
  prefix = '',
  out = new Map<string, unknown>(),
): Map<string, unknown> {
  if (isContainer(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value))
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (value !== null && value !== undefined) {
    out.set(prefix, value);
  }
  return out;
}

/** Field-by-field comparison of a change-log entry's before and after,
 * changed fields first, each group in field order. */
export function diffEntry(before: unknown, after: unknown): FieldChange[] {
  const b = flatten(before);
  const a = flatten(after);
  const fields = [...new Set([...b.keys(), ...a.keys()])].sort();
  const changes = fields.map((field): FieldChange => {
    const inB = b.has(field);
    const inA = a.has(field);
    const kind = !inB
      ? 'added'
      : !inA
        ? 'removed'
        : JSON.stringify(b.get(field)) === JSON.stringify(a.get(field))
          ? 'unchanged'
          : 'changed';
    return { field, kind, before: b.get(field), after: a.get(field) };
  });
  return [
    ...changes.filter((c) => c.kind !== 'unchanged'),
    ...changes.filter((c) => c.kind === 'unchanged'),
  ];
}

/** What kind of change the entry records as a whole. */
export function entryAction(
  before: unknown,
  after: unknown,
): 'Created' | 'Removed' | 'Updated' {
  if (before === null || before === undefined) return 'Created';
  if (after === null || after === undefined) return 'Removed';
  return 'Updated';
}

/** One-line summary for a table row: the action, plus the changed field
 * names for an update. */
export function changeSummary(e: ChangeEntry): string {
  const action = entryAction(e.before, e.after);
  if (action !== 'Updated') return action;
  const fields = diffEntry(e.before, e.after)
    .filter((c) => c.kind !== 'unchanged')
    .map((c) => c.field || '(value)');
  if (fields.length === 0) return 'No field changes';
  const shown = fields.slice(0, 4).join(', ');
  return fields.length > 4 ? `${shown} +${fields.length - 4} more` : shown;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '""' : v;
  return JSON.stringify(v);
}

const KIND_BADGE: Record<
  FieldChange['kind'],
  { color: string; label: string }
> = {
  added: { color: 'green', label: 'Added' },
  removed: { color: 'red', label: 'Removed' },
  changed: { color: 'yellow', label: 'Changed' },
  unchanged: { color: 'gray', label: 'Unchanged' },
};

type ChangeEntryModalProps = {
  entry: ChangeEntry;
  onClose: () => void;
  /** when given, offers a button to view every entry sharing this correlation id */
  onShowCorrelated?: (correlationId: string) => void;
};

/** One change-log entry in full: who, when, and why, then a field-by-field
 * table of what changed. Unchanged fields are hidden behind a toggle. */
export function ChangeEntryModal({
  entry,
  onClose,
  onShowCorrelated,
}: ChangeEntryModalProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const changes = diffEntry(entry.before, entry.after);
  const unchangedCount = changes.filter((c) => c.kind === 'unchanged').length;
  const visible = showUnchanged
    ? changes
    : changes.filter((c) => c.kind !== 'unchanged');
  const action = entryAction(entry.before, entry.after);

  return (
    <Modal
      opened
      onClose={onClose}
      size="xl"
      title={[
        action,
        entry.subjectType,
        entry.subjectId && `(${entry.subjectId})`,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Stack gap="md">
        <Group gap="xl" align="flex-start">
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              At
            </Text>
            <Text size="sm">{new Date(entry.at).toLocaleString()}</Text>
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              Actor
            </Text>
            <Text size="sm">{entry.actorName ?? 'System'}</Text>
          </Stack>
          <Stack gap={0}>
            <Text size="xs" c="dimmed">
              Correlation id
            </Text>
            <Text size="sm" ff="monospace">
              {entry.correlationId}
            </Text>
          </Stack>
        </Group>
        <Stack gap={0}>
          <Text size="xs" c="dimmed">
            Reason
          </Text>
          <Text size="sm">{entry.reason}</Text>
        </Stack>

        {visible.length === 0 ? (
          <Text c="dimmed" size="sm">
            No field values changed.
          </Text>
        ) : (
          <Table withTableBorder layout="fixed">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w="25%">Field</Table.Th>
                <Table.Th w={110} />
                <Table.Th>Before</Table.Th>
                <Table.Th>After</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((c) => (
                <Table.Tr
                  key={c.field}
                  c={c.kind === 'unchanged' ? 'dimmed' : undefined}
                >
                  <Table.Td>
                    <Text
                      size="sm"
                      ff="monospace"
                      style={{ wordBreak: 'break-all' }}
                    >
                      {c.field || '(value)'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      variant="light"
                      color={KIND_BADGE[c.kind].color}
                    >
                      {KIND_BADGE[c.kind].label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      ff="monospace"
                      td={
                        c.kind === 'changed' || c.kind === 'removed'
                          ? 'line-through'
                          : undefined
                      }
                      c={
                        c.kind === 'changed' || c.kind === 'removed'
                          ? 'red.8'
                          : undefined
                      }
                      style={{ wordBreak: 'break-word' }}
                    >
                      {formatValue(c.before)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      ff="monospace"
                      fw={
                        c.kind === 'changed' || c.kind === 'added'
                          ? 600
                          : undefined
                      }
                      c={
                        c.kind === 'changed' || c.kind === 'added'
                          ? 'green.8'
                          : undefined
                      }
                      style={{ wordBreak: 'break-word' }}
                    >
                      {formatValue(c.after)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Group justify="space-between">
          <Group gap="xs">
            {unchangedCount > 0 && (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setShowUnchanged((s) => !s)}
              >
                {showUnchanged
                  ? 'Hide unchanged fields'
                  : `Show ${unchangedCount} unchanged fields`}
              </Button>
            )}
            {onShowCorrelated && (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => onShowCorrelated(entry.correlationId)}
              >
                Show all changes from this action
              </Button>
            )}
          </Group>
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
