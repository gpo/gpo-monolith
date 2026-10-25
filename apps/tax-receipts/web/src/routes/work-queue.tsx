import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { api, ApiError, type WorkItemRow } from '../api.js';
import { describeRuleRef } from '../rule-labels.js';

/**
 * Work queue (ticket 1.8, screens.md 5): the unified WorkItem screen, tabs
 * by kind. Each item shows subject, donor, rule; resolving requires a note,
 * exception requires a reason (both map to the same `reason` field — see
 * work-items/resolve.ts), entered in a modal since an exception's
 * justification can run to a paragraph. An exception's reason stays
 * editable afterwards. A plain button group stands in for tabs (Mantine's
 * `Tabs` wasn't tried; the column-picker precedent from 1.3 favours the
 * simplest thing that can't hit the Floating-UI/jsdom issue documented
 * there).
 */

const TABS: Array<{ kind: WorkItemRow['kind']; label: string }> = [
  { kind: 'VALIDATION', label: 'Validation' },
  { kind: 'DIFF', label: 'Diff queue' },
  { kind: 'OWED_TO_EO', label: 'Owed to EO' },
  { kind: 'SYNC_INCIDENT', label: 'Sync incidents' },
  { kind: 'DELIVERY', label: 'Delivery' },
];

function statusColor(status: string): string {
  if (status === 'OPEN') return 'orange';
  if (status === 'EXCEPTION') return 'yellow';
  return 'green';
}

/** Resolve and Exception close an open item; Edit rewrites an exception's
 *  reason. */
type ModalMode = 'RESOLVED' | 'EXCEPTION' | 'EDIT';

const MODAL_COPY: Record<ModalMode, { title: string; label: string; description: string; submit: string }> = {
  RESOLVED: {
    title: 'Resolve work item',
    label: 'Resolution note',
    description: 'What was done about it.',
    submit: 'Resolve',
  },
  EXCEPTION: {
    title: 'Record an exception',
    label: 'Exception reason',
    description:
      'Why the contribution is correct as it stands, and how you know. It is kept in the change log, and the exception lasts until the end of the calendar year.',
    submit: 'Record exception',
  },
  EDIT: {
    title: 'Edit exception',
    label: 'Exception reason',
    description: 'Why the contribution is correct as it stands, and how you know.',
    submit: 'Save exception',
  },
};

function WorkItemModal({ item, mode, onClose }: { item: WorkItemRow; mode: ModalMode; onClose: () => void }) {
  const qc = useQueryClient();
  const copy = MODAL_COPY[mode];
  const original = mode === 'EDIT' ? (item.resolutionNote ?? '') : '';
  const [note, setNote] = useState(original);
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () =>
      mode === 'EDIT'
        ? api.editWorkItemException(item.id, { exceptionReason: note.trim(), reason })
        : api.resolveWorkItem(item.id, { reason: note.trim(), outcome: mode }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['work-items'] }),
        qc.invalidateQueries({ queryKey: ['contribution', item.subjectId] }),
      ]);
      onClose();
    },
  });

  const noteLength = note.trim().length;
  const noteValid = noteLength >= 3;
  const unchanged = mode === 'EDIT' && note.trim() === original.trim();
  const reasonValid = mode !== 'EDIT' || reason.trim().length >= 3;

  return (
    <Modal opened onClose={onClose} title={copy.title} size="lg">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {item.contactName ?? 'No donor'} · {describeRuleRef(item.ruleRef)}
          {item.ruleRef ? ` (${item.ruleRef})` : ''}
        </Text>
        <Textarea
          label={copy.label}
          description={`${copy.description} At least 3 characters (${noteLength} so far).`}
          autosize
          minRows={5}
          maxRows={14}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          error={note.length > 0 && !noteValid ? 'At least 3 characters.' : undefined}
          data-autofocus
        />
        {mode === 'EDIT' && (
          <TextInput
            label="Reason for the edit (required)"
            placeholder="e.g. added how residency was confirmed"
            description="At least 3 characters."
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            error={reason.length > 0 && !reasonValid ? 'At least 3 characters.' : undefined}
          />
        )}
        {save.error && (
          <Alert color="red">{save.error instanceof ApiError ? save.error.message : 'Could not save the work item.'}</Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!noteValid || !reasonValid || unchanged}
          >
            {copy.submit}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function WorkItemRowView({ item }: { item: WorkItemRow }) {
  const [mode, setMode] = useState<ModalMode | null>(null);

  return (
    <Table.Tr>
      <Table.Td>
        {item.subjectType === 'Receipt' ? (
          // no receipt screen yet (ticket 3.13); the PDF is the receipt
          <Text component="a" href={api.receiptPdfUrl(item.subjectId)} target="_blank" rel="noreferrer" c="blue" size="sm">
            Receipt
          </Text>
        ) : (
          <Link to="/contributions/$id" params={{ id: item.subjectId }}>
            <Text span c="blue" size="sm">
              {item.subjectType}
            </Text>
          </Link>
        )}
      </Table.Td>
      <Table.Td>{item.contactName ?? '—'}</Table.Td>
      <Table.Td>
        {item.ruleRef ? (
          <Group gap={6} wrap="nowrap">
            <Text size="sm">{describeRuleRef(item.ruleRef)}</Text>
            <Text size="xs" c="dimmed">
              ({item.ruleRef})
            </Text>
          </Group>
        ) : (
          '—'
        )}
      </Table.Td>
      <Table.Td>{new Date(item.openedAt).toLocaleDateString()}</Table.Td>
      <Table.Td>{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : '—'}</Table.Td>
      <Table.Td>
        <Badge color={statusColor(item.status)}>{item.status}</Badge>
      </Table.Td>
      <Table.Td maw={320}>
        {item.resolutionNote ? (
          // a long exception reason is clamped here; Edit shows it in full
          <Text size="xs" c="dimmed" lineClamp={3} title={item.resolutionNote} style={{ whiteSpace: 'pre-line' }}>
            {item.resolutionNote}
          </Text>
        ) : (
          '—'
        )}
      </Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap" justify="flex-end">
          {item.status === 'OPEN' && (
            <>
              <Button size="xs" variant="subtle" onClick={() => setMode('RESOLVED')}>
                Resolve
              </Button>
              <Button size="xs" variant="subtle" color="yellow" onClick={() => setMode('EXCEPTION')}>
                Exception
              </Button>
            </>
          )}
          {item.status === 'EXCEPTION' && (
            <Button size="xs" variant="subtle" onClick={() => setMode('EDIT')}>
              Edit
            </Button>
          )}
        </Group>
        {mode && <WorkItemModal item={item} mode={mode} onClose={() => setMode(null)} />}
      </Table.Td>
    </Table.Tr>
  );
}

export function WorkQueuePage() {
  const [kind, setKind] = useState<WorkItemRow['kind']>('VALIDATION');

  const query = useQuery({
    queryKey: ['work-items', kind],
    queryFn: () => api.listWorkItems({ kind }),
  });

  return (
    <Stack gap="lg">
      <Title order={2}>Work queue</Title>

      <Group>
        {TABS.map((t) => (
          <Button
            key={t.kind}
            variant={kind === t.kind ? 'filled' : 'default'}
            onClick={() => setKind(t.kind)}
          >
            {t.label}
          </Button>
        ))}
      </Group>

      {query.isLoading ? (
        <Loader />
      ) : query.isError ? (
        <Text c="red">Failed to load the work queue.</Text>
      ) : query.data && query.data.data.length > 0 ? (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Subject</Table.Th>
              <Table.Th>Donor</Table.Th>
              <Table.Th>Rule</Table.Th>
              <Table.Th>Opened</Table.Th>
              <Table.Th>Due</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Resolution</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {query.data.data.map((item) => (
              <WorkItemRowView key={item.id} item={item} />
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text c="dimmed">Nothing in this queue.</Text>
      )}
    </Stack>
  );
}
