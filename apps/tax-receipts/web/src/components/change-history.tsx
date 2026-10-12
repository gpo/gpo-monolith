import { useState, type ReactNode } from 'react';
import { Button, Card, Group, Stack, Text } from '@mantine/core';

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
