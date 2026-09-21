import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NativeSelect,
  SimpleGrid,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api, ApiError, type SpaceIssuanceResult } from '../api.js';
import { describeRuleRef } from '../rule-labels.js';
import { defaultPoliticalEntityLabel, money } from './contribution-detail.js';

/**
 * Per-space issuance wizard (ticket 3.12, screens.md screen 6, first slice):
 * gate check -> pre-issuance preview -> generate. Delivery (email/print,
 * Qomon activity logging, donor pre-check) is not built yet (tickets
 * 3.5/3.6/3.9), so there is no "deliver" or "done-with-delivery" step here —
 * "done" just shows what was issued, the same gap ticket 3.1 already left.
 *
 * Reachable from the space dashboard's "Issue" action per row.
 */

interface SpaceIssuanceParams {
  periodId: number;
  entityKind: string;
  ridingNumber: number | null;
}

function spaceLabel({ periodId, ridingNumber, entityKind }: SpaceIssuanceParams): string {
  return `Period ${periodId} · ${ridingNumber !== null ? `Riding ${ridingNumber}` : 'Party'} · ${entityKind}`;
}

export function SpaceIssuancePage(params: SpaceIssuanceParams) {
  const { periodId, entityKind, ridingNumber } = params;
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const preview = useQuery({
    queryKey: ['space-issuance-preview', periodId, entityKind, ridingNumber],
    queryFn: () => api.previewSpaceIssuance(periodId, entityKind, ridingNumber),
  });

  const [active, setActive] = useState(0);
  const [reason, setReason] = useState('');
  const [politicalEntityLabel, setPoliticalEntityLabel] = useState<string | null>(null);
  const [deliveryOverride, setDeliveryOverride] = useState<'' | 'EMAIL' | 'MAIL'>('');
  const [genError, setGenError] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<SpaceIssuanceResult | null>(null);

  const effectiveLabel = (politicalEntityLabel ?? defaultPoliticalEntityLabel(entityKind)).trim();

  const generate = useMutation({
    mutationFn: () =>
      api.issueSpaceReceipts(periodId, entityKind, ridingNumber, {
        reason,
        politicalEntityLabel: effectiveLabel,
        delivery: deliveryOverride || undefined,
      }),
    onSuccess: (result) => {
      setGenError(null);
      setGenResult(result);
      setActive(2);
      return qc.invalidateQueries({ queryKey: ['space-issuance-preview', periodId, entityKind, ridingNumber] });
    },
    onError: (err) => {
      setGenError(err instanceof ApiError ? err.message : 'Failed to generate receipts.');
    },
  });

  const canIssue = me.data?.can.issueReceipts ?? false;
  const canReview = preview.data !== undefined && !preview.data.blocked && preview.data.lines.length > 0;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Issue receipts</Title>
        <Link to="/">
          <Text span c="blue" size="sm">
            &larr; Back to spaces
          </Text>
        </Link>
      </Group>
      <Text c="dimmed">{spaceLabel(params)}</Text>

      <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false}>
        <Stepper.Step label="Review" description="Gate check + pre-issuance preview">
          {preview.isLoading ? (
            <Loader mt="md" />
          ) : preview.isError ? (
            <Alert color="red" mt="md">
              Failed to load the preview.
            </Alert>
          ) : preview.data ? (
            <Stack gap="md" mt="md">
              {preview.data.blocked ? (
                <Card withBorder>
                  <Stack gap="xs">
                    <Text fw={600} c="orange">
                      {preview.data.blockers.length} open work item(s) block issuance for this space
                    </Text>
                    <Text size="sm" c="dimmed">
                      Resolve every item below, then refresh this preview.
                    </Text>
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Donor</Table.Th>
                          <Table.Th>Rule</Table.Th>
                          <Table.Th></Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {preview.data.blockers.map((b) => (
                          <Table.Tr key={b.workItemId}>
                            <Table.Td>{b.contactName ?? '—'}</Table.Td>
                            <Table.Td>
                              {b.ruleRef ? (
                                <>
                                  {describeRuleRef(b.ruleRef)}{' '}
                                  <Text span size="xs" c="dimmed">
                                    ({b.ruleRef})
                                  </Text>
                                </>
                              ) : (
                                b.kind
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Link to="/contributions/$id" params={{ id: b.contributionId }}>
                                <Text span c="blue" size="sm">
                                  Open contribution
                                </Text>
                              </Link>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Stack>
                </Card>
              ) : preview.data.lines.length === 0 ? (
                <Card withBorder>
                  <Text c="dimmed">
                    Nothing to issue — every contribution in this space is already fully receipted (or there are
                    none yet).
                  </Text>
                </Card>
              ) : (
                <>
                  <SimpleGrid cols={{ base: 2, sm: 4 }}>
                    <Card withBorder>
                      <Text size="xs" c="dimmed">
                        Receipts
                      </Text>
                      <Text fw={700} size="xl">
                        {preview.data.totals.receiptCount}
                      </Text>
                    </Card>
                    <Card withBorder>
                      <Text size="xs" c="dimmed">
                        Total amount
                      </Text>
                      <Text fw={700} size="xl">
                        {money(preview.data.totals.amountCents)}
                      </Text>
                    </Card>
                    <Card withBorder>
                      <Text size="xs" c="dimmed">
                        Email delivery
                      </Text>
                      <Text fw={700} size="xl">
                        {preview.data.totals.emailCount}
                      </Text>
                    </Card>
                    <Card withBorder>
                      <Text size="xs" c="dimmed">
                        Mail delivery
                      </Text>
                      <Text fw={700} size="xl">
                        {preview.data.totals.mailCount}
                      </Text>
                    </Card>
                  </SimpleGrid>
                  <Table striped withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Donor</Table.Th>
                        <Table.Th>Amount</Table.Th>
                        <Table.Th>Delivery</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {preview.data.lines.map((l) => (
                        <Table.Tr key={l.contributionId}>
                          <Table.Td>
                            <Link to="/contributions/$id" params={{ id: l.contributionId }}>
                              <Text span c="blue">
                                {l.contactName}
                              </Text>
                            </Link>
                          </Table.Td>
                          <Table.Td>{money(l.amountCents)}</Table.Td>
                          <Table.Td>
                            <Badge color={l.delivery === 'EMAIL' ? 'blue' : 'gray'}>{l.delivery}</Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </>
              )}
              <Group>
                <Button variant="light" onClick={() => preview.refetch()} loading={preview.isFetching}>
                  Refresh preview
                </Button>
                <Button disabled={!canReview} onClick={() => setActive(1)}>
                  Next: generate
                </Button>
              </Group>
            </Stack>
          ) : null}
        </Stepper.Step>

        <Stepper.Step label="Generate" description="Issue every receipt in this space">
          <Stack gap="md" mt="md" maw={480}>
            {!canIssue && (
              <Alert color="yellow">
                Only the party CFO (or an authorized designate) may issue receipts (s. 25.1(6)).
              </Alert>
            )}
            <Text size="sm" c="dimmed">
              This will issue {preview.data?.totals.receiptCount ?? '—'} receipt(s) totalling{' '}
              {preview.data ? money(preview.data.totals.amountCents) : '—'}.
            </Text>
            <TextInput
              label="Received-by label (as it should print on every receipt)"
              placeholder="e.g. Green Party of Ontario"
              value={politicalEntityLabel ?? defaultPoliticalEntityLabel(entityKind)}
              onChange={(e) => setPoliticalEntityLabel(e.currentTarget.value)}
            />
            <NativeSelect
              label="Delivery override"
              description="Leave as-is to use each donor's own preference (defaulting to mail)."
              data={[
                { value: '', label: "Use each donor's preference" },
                { value: 'MAIL', label: 'Force mail for all' },
                { value: 'EMAIL', label: 'Force email for all' },
              ]}
              value={deliveryOverride}
              onChange={(e) => setDeliveryOverride(e.currentTarget.value as '' | 'EMAIL' | 'MAIL')}
            />
            <TextInput
              label="Reason for this issuance run (required)"
              placeholder="e.g. period-end batch issuance"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            {genError && <Alert color="red">{genError}</Alert>}
            <Group>
              <Button variant="subtle" onClick={() => setActive(0)}>
                Back
              </Button>
              <Button
                onClick={() => generate.mutate()}
                loading={generate.isPending}
                disabled={!canIssue || reason.trim().length < 3 || effectiveLabel.length === 0}
              >
                Generate receipts
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Done" description="Results">
          {genResult && (
            <Stack gap="md" mt="md">
              <Alert color={genResult.failed === 0 ? 'green' : 'orange'}>
                {genResult.succeeded} issued, {genResult.failed} failed.
              </Alert>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Contribution</Table.Th>
                    <Table.Th>Result</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {genResult.results.map((r) => (
                    <Table.Tr key={r.contributionId}>
                      <Table.Td>
                        <Link to="/contributions/$id" params={{ id: r.contributionId }}>
                          <Text span c="blue">
                            {r.contributionId}
                          </Text>
                        </Link>
                      </Table.Td>
                      <Table.Td>
                        {r.ok ? (
                          <Group gap="xs">
                            <Badge color="green">{r.receiptNumber}</Badge>
                            <Text size="sm">{money(r.amountCents ?? 0)}</Text>
                            {r.receiptId && (
                              <Text
                                component="a"
                                href={api.receiptPdfUrl(r.receiptId)}
                                target="_blank"
                                rel="noreferrer"
                                c="blue"
                                size="sm"
                              >
                                View PDF
                              </Text>
                            )}
                          </Group>
                        ) : (
                          <Text c="red" size="sm">
                            {r.error}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}
        </Stepper.Step>
      </Stepper>
    </Stack>
  );
}
