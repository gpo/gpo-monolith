import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Group, Loader, Stack, Table, Text, TextInput } from '@mantine/core';
import { api } from '../api.js';

/**
 * Leadership contestants (EO evaluation row 25): the recipients a LEADERSHIP
 * contribution can be directed to. Each write takes a reason and is
 * change-logged (subject type LeadershipContestant). A contestant is never
 * deleted; one who withdraws is made inactive, which stops new contributions
 * being directed to them and keeps their history.
 */
export function LeadershipContestantsSection() {
  const qc = useQueryClient();
  const contestants = useQuery({ queryKey: ['leadership-contestants'], queryFn: api.listLeadershipContestants });
  const [form, setForm] = useState({ name: '', contestName: '' });
  // one reason field covers an add or an activation change; both are change-logged
  const [reason, setReason] = useState('');
  const hasReason = reason.trim().length >= 3;

  const done = () => {
    setReason('');
    return qc.invalidateQueries({ queryKey: ['leadership-contestants'] });
  };
  const create = useMutation({
    mutationFn: () =>
      api.createLeadershipContestant({ name: form.name.trim(), contestName: form.contestName.trim(), reason: reason.trim() }),
    onSuccess: () => {
      setForm({ name: '', contestName: '' });
      return done();
    },
  });
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.updateLeadershipContestant(id, { active, reason: reason.trim() }),
    onSuccess: done,
  });

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text fw={600}>Leadership contestants</Text>
        <Text size="sm" c="dimmed">
          A contribution directed to a leadership contestant names one of these. The contestant’s name prints on the
          receipt and in the EO reports (entity type LC). Leadership contributions count toward the LEADERSHIP limit
          bucket, so add that bucket for the contest’s year under Contribution limits.
        </Text>
        {contestants.isLoading ? (
          <Loader />
        ) : contestants.data?.data.length === 0 ? (
          <Text c="dimmed">None yet.</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Contestant</Table.Th>
                <Table.Th>Contest</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {contestants.data?.data.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{c.name}</Table.Td>
                  <Table.Td>{c.contestName}</Table.Td>
                  <Table.Td>
                    <Badge color={c.active ? 'green' : 'gray'}>{c.active ? 'active' : 'inactive'}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!hasReason}
                      title={hasReason ? undefined : 'Enter a reason below first'}
                      loading={setActive.isPending && setActive.variables?.id === c.id}
                      onClick={() => setActive.mutate({ id: c.id, active: !c.active })}
                    >
                      {c.active ? 'Make inactive' : 'Make active'}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Group grow>
          <TextInput
            label="Contestant name"
            placeholder="as it should print on the receipt"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label="Leadership contest"
            placeholder="e.g. 2027 Leadership Contest"
            value={form.contestName}
            onChange={(e) => setForm({ ...form, contestName: e.currentTarget.value })}
          />
        </Group>
        <TextInput
          label="Reason (required to add or change a contestant, recorded in the change log)"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Group>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!form.name.trim() || !form.contestName.trim() || !hasReason}
          >
            Add contestant
          </Button>
        </Group>
        {(create.isError || setActive.isError) && (
          <Alert color="red">{(create.error ?? setActive.error)?.message}</Alert>
        )}
      </Stack>
    </Card>
  );
}
