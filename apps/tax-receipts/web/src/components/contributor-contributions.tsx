import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert, Badge, Button, Card, Checkbox, Group, Stack, Table, Text, TextInput } from '@mantine/core';
import { api, ApiError, type ContactDetail, type IssuedReceipt } from '../api.js';
import { leadershipLabelNote } from '../entity-kind.js';
import { defaultPoliticalEntityLabel, money } from '../routes/contribution-detail.js';

type ContributorContribution = ContactDetail['contributions'][number];

/** Contributions that may share one receipt agree on everything a receipt
 *  prints or reports once (the api's `receipts/combined.ts`): period, entity,
 *  riding, contestant, agency status, and contribution type. */
function combineKey(c: ContributorContribution): string {
  return [c.periodId, c.entityKind, c.ridingNumber, c.leadershipContestantId, c.receivedBy, c.goodsServices].join('|');
}

function receiptable(c: ContributorContribution): boolean {
  return c.status === 'ACTIVE' && c.periodId !== null && c.remainingCents > 0;
}

/**
 * A contributor's contributions, with "issue one receipt for these" (EO
 * evaluation rows 43 and 46): pick two or more that still have something to
 * receipt, and they go onto a single new receipt, one allocation each. Once
 * one is ticked, only contributions that may share its receipt stay
 * selectable.
 */
export function ContributorContributions({
  contactId,
  contributions,
  canIssue,
}: {
  contactId: string;
  contributions: ContributorContribution[];
  canIssue: boolean;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedReceipt | null>(null);

  const chosen = contributions.filter((c) => selected.includes(c.id));
  const key = chosen[0] ? combineKey(chosen[0]) : null;
  const entityKind = chosen[0]?.entityKind ?? 'PARTY';
  const effectiveLabel = (label ?? defaultPoliticalEntityLabel(entityKind)).trim();
  const total = chosen.reduce((sum, c) => sum + c.remainingCents, 0);

  const issue = useMutation({
    mutationFn: () =>
      api.issueCombinedReceipt({ contributionIds: selected, reason, politicalEntityLabel: effectiveLabel }),
    onSuccess: (receipt) => {
      setIssued(receipt);
      setError(null);
      setSelected([]);
      setReason('');
      return qc.invalidateQueries({ queryKey: ['contact', contactId] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to issue the receipt.'),
  });

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Contributions</Text>
        {contributions.length === 0 ? (
          <Text size="sm" c="dimmed">
            None yet.
          </Text>
        ) : (
          <>
            {canIssue && (
              <Text size="sm" c="dimmed">
                Tick two or more contributions to issue one receipt for all of them.
              </Text>
            )}
            <Table>
              <Table.Thead>
                <Table.Tr>
                  {canIssue && <Table.Th aria-label="Select" />}
                  <Table.Th>Accepted</Table.Th>
                  <Table.Th>Amount</Table.Th>
                  <Table.Th>Entity</Table.Th>
                  <Table.Th>Period</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Left to receipt</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {contributions.map((k) => {
                  const selectable = receiptable(k) && (key === null || combineKey(k) === key);
                  return (
                    <Table.Tr key={k.id}>
                      {canIssue && (
                        <Table.Td>
                          <Checkbox
                            aria-label={`Select the contribution of ${new Date(k.acceptedAt).toLocaleDateString()}`}
                            checked={selected.includes(k.id)}
                            disabled={!selectable && !selected.includes(k.id)}
                            onChange={(e) => toggle(k.id, e.currentTarget.checked)}
                          />
                        </Table.Td>
                      )}
                      <Table.Td>
                        <Link to="/contributions/$id" params={{ id: k.id }}>
                          {new Date(k.acceptedAt).toLocaleDateString()}
                        </Link>
                      </Table.Td>
                      <Table.Td>
                        {money(k.amountCents)}
                        {k.goodsServices && (
                          <Badge ml="xs" size="xs" color="grape">
                            G&amp;S
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {k.entityKind ?? '—'}
                        {k.ridingNumber !== null ? ` (riding ${k.ridingNumber})` : ''}
                      </Table.Td>
                      <Table.Td>{k.periodId ?? '—'}</Table.Td>
                      <Table.Td>{k.status}</Table.Td>
                      <Table.Td>{k.status === 'ACTIVE' ? money(k.remainingCents) : '—'}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </>
        )}

        {issued && (
          <Alert color="green">
            Issued {issued.receiptNumber} for {money(issued.amountCents)}.{' '}
            <Text component="a" href={api.receiptPdfUrl(issued.id)} target="_blank" rel="noreferrer" c="blue" size="sm">
              View PDF
            </Text>
          </Alert>
        )}

        {canIssue && selected.length >= 2 && (
          <Stack gap="xs" maw={480}>
            <Text size="sm">
              One receipt for {selected.length} contributions, totalling {money(total)}.
            </Text>
            <TextInput
              label="Received-by label (as it should print on the receipt)"
              description={leadershipLabelNote(entityKind)}
              value={label ?? defaultPoliticalEntityLabel(entityKind)}
              onChange={(e) => setLabel(e.currentTarget.value)}
            />
            <TextInput
              label="Reason (required)"
              placeholder="e.g. donor asked for one receipt for the year"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            {error && <Alert color="red">{error}</Alert>}
            <Group>
              <Button
                onClick={() => issue.mutate()}
                loading={issue.isPending}
                disabled={reason.trim().length < 3 || effectiveLabel.length === 0}
              >
                Issue one receipt
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
