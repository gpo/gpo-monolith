import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { api } from '../api.js';

export function DashboardPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
  });

  return (
    <Stack gap="lg" maw={720}>
      <Title order={2}>Phase 0 shell</Title>
      <Text c="dimmed">
        Scaffold only. The contributions list, validation queue, issuance
        wizard, and reporting screens land in Phases 1 to 4.
      </Text>

      <Card withBorder>
        <Group justify="space-between">
          <Text fw={600}>API health</Text>
          {health.isLoading ? (
            <Loader size="sm" />
          ) : health.data ? (
            <Group gap="xs">
              <Badge color={health.data.db === 'up' ? 'green' : 'red'}>
                db {health.data.db}
              </Badge>
              <Text size="sm" c="dimmed">
                {health.data.service}
              </Text>
            </Group>
          ) : (
            <Badge color="red">unreachable</Badge>
          )}
        </Group>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Session
        </Text>
        {me.isLoading ? (
          <Loader size="sm" />
        ) : me.data ? (
          <Stack gap={4}>
            <Text>
              {me.data.name} &mdash; <Badge>{me.data.role}</Badge>
            </Text>
            <Text size="sm" c="dimmed">
              can issue receipts: {String(me.data.can.issueReceipts)} &middot; can
              operate kill switch: {String(me.data.can.administerKillSwitch)}
            </Text>
          </Stack>
        ) : (
          <Alert color="blue" variant="light">
            Not signed in. Use the Sign in link.
          </Alert>
        )}
      </Card>
    </Stack>
  );
}
