import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  NativeSelect,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { api, ApiError, type ContributionDetail, type MetadataEditInput } from '../api.js';

/** Metadata field help text — kept next to the form so it stays in sync with
 * what the fields actually do (packages/tax-receipts-core/src/metadata.ts). */
const METADATA_HELP = {
  entityKind:
    'Who received the contribution: the party centrally (province-wide, no riding), a constituency association (tied to a riding), or a candidate’s campaign (tied to a riding).',
  ridingNumber:
    'Electoral district (1–124) this contribution is attributed to. Required for a constituency association or campaign; not applicable when the recipient is the party (rule A2).',
  receivedBy:
    'Who physically processed the contribution — independent of who it’s attributed to above. GPO: entered centrally by the party office. Entity: entered directly by a constituency association or campaign’s own CFO/subspace (this can happen even when the recipient kind above is Party, e.g. intake can’t yet always tell which subspace handled it).',
  periodId: 'The receipting period (tax year) this contribution is attributed to.',
  nonDeductibleCents:
    'Portion of the amount that is not eligible for a tax receipt, e.g. the value of goods or services the donor received in exchange.',
  goodsServices:
    'Check if the donor received goods or services in exchange for this contribution — affects the non-deductible amount.',
  sourceCode:
    'Qomon/EO source code identifying the campaign or intake channel this contribution came in through; may also encode a riding number (rule A7).',
} as const;

/** Enum values stay PARTY/CA/CAMPAIGN on the wire (ContributionMetadata,
 * packages/tax-receipts-core/src/enums.ts) — only the on-screen labels are
 * natural language. */
const RECIPIENT_KIND_OPTIONS = [
  { value: 'PARTY', label: 'Party (province-wide)' },
  { value: 'CA', label: 'Constituency association' },
  { value: 'CAMPAIGN', label: 'Campaign' },
];

/** The ENTITY label for PARTY deliberately does NOT say "Party (central)" —
 * receivedBy tracks processing provenance (who entered it), not attribution.
 * ENTITY means "a subspace/CFO entry, not GPO centrally," which can be true
 * even when the recipient kind above is Party (intake defaults entity_kind
 * to PARTY whenever it can't yet identify the real subspace — see
 * packages/tax-receipts-core/src/intake/defaults.ts, invariant 8). Labelling
 * it as if it meant "the party" would claim the opposite of what it means. */
function receivedByOptions(entityKind: string): { value: string; label: string }[] {
  const entityLabel =
    entityKind === 'CA'
      ? 'Constituency association'
      : entityKind === 'CAMPAIGN'
        ? 'Campaign'
        : 'Entity / subspace entry (not GPO)';
  return [
    { value: 'GPO', label: 'GPO (party office, central)' },
    { value: 'ENTITY', label: entityLabel },
  ];
}

function FieldLabel({ label, help, required }: { label: string; help: string; required?: boolean }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text component="span" size="sm" fw={500}>
        {required && (
          <Text component="span" c="red" span aria-hidden>
            *{' '}
          </Text>
        )}
        {label}
      </Text>
      <Tooltip label={help} multiline w={260} withArrow events={{ hover: true, focus: true, touch: true }}>
        <ThemeIcon
          component="span"
          size={16}
          radius="xl"
          variant="light"
          color="gray"
          style={{ cursor: 'help' }}
          tabIndex={0}
          aria-label={`About ${label}`}
        >
          <Text size="10px" fw={700} span>
            ?
          </Text>
        </ThemeIcon>
      </Tooltip>
    </Group>
  );
}

/** Client-side mirror of rule A2 (checkA2RidingEntityConsistency in
 * @gpo/tax-receipts-core) so the form can hint at the mismatch before save;
 * the authoritative check still runs server-side post-save as a work item. */
function a2RidingEntityWarning(
  entityKind: string,
  ridingNumber: number | null,
): string | null {
  if (entityKind === 'PARTY' && ridingNumber !== null) {
    return 'Entity kind PARTY must not carry a riding number.';
  }
  if (entityKind !== 'PARTY' && ridingNumber === null) {
    return `Entity kind ${entityKind} requires a riding number.`;
  }
  return null;
}

/**
 * Contribution detail (ticket 1.5, screens.md 3): Qomon facts read-only,
 * metadata editable with a mandatory reason, allocations/receipts, RTD
 * inclusions, WorkItems, and the change-log slice for this contribution.
 * Sync state and a "refresh from Qomon" action.
 */

function money(cents: number): string {
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

/** A starting point only — the issuer can (and for CA/campaign, must) change
 * it. The exact EO-facing wording is a compliance question, not something to
 * bake in silently (see PHASE-3-NOTES.md). */
function defaultPoliticalEntityLabel(entityKind: string): string {
  return entityKind === 'PARTY' ? 'Green Party of Ontario' : '';
}

export function ContributionDetailPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['contribution', id],
    queryFn: () => api.getContribution(id),
  });
  const periods = useQuery({ queryKey: ['admin-periods'], queryFn: api.listPeriods });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Omit<MetadataEditInput, 'reason'> | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [receiptReason, setReceiptReason] = useState('');
  const [receiptAmount, setReceiptAmount] = useState<number | ''>('');
  const [receiptDelivery, setReceiptDelivery] = useState<'MAIL' | 'EMAIL'>('MAIL');
  const [politicalEntityLabel, setPoliticalEntityLabel] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const detail = query.data;
  const activeForm =
    form ??
    (detail?.metadata
      ? {
          periodId: detail.metadata.periodId,
          ridingNumber: detail.metadata.ridingNumber,
          entityKind: detail.metadata.entityKind,
          receivedBy: detail.metadata.receivedBy,
          goodsServices: detail.metadata.goodsServices,
          nonDeductibleCents: detail.metadata.nonDeductibleCents,
          processedDate: detail.metadata.processedDate,
          sourceCode: detail.metadata.sourceCode,
          eoContributorId: detail.metadata.eoContributorId,
          exceptionReason: detail.metadata.exceptionReason,
          // external_ref lives on the Contribution row itself (a cache of
          // metadata.external_ref, data-model §2), not on ContributionMetadata
          externalRef: detail.externalRef,
        }
      : null);

  const periodOptions = periods.data?.data.map((p) => ({ value: String(p.id), label: p.name })) ?? [];
  const periodSelectData =
    activeForm && !periodOptions.some((o) => o.value === String(activeForm.periodId))
      ? [...periodOptions, { value: String(activeForm.periodId), label: `Period ${activeForm.periodId} (not in list)` }]
      : periodOptions;

  function updateForm<K extends keyof Omit<MetadataEditInput, 'reason'>>(
    key: K,
    value: Omit<MetadataEditInput, 'reason'>[K],
  ) {
    if (!activeForm) return;
    setForm({ ...activeForm, [key]: value });
  }

  const [refreshOutcome, setRefreshOutcome] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useMutation({
    mutationFn: () => api.refreshContribution(id),
    onSuccess: ({ outcome }) => {
      setRefreshError(null);
      setRefreshOutcome(outcome);
      return qc.invalidateQueries({ queryKey: ['contribution', id] });
    },
    onError: (err) => {
      setRefreshOutcome(null);
      setRefreshError(err instanceof ApiError ? err.message : 'Failed to refresh from Qomon.');
    },
  });

  const save = useMutation({
    mutationFn: () => {
      if (!activeForm) throw new Error('nothing to save');
      return api.editContributionMetadata(id, { ...activeForm, reason });
    },
    onSuccess: () => {
      setEditError(null);
      setReason('');
      setForm(null);
      return qc.invalidateQueries({ queryKey: ['contribution', id] });
    },
    onError: (err) => {
      setEditError(err instanceof ApiError ? err.message : 'Failed to save.');
    },
  });

  const issueReceipt = useMutation({
    mutationFn: () => {
      const effectiveLabel = (
        politicalEntityLabel ?? defaultPoliticalEntityLabel(detail?.metadata?.entityKind ?? '')
      ).trim();
      return api.issueReceipt(id, {
        reason: receiptReason,
        amountCents: receiptAmount === '' ? undefined : Math.round(receiptAmount * 100),
        delivery: receiptDelivery,
        politicalEntityLabel: effectiveLabel,
      });
    },
    onSuccess: () => {
      setReceiptError(null);
      setReceiptReason('');
      setReceiptAmount('');
      setPoliticalEntityLabel(null);
      return qc.invalidateQueries({ queryKey: ['contribution', id] });
    },
    onError: (err) => {
      setReceiptError(err instanceof ApiError ? err.message : 'Failed to issue receipt.');
    },
  });

  if (query.isLoading) return <Loader />;
  if (query.isError || !detail) return <Text c="red">Contribution not found.</Text>;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Contribution</Title>
        <Anchor to="/contributions">&larr; Back to list</Anchor>
      </Group>

      <Card withBorder>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600}>Qomon facts</Text>
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                last synced: {detail.lastSyncedAt ? new Date(detail.lastSyncedAt).toLocaleString() : 'never'}
              </Text>
              <Button
                size="xs"
                variant="light"
                onClick={() => {
                  setRefreshOutcome(null);
                  refresh.mutate();
                }}
                loading={refresh.isPending}
              >
                Refresh from Qomon
              </Button>
            </Group>
          </Group>
          {refreshOutcome && (
            <Text size="xs" c="green">
              Refreshed — outcome: {refreshOutcome}.
            </Text>
          )}
          {refreshError && <Alert color="red">{refreshError}</Alert>}
          {detail.deletedInQomonAt && (
            <Alert color="red">
              Sync incident: absent from Qomon as of {new Date(detail.deletedInQomonAt).toLocaleString()}.
            </Alert>
          )}
          <Group grow>
            <Text>Donor: {detail.contact.name}</Text>
            <Text>Amount: {money(detail.amountCents)}</Text>
            <Text>Accepted: {new Date(detail.acceptedAt).toLocaleDateString()}</Text>
            <Text>Status: {detail.statusKind}</Text>
          </Group>
          <Group grow>
            <Text>Payment method: {detail.paymentMethodKind ?? '—'}</Text>
            <Text>Code campaign: {detail.codeCampaign ?? '—'}</Text>
            <Text>External ref: {detail.externalRef ?? '—'}</Text>
          </Group>
          <Text size="sm" c={detail.contact.address ? undefined : 'orange'}>
            Address on file:{' '}
            {detail.contact.address
              ? `${detail.contact.address.line1}, ${detail.contact.address.city} ${detail.contact.address.province} ${detail.contact.address.postalCode}, ${detail.contact.address.country}`
              : 'none — a receipt cannot be issued until this donor has an address in Qomon'}
          </Text>
          {detail.comment && <Text size="sm">Comment: {detail.comment}</Text>}
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="sm">
          <Text fw={600}>Metadata</Text>
          {!activeForm ? (
            <Text c="dimmed">
              No metadata yet — this contribution is waiting on intake derivation.
            </Text>
          ) : (
            <>
              <Group grow align="flex-start">
                <NativeSelect
                  label={<FieldLabel label="Recipient kind" help={METADATA_HELP.entityKind} />}
                  data={RECIPIENT_KIND_OPTIONS}
                  value={activeForm.entityKind}
                  onChange={(e) => {
                    const entityKind = e.currentTarget.value;
                    setForm({
                      ...activeForm,
                      entityKind,
                      // Rule A2: a party-level recipient never carries a riding number.
                      ridingNumber: entityKind === 'PARTY' ? null : activeForm.ridingNumber,
                    });
                  }}
                />
                <NumberInput
                  label={
                    <FieldLabel
                      label="Riding number"
                      help={METADATA_HELP.ridingNumber}
                      required={activeForm.entityKind !== 'PARTY'}
                    />
                  }
                  min={1}
                  max={124}
                  required={activeForm.entityKind !== 'PARTY'}
                  withAsterisk={false}
                  disabled={activeForm.entityKind === 'PARTY'}
                  placeholder={activeForm.entityKind === 'PARTY' ? 'N/A for party' : undefined}
                  value={activeForm.ridingNumber ?? undefined}
                  onChange={(v) => updateForm('ridingNumber', typeof v === 'number' ? v : null)}
                  error={a2RidingEntityWarning(activeForm.entityKind, activeForm.ridingNumber)}
                />
                <NativeSelect
                  label={<FieldLabel label="Received by" help={METADATA_HELP.receivedBy} />}
                  data={receivedByOptions(activeForm.entityKind)}
                  value={activeForm.receivedBy}
                  onChange={(e) => updateForm('receivedBy', e.currentTarget.value)}
                />
                <NativeSelect
                  label={<FieldLabel label="Period" help={METADATA_HELP.periodId} />}
                  data={periodSelectData}
                  disabled={periods.isLoading}
                  value={String(activeForm.periodId)}
                  onChange={(e) => updateForm('periodId', Number(e.currentTarget.value))}
                />
              </Group>
              <Group grow align="flex-end">
                <NumberInput
                  label={<FieldLabel label="Non-deductible ($)" help={METADATA_HELP.nonDeductibleCents} />}
                  value={activeForm.nonDeductibleCents / 100}
                  onChange={(v) =>
                    updateForm('nonDeductibleCents', typeof v === 'number' ? Math.round(v * 100) : 0)
                  }
                />
                <Checkbox
                  label={<FieldLabel label="Goods & services" help={METADATA_HELP.goodsServices} />}
                  checked={activeForm.goodsServices}
                  onChange={(e) => updateForm('goodsServices', e.currentTarget.checked)}
                />
                <TextInput
                  label={<FieldLabel label="Source code" help={METADATA_HELP.sourceCode} />}
                  value={activeForm.sourceCode}
                  onChange={(e) => updateForm('sourceCode', e.currentTarget.value)}
                />
              </Group>
              <TextInput
                label="Reason for this edit (required)"
                placeholder="e.g. CFO subspace intake review"
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
              {editError && <Alert color="red">{editError}</Alert>}
              <Group>
                <Button
                  onClick={() => save.mutate()}
                  loading={save.isPending}
                  disabled={reason.trim().length < 3}
                >
                  Save metadata
                </Button>
                {form && (
                  <Button variant="subtle" onClick={() => setForm(null)}>
                    Discard changes
                  </Button>
                )}
              </Group>
            </>
          )}
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
                  <Table.Td>{w.ruleRef ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge color={w.status === 'OPEN' ? 'orange' : w.status === 'EXCEPTION' ? 'yellow' : 'green'}>
                      {w.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{new Date(w.openedAt).toLocaleDateString()}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Card withBorder>
        <Stack gap="sm">
          <Text fw={600}>Allocations &amp; receipts</Text>
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
                    <Table.Td>{new Date(a.receipt.issueDate).toLocaleDateString()}</Table.Td>
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
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          {me.data?.can.issueReceipts && (
            <>
              <Text fw={600} mt="sm">
                Issue a receipt
              </Text>
              {!detail.metadata ? (
                <Text c="dimmed">Waiting on metadata (intake derivation) before a receipt can be issued.</Text>
              ) : remainingEligibleCents(detail) <= 0 ? (
                <Text c="dimmed">Nothing left to receipt — the full eligible amount is already issued.</Text>
              ) : (
                <>
                  <Text size="sm" c="dimmed">
                    Remaining eligible: {money(remainingEligibleCents(detail))}
                  </Text>
                  <Group grow align="flex-start">
                    <NumberInput
                      label="Amount ($, blank = full remaining amount)"
                      min={0.01}
                      max={remainingEligibleCents(detail) / 100}
                      value={receiptAmount}
                      onChange={(v) => setReceiptAmount(typeof v === 'number' ? v : '')}
                    />
                    <NativeSelect
                      label="Delivery"
                      data={[
                        { value: 'MAIL', label: 'Mail' },
                        { value: 'EMAIL', label: 'Email' },
                      ]}
                      value={receiptDelivery}
                      onChange={(e) => setReceiptDelivery(e.currentTarget.value as 'MAIL' | 'EMAIL')}
                    />
                    <TextInput
                      label="Received-by label (as it should print on the receipt)"
                      placeholder="e.g. Green Party of Ontario"
                      value={politicalEntityLabel ?? defaultPoliticalEntityLabel(detail.metadata.entityKind)}
                      onChange={(e) => setPoliticalEntityLabel(e.currentTarget.value)}
                    />
                  </Group>
                  <TextInput
                    label="Reason for issuing this receipt (required)"
                    placeholder="e.g. donor requested annual receipt"
                    value={receiptReason}
                    onChange={(e) => setReceiptReason(e.currentTarget.value)}
                  />
                  {receiptError && <Alert color="red">{receiptError}</Alert>}
                  <Group>
                    <Button
                      onClick={() => issueReceipt.mutate()}
                      loading={issueReceipt.isPending}
                      disabled={
                        receiptReason.trim().length < 3 ||
                        (politicalEntityLabel ?? defaultPoliticalEntityLabel(detail.metadata.entityKind)).trim()
                          .length === 0
                      }
                    >
                      Issue receipt
                    </Button>
                  </Group>
                </>
              )}
            </>
          )}
        </Stack>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Change-log
        </Text>
        {detail.changeLog.length === 0 ? (
          <Text c="dimmed">None yet.</Text>
        ) : (
          <Stack gap="xs">
            {detail.changeLog.map((c) => (
              <Group key={c.id} justify="space-between" wrap="nowrap">
                <Text size="sm">{c.reason}</Text>
                <Text size="xs" c="dimmed">
                  {new Date(c.at).toLocaleString()}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

function Anchor({ to, children }: { to: '/contributions'; children: React.ReactNode }) {
  return (
    <Link to={to}>
      <Text span c="blue" size="sm">
        {children}
      </Text>
    </Link>
  );
}
