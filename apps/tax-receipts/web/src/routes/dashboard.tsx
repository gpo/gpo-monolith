import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Card,
  Group,
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

/** Same wording as RECIPIENT_KIND_OPTIONS in contribution-detail.tsx — enum
 * values stay PARTY/CA/CAMPAIGN on the wire, only the on-screen label changes. */
function entityKindLabel(entityKind: string): string {
  if (entityKind === 'CA') return 'Constituency association';
  if (entityKind === 'CAMPAIGN') return 'Campaign';
  if (entityKind === 'PARTY') return 'Party (province-wide)';
  return entityKind;
}

export function DashboardPage() {
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: api.listSpaces });
  const periods = useQuery({ queryKey: ['admin-periods'], queryFn: api.listPeriods });
  const ridings = useQuery({ queryKey: ['admin-ridings'], queryFn: api.listRidings });

  const periodName = (periodId: number): string =>
    periods.data?.data.find((p) => p.id === periodId)?.name ?? `Period ${periodId}`;
  const ridingName = (ridingNumber: number): string =>
    ridings.data?.data.find((r) => r.ridingNumber === ridingNumber)?.name ?? `Riding ${ridingNumber}`;

  return (
    <Stack gap="lg">
      <Title order={2}>Spaces</Title>

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
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {spaces.data.data.map((s) => (
              <Table.Tr
                key={`${s.periodId}:${s.ridingNumber ?? 'party'}:${s.entityKind}`}
              >
                <Table.Td>{periodName(s.periodId)}</Table.Td>
                <Table.Td>{s.ridingNumber ? ridingName(s.ridingNumber) : 'Party'}</Table.Td>
                <Table.Td>{entityKindLabel(s.entityKind)}</Table.Td>
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
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Link
                      to="/contributions"
                      search={{
                        periodId: s.periodId,
                        ...(s.ridingNumber ? { ridingNumber: s.ridingNumber } : { partyLevelOnly: true }),
                        entityKind: s.entityKind,
                      }}
                    >
                      <Button size="xs" variant="default">
                        Contributions
                      </Button>
                    </Link>
                    <Link
                      to="/spaces/$periodId/$entityKind/issue"
                      params={{ periodId: String(s.periodId), entityKind: s.entityKind }}
                      search={s.ridingNumber ? { ridingNumber: s.ridingNumber } : {}}
                    >
                      <Button size="xs" variant="light">
                        Issue
                      </Button>
                    </Link>
                  </Group>
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
