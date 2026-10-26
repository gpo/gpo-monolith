import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NativeSelect,
  NumberInput,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { api, ApiError, type ContributionDetail } from '../api.js';
import { describeRuleRef } from '../rule-labels.js';
import { ChangeHistoryCard, ChangeHistoryTable } from '../components/change-history.js';
import { CorrectionPanel } from '../components/correction-panel.js';
import { EditContributionModal, receivedByOptions } from '../components/edit-contribution-modal.js';
import { EditPaymentModal } from '../components/edit-payment-modal.js';
import { AGENCY_HELP, describeRecipient, leadershipLabelNote } from '../entity-kind.js';
import { PageHeader } from '../components/PageHeader.js';
import { paymentMethodLabel, paymentReferenceLabel } from '../components/payment-reference.js';
import { CancellationNoticeActions, ReceiptActions } from '../components/receipt-actions.js';

/**
 * Contribution detail (ticket 1.5, screens.md 3). The Payment and
 * Contribution cards show the same fields, in the same order, as Add a
 * payment, read-only; each has an Edit modal. A payment imported from Qomon
 * stays read-only. Below them: work items, allocations and receipts (Issue a
 * receipt is a modal), and the change history. Correcting the contribution
 * (amount, donor, split, refund) is a modal from the Contribution card.
 */

/** Wider than the payment entry forms, so the change history table has room. */
const PAGE_WIDTH = 880;

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Mirrors the server's `remainingEligibleCents` (invariant 1,
 * @gpo/tax-receipts-core) so the issue-receipt form can prefill/cap the
 * amount; the server re-checks this authoritatively on submit. */
function remainingEligibleCents(detail: ContributionDetail): number {
  if (!detail.metadata) return 0;
  const eligible = detail.amountCents - detail.metadata.nonDeductibleCents;
  const issued = detail.allocations
    .filter((a) => a.receipt.status === 'ISSUED')
    .reduce((sum, a) => sum + a.amountCents, 0);
  return Math.max(0, eligible - issued);
}

/** A starting point only: the issuer can (and for CA/campaign, must) change
 * it. The exact EO-facing wording is a compliance question, not something to
 * bake in silently (see PHASE-3-NOTES.md). Exported: the per-space issuance
 * page (ticket 3.12) needs the same default for the same reason. */
export function defaultPoliticalEntityLabel(entityKind: string): string {
  if (entityKind === 'PARTY') return 'Green Party of Ontario';
  // printed from the contestant registry instead (receiptEntityLabel in the api)
  if (entityKind === 'LEADERSHIP') return 'Leadership contestant (name from the record)';
  return '';
}

function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/** One read-only field: the entry form's label over its value. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" component="div">
        {children}
      </Text>
    </Stack>
  );
}

/** Manual entry is the default and gets no badge; only imports are called out. */
const SOURCE_LABELS: Record<string, string | undefined> = {
  QOMON_IMPORT: 'Qomon',
  LEGACY_IMPORT: 'Legacy import',
};

function IssueReceiptModal({ detail, onClose }: { detail: ContributionDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const metadata = detail.metadata!;
  const remaining = remainingEligibleCents(detail);
  const [amount, setAmount] = useState<number | ''>('');
  const [delivery, setDelivery] = useState<'MAIL' | 'EMAIL'>('MAIL');
  const [label, setLabel] = useState(defaultPoliticalEntityLabel(metadata.entityKind));
  const [reason, setReason] = useState('');

  const issue = useMutation({
    mutationFn: () =>
      api.issueReceipt(detail.id, {
        reason: reason.trim(),
        amountCents: amount === '' ? undefined : Math.round(amount * 100),
        delivery,
        politicalEntityLabel: label.trim(),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contribution', detail.id] });
      onClose();
    },
  });

  return (
    <Modal opened onClose={onClose} title="Issue a receipt">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Remaining eligible: {money(remaining)}
        </Text>
        <NumberInput
          label="Amount ($)"
          description="Blank = the full remaining amount."
          min={0.01}
          max={remaining / 100}
          decimalScale={2}
          value={amount}
          onChange={(v) => setAmount(typeof v === 'number' ? v : '')}
        />
        <NativeSelect
          label="Delivery"
          data={[
            { value: 'MAIL', label: 'Mail' },
            { value: 'EMAIL', label: 'Email' },
          ]}
          value={delivery}
          onChange={(e) => setDelivery(e.currentTarget.value as 'MAIL' | 'EMAIL')}
        />
        <TextInput
          label="Received-by label"
          placeholder="e.g. Green Party of Ontario"
          description={leadershipLabelNote(metadata.entityKind) ?? 'As it should print on the receipt. Required.'}
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
        />
        <TextInput
          label="Reason (required)"
          placeholder="e.g. donor requested annual receipt"
          description="At least 3 characters."
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        {issue.error && (
          <Alert color="red">{issue.error instanceof ApiError ? issue.error.message : 'Failed to issue receipt.'}</Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => issue.mutate()}
            loading={issue.isPending}
            disabled={reason.trim().length < 3 || label.trim().length === 0}
          >
            Issue receipt
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ContributionDetailPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['contribution', id],
    queryFn: () => api.getContribution(id),
  });
  const periods = useQuery({ queryKey: ['admin-periods'], queryFn: api.listPeriods });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  const [editingPayment, setEditingPayment] = useState(false);
  const [editingContribution, setEditingContribution] = useState(false);
  const [issuing, setIssuing] = useState(false);
  // a committed correction retires this row, so the modal showing what it did
  // stays open after the row turns into history
  const [correcting, setCorrecting] = useState(false);

  const detail = query.data;
  if (query.isLoading) return <Loader />;
  if (query.isError || !detail) return <Text c="red">Contribution not found.</Text>;

  const can = me.data?.can;
  const active = detail.status === 'ACTIVE';
  const fromQomon = detail.qomon !== null || detail.payment.source === 'QOMON_IMPORT';
  const receipted = detail.allocations.some((a) => a.receipt.status === 'ISSUED');
  const referenceLabel = paymentReferenceLabel(detail.payment.method);
  const metadata = detail.metadata;
  const periodName = (periodId: number) =>
    periods.data?.data.find((p) => p.id === periodId)?.name ?? `Period ${periodId}`;
  const remaining = remainingEligibleCents(detail);
  const issueBlocked = !metadata
    ? 'Waiting on metadata (intake derivation) before a receipt can be issued.'
    : remaining <= 0
      ? 'Nothing left to receipt: the full eligible amount is already issued.'
      : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['contribution', id] });

  return (
    <Stack gap="lg" maw={PAGE_WIDTH} mx="auto">
      <PageHeader title="Contribution" backTo="/contributions" backLabel="Back to list" />
      {editingPayment && (
        <EditPaymentModal contributionId={detail.id} payment={detail.payment} onClose={() => setEditingPayment(false)} />
      )}
      {editingContribution && metadata && (
        <EditContributionModal detail={detail} onClose={() => setEditingContribution(false)} />
      )}
      {issuing && metadata && <IssueReceiptModal detail={detail} onClose={() => setIssuing(false)} />}
      {correcting && can && (
        <Modal opened onClose={() => setCorrecting(false)} title="Correct this contribution" size="xl">
          <CorrectionPanel detail={detail} canFile={can.fileEOForms} onDone={refresh} />
        </Modal>
      )}

      {!active && <Alert color="orange">This contribution is {detail.status}; it is history, not the working record.</Alert>}

      <Card withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Group gap="xs">
              <Text fw={600}>Payment</Text>
              {SOURCE_LABELS[detail.payment.source] && (
                <Badge variant="light" color="gray">
                  {SOURCE_LABELS[detail.payment.source]}
                </Badge>
              )}
              {detail.payment.state !== 'RECEIVED' && (
                <Badge variant="light" color="orange">
                  {detail.payment.state}
                </Badge>
              )}
            </Group>
            {can?.enterPayments && (
              <Tooltip label="Imported from Qomon: it can only change there." multiline w={240} disabled={!fromQomon}>
                {/* a disabled button fires no hover events, so the span carries the tooltip */}
                <span>
                  <Button size="xs" disabled={fromQomon} onClick={() => setEditingPayment(true)}>
                    Edit
                  </Button>
                </span>
              </Tooltip>
            )}
          </Group>
          {detail.payment.unattributedCents > 0 && can?.enterPayments && (
            <Alert color="blue" variant="light">
              {money(detail.payment.unattributedCents)} of this {money(detail.payment.amountCents)} payment is not
              attributed to any contribution.{' '}
              <Link to="/payments/$id/attribute" params={{ id: detail.payment.id }}>
                Attribute the rest
              </Link>
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md" verticalSpacing="sm">
            <Field label="Donor who paid">
              <Link to="/contributors/$id" params={{ id: detail.payment.contactId }}>
                {detail.payment.contactName}
              </Link>
            </Field>
            <Field label="Amount">{money(detail.payment.amountCents)}</Field>
            <Field label="Received on">{dateOnly(detail.payment.receivedAt)}</Field>
            <Field label="Method">{paymentMethodLabel(detail.payment.method)}</Field>
            {referenceLabel && <Field label={referenceLabel}>{detail.payment.externalRef ?? '—'}</Field>}
            <Field label="Payer name">{detail.payment.payerName ?? '—'}</Field>
            <Field label="Note">{detail.payment.note ?? '—'}</Field>
          </SimpleGrid>
          {detail.qomon && (
            <Text size="xs" c="dimmed">
              Qomon transaction {detail.qomon.transactionId}
              {detail.qomon.codeCampaign ? `, code campaign ${detail.qomon.codeCampaign}` : ''}; last seen{' '}
              {detail.qomon.lastSyncedAt ? new Date(detail.qomon.lastSyncedAt).toLocaleString() : 'never'}.
            </Text>
          )}
          {detail.payment.contributions.length > 1 && (
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Split across {detail.payment.contributions.length} contributions:
              </Text>
              <Table withRowBorders={false} verticalSpacing={2}>
                <Table.Tbody>
                  {detail.payment.contributions.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td>
                        {c.id === detail.id ? (
                          <Text size="sm" fw={600}>
                            this contribution
                          </Text>
                        ) : (
                          <Link to="/contributions/$id" params={{ id: c.id }}>
                            <Text size="sm" span c="blue">
                              {c.contactName}
                            </Text>
                          </Link>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{money(c.amountCents)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{describeRecipient(c)}</Text>
                        {c.agencyContribution && (
                          <Badge color="grape" variant="light" size="sm">
                            agency
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>Contribution</Text>
            {active && (
              <Group gap="xs">
                {can?.correctContributions && (
                  <Button size="xs" variant="default" onClick={() => setCorrecting(true)}>
                    Correct
                  </Button>
                )}
                {can?.editContributions && metadata && (
                  <Tooltip
                    label="This contribution backs an issued receipt; change it with Correct instead."
                    multiline
                    w={240}
                    disabled={!receipted}
                  >
                    {/* a disabled button fires no hover events, so the span carries the tooltip */}
                    <span>
                      <Button size="xs" disabled={receipted} onClick={() => setEditingContribution(true)}>
                        Edit
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </Group>
            )}
          </Group>
          {!metadata && (
            <Text size="sm" c="dimmed">
              No metadata yet: this contribution is waiting on intake derivation.
            </Text>
          )}
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md" verticalSpacing="sm">
            <Field label="Donor">
              <Link to="/contributors/$id" params={{ id: detail.contact.id }}>
                {detail.contact.name}
              </Link>
              <Text size="xs" c="dimmed">
                Individual, contributor id {detail.contact.contributorId}
              </Text>
            </Field>
            <Field label="Amount">{money(detail.amountCents)}</Field>
            {metadata && (
              <>
                <Field label="Recipient">
                  <Group gap="xs">
                    {describeRecipient(metadata)}
                    {metadata.agencyContribution && (
                      <Tooltip label={AGENCY_HELP} multiline w={300} withArrow>
                        <Badge color="grape" variant="light" size="sm">
                          agency
                        </Badge>
                      </Tooltip>
                    )}
                  </Group>
                </Field>
                <Field label="Period">{periodName(metadata.periodId)}</Field>
              </>
            )}
            <Field label="Accepted on">{dateOnly(detail.acceptedAt)}</Field>
            {metadata && (
              <>
                <Field label="Received by">
                  {receivedByOptions(metadata.entityKind).find((o) => o.value === metadata.receivedBy)?.label ??
                    metadata.receivedBy}
                </Field>
                <Field label="Source code">{metadata.sourceCode || '—'}</Field>
                <Field label="Donor received goods or services">{metadata.goodsServices ? 'Yes' : 'No'}</Field>
                <Field label="Non-deductible">{money(metadata.nonDeductibleCents)}</Field>
              </>
            )}
            <Field label="Note">{detail.note ?? '—'}</Field>
          </SimpleGrid>
          <Field label="Address on file">
            {detail.contact.address ? (
              `${detail.contact.address.line1}, ${detail.contact.address.city} ${detail.contact.address.province} ${detail.contact.address.postalCode}, ${detail.contact.address.country}`
            ) : (
              <Text size="sm" c="orange" span>
                None: a receipt cannot be issued until this donor has an address on file.
              </Text>
            )}
          </Field>
        </Stack>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Work items
        </Text>
        {detail.workItems.length === 0 ? (
          <Text c="dimmed">None.</Text>
        ) : (
          <Table>
            <Table.Tbody>
              {detail.workItems.map((w) => (
                <Table.Tr key={w.id}>
                  <Table.Td>{w.kind}</Table.Td>
                  <Table.Td>
                    {w.ruleRef ? (
                      <>
                        {describeRuleRef(w.ruleRef)}{' '}
                        <Text span size="xs" c="dimmed">
                          ({w.ruleRef})
                        </Text>
                      </>
                    ) : (
                      '—'
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={w.status === 'OPEN' ? 'orange' : w.status === 'EXCEPTION' ? 'yellow' : 'green'}>
                      {w.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{dateOnly(w.openedAt)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Card withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>Allocations &amp; receipts</Text>
            {can?.issueReceipts && (
              <Tooltip label={issueBlocked} multiline w={240} disabled={issueBlocked === null}>
                <span>
                  <Button size="xs" disabled={issueBlocked !== null} onClick={() => setIssuing(true)}>
                    Issue a receipt
                  </Button>
                </span>
              </Tooltip>
            )}
          </Group>
          {detail.allocations.length === 0 ? (
            <Text c="dimmed">None issued yet.</Text>
          ) : (
            <Table>
              <Table.Tbody>
                {detail.allocations.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>{a.receipt.receiptNumber}</Table.Td>
                    <Table.Td>{a.receipt.status}</Table.Td>
                    <Table.Td>{money(a.amountCents)}</Table.Td>
                    <Table.Td>{dateOnly(a.receipt.issueDate)}</Table.Td>
                    <Table.Td>
                      <Text
                        component="a"
                        href={api.receiptPdfUrl(a.receipt.id)}
                        target="_blank"
                        rel="noreferrer"
                        c="blue"
                        size="sm"
                      >
                        View PDF
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <CancellationNoticeActions
                        receipt={a.receipt}
                        donorEmail={detail.contact.email}
                        canSend={can?.correctReceipts ?? false}
                        onDone={refresh}
                      />
                      {can?.correctReceipts && (
                        <ReceiptActions
                          receipt={a.receipt}
                          donorName={detail.contact.name}
                          defaultLabel={defaultPoliticalEntityLabel(metadata?.entityKind ?? '')}
                          onDone={refresh}
                        />
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Card>

      <ChangeHistoryCard entries={detail.changeLog}>
        <ChangeHistoryTable entries={detail.changeLog} />
      </ChangeHistoryCard>
    </Stack>
  );
}
