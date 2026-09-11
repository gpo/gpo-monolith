import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Card,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { api } from '../api.js';

/**
 * Space dashboard (ticket 1.10, screens.md 1, PRD I3): the process owner's
 * "where are we" grid, one row per derived space (period × riding × entity
 * kind). Rows drill into the space-filtered contributions list.
 *
 * The RTD-deadline column screens.md describes isn't here yet — see
 * api/src/space/dashboard.ts's header comment: nothing in the build
 * computes an RTD due date per space before Phase 2.
 */

function stageColor(stage: string): string {
  if (stage === 'sent-to-cfo' || stage === 'reported') return 'green';
  if (stage === 'issued' || stage === 'delivered') return 'blue';
  if (stage === 'reconciled') return 'teal';
  return 'gray';
}

export function DashboardPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: api.listSpaces });

  return (
    <Stack gap="lg">
      <Title order={2}>Spaces</Title>

      {!me.isLoading && !me.data && (
        <Alert color="blue" variant="light">
          Not signed in. Use the Sign in link.
        </Alert>
      )}

      {spaces.isLoading ? (
        <Loader />
      ) : spaces.isError ? (
        <Text c="red">Failed to load the space dashboard.</Text>
      ) : spaces.data && spaces.data.data.length > 0 ? (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Period</Table.Th>
              <Table.Th>Riding</Table.Th>
              <Table.Th>Entity</Table.Th>
              <Table.Th>Stage</Table.Th>
              <Table.Th>Stage owner</Table.Th>
              <Table.Th>Contributions</Table.Th>
              <Table.Th>Open flags</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {spaces.data.data.map((s) => (
              <Table.Tr
                key={`${s.periodId}:${s.ridingNumber ?? 'party'}:${s.entityKind}`}
              >
                <Table.Td>
                  <Link
                    to="/contributions"
                    search={{
                      periodId: s.periodId,
                      ...(s.ridingNumber ? { ridingNumber: s.ridingNumber } : { partyLevelOnly: true }),
                      entityKind: s.entityKind,
                    }}
                  >
                    <Text span c="blue">
                      {s.periodId}
                    </Text>
                  </Link>
                </Table.Td>
                <Table.Td>{s.ridingNumber ?? 'Party'}</Table.Td>
                <Table.Td>{s.entityKind}</Table.Td>
                <Table.Td>
                  <Badge color={stageColor(s.stage)}>{s.stage}</Badge>
                </Table.Td>
                <Table.Td>{s.stageOwner ?? '—'}</Table.Td>
                <Table.Td>{s.contributionCount}</Table.Td>
                <Table.Td>
                  {s.openWorkItemCount > 0 ? (
                    <Badge color="orange">{s.openWorkItemCount}</Badge>
                  ) : (
                    <Badge color="green">clear</Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Card withBorder>
          <Text c="dimmed">No spaces yet — nothing has been mirrored from Qomon.</Text>
        </Card>
      )}
    </Stack>
  );
}
