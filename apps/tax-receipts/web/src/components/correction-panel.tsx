import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  NativeSelect,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  api,
  ApiError,
  type ContactHit,
  type ContributionDetail,
  type CorrectionPart,
  type CorrectionPlan,
  type CorrectionRequest,
  type CorrectionResult,
  type ReallocationProposal,
} from '../api.js';

/**
 * Correct a contribution (screens.md screen 8, corrections.md actions 4, 5, 8,
 * 9, 10, 12). Every action is the same two steps: preview the whole cascade
 * (nothing is written), then commit exactly what was previewed. The tool never
 * writes a correction back to Qomon (D12); the preview lists what Qomon will
 * still show.
 */

type ActionKey = 'CORRECT_AMOUNT' | 'MOVE' | 'SPLIT_CONTRIBUTION' | 'REALLOCATE' | 'REFUND' | 'MERGE_CONTACTS';

const ACTION_LABELS: Record<ActionKey, string> = {
  CORRECT_AMOUNT: 'Correct the amount',
  MOVE: 'Move to another donor',
  SPLIT_CONTRIBUTION: 'Split between donors or entities',
  REALLOCATE: 'Reallocate to another entity (over-limit)',
  REFUND: 'Refund',
  MERGE_CONTACTS: 'Merge this donor into another contact',
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function entityText(entityKind: string, ridingNumber: number | null): string {
  return entityKind === 'PARTY' ? 'Party' : `${entityKind} ${ridingNumber ?? '?'}`;
}

/** A donor search: type two letters, pick a contact. Merged-away contacts are
 *  never offered by the server. */
function DonorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ContactHit | null;
  onChange: (hit: ContactHit | null) => void;
}) {
  const [search, setSearch] = useState('');
  const hits = useQuery({
    queryKey: ['contact-search', search],
    queryFn: () => api.searchContacts(search),
    enabled: search.trim().length >= 2,
  });
  const found = hits.data?.data ?? [];
  const options = [...(value && !found.some((h) => h.id === value.id) ? [value] : []), ...found].map((h) => ({
    value: h.id,
    label: `${h.name}${h.email ? ` (${h.email})` : ''}`,
  }));
  return (
    <Select
      label={label}
      placeholder="Search by name or email"
      searchable
      clearable
      data={options}
      filter={({ options: all }) => all}
      nothingFoundMessage={search.trim().length < 2 ? 'Type at least two letters' : 'No matching contact'}
      value={value?.id ?? null}
      searchValue={search}
      onSearchChange={setSearch}
      onChange={(id) => onChange(id ? (found.find((h) => h.id === id) ?? value) : null)}
    />
  );
}

interface PartDraft {
  amount: number | '';
  contact: ContactHit | null;
  entityKind: 'PARTY' | 'CA' | 'CAMPAIGN';
  ridingNumber: string | null;
}

function CascadeView({ plan }: { plan: CorrectionPlan }) {
  return (
    <Stack gap="xs">
      {plan.blockers.length > 0 && (
        <Alert color="red" title="Blocked">
          <List size="sm">
            {plan.blockers.map((b) => (
              <List.Item key={b}>{b}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      <Text fw={600} size="sm">
        Contributions
      </Text>
      {plan.changes.length === 0 ? (
        <Text size="sm" c="dimmed">
          No contribution changes.
        </Text>
      ) : (
        <Table withRowBorders={false} verticalSpacing={2}>
          <Table.Tbody>
            {plan.changes.map((c) => (
              <Table.Tr key={c.contributionId}>
                <Table.Td>
                  {c.before.contactName}, {money(c.before.amountCents)}, {entityText(c.before.entityKind, c.before.ridingNumber)}
                </Table.Td>
                <Table.Td>{c.kind === 'refund' ? <Badge color="grey">refunded</Badge> : 'becomes'}</Table.Td>
                <Table.Td>
                  {c.replacements.map((r) => (
                    <div key={r.ref}>
                      {r.contactName}, {money(r.amountCents)}, {entityText(r.entityKind, r.ridingNumber)}
                    </div>
                  ))}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {plan.payments.map((p) => (
        <Text key={p.paymentId} size="sm">
          Payment: {money(p.amountBeforeCents)} → {money(p.amountAfterCents)}
          {p.stateAfter !== p.stateBefore ? `, ${p.stateBefore} → ${p.stateAfter}` : ''}
        </Text>
      ))}
      <Text fw={600} size="sm">
        Receipts
      </Text>
      {plan.cancelReceipts.length === 0 && plan.issueReceipts.length === 0 ? (
        <Text size="sm" c="dimmed">
          None affected: nothing had been receipted.
        </Text>
      ) : (
        <List size="sm">
          {plan.cancelReceipts.map((c) => (
            <List.Item key={c.receiptId}>
              Cancel {c.receiptNumber} ({c.contactName}, {money(c.totalAmountCents)}
              {c.hasPdf ? '; a watermarked notice is stored' : ''})
            </List.Item>
          ))}
          {plan.issueReceipts.map((r) => (
            <List.Item key={r.key}>
              Issue a receipt to {r.contactName} for {money(r.totalAmountCents)} ({entityText(r.entityKind, r.ridingNumber)})
              {r.replacesReceiptNumber ? `; it says it cancels and replaces ${r.replacesReceiptNumber}` : ''}
            </List.Item>
          ))}
        </List>
      )}
      {plan.owedToEo.length > 0 && (
        <>
          <Text fw={600} size="sm">
            Owed to EO
          </Text>
          <List size="sm">
            {plan.owedToEo.map((o) => (
              <List.Item key={o.description}>
                <Badge size="xs" mr={4}>
                  {o.kind === 'DC1A' ? 'DC-1A' : 'return note'}
                </Badge>
                {o.description}
              </List.Item>
            ))}
          </List>
        </>
      )}
      {plan.dirtyReports.length > 0 && (
        <Text size="sm">
          {plan.dirtyReports.length} generated entity report{plan.dirtyReports.length === 1 ? '' : 's'} will need regenerating
          {plan.dirtyReports.some((r) => r.filed) ? ' (at least one is already in a filed return)' : ''}.
        </Text>
      )}
      {plan.followUps.map((f) => (
        <Alert key={f} color="blue" variant="light">
          {f}
        </Alert>
      ))}
    </Stack>
  );
}

export function CorrectionPanel({
  detail,
  canFile,
  onDone,
}: {
  detail: ContributionDetail;
  /** may sign off a reallocation between entities */
  canFile: boolean;
  onDone: () => void;
}) {
  const [action, setAction] = useState<ActionKey>('CORRECT_AMOUNT');
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState('Green Party of Ontario');
  const [entityLabels, setEntityLabels] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState<number | ''>('');
  const [fixPayment, setFixPayment] = useState(false);
  const [nonDeductible, setNonDeductible] = useState<number | ''>('');
  const [moveTo, setMoveTo] = useState<ContactHit | null>(null);
  const [survivor, setSurvivor] = useState<ContactHit | null>(null);
  const [evidence, setEvidence] = useState('');
  const [parts, setParts] = useState<PartDraft[]>([]);
  const [plan, setPlan] = useState<CorrectionPlan | null>(null);
  const [result, setResult] = useState<CorrectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ReallocationProposal | null>(null);

  const currentEntity = (detail.metadata?.entityKind ?? 'PARTY') as PartDraft['entityKind'];
  const currentRiding = detail.metadata?.ridingNumber ?? null;

  /** any input change invalidates a preview: the commit is exactly what was previewed */
  function edit<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPlan(null);
      setResult(null);
      setError(null);
    };
  }

  function changeAction(next: ActionKey) {
    setAction(next);
    setPlan(null);
    setResult(null);
    setError(null);
    if (next === 'SPLIT_CONTRIBUTION') {
      setParts([
        { amount: '', contact: null, entityKind: currentEntity, ridingNumber: currentRiding === null ? null : String(currentRiding) },
        { amount: '', contact: null, entityKind: currentEntity, ridingNumber: currentRiding === null ? null : String(currentRiding) },
      ]);
    } else if (next === 'REALLOCATE') {
      setParts([{ amount: detail.amountCents / 100, contact: null, entityKind: 'CA', ridingNumber: null }]);
    }
  }

  function toParts(): CorrectionPart[] {
    return parts.map((p) => ({
      amountCents: Math.round((p.amount === '' ? 0 : p.amount) * 100),
      ...(p.contact ? { contactId: p.contact.id } : {}),
      entityKind: p.entityKind,
      ridingNumber: p.entityKind === 'PARTY' ? null : p.ridingNumber === null ? null : Number(p.ridingNumber),
    }));
  }

  function buildRequest(): CorrectionRequest | string {
    if (reason.trim().length < 3) return 'Give a reason (at least three characters).';
    const common = {
      reason,
      ...(label.trim() ? { politicalEntityLabel: label.trim() } : {}),
      ...(Object.keys(entityLabels).length > 0 ? { entityLabels } : {}),
    };
    switch (action) {
      case 'CORRECT_AMOUNT': {
        if (amount === '') return 'Enter the corrected amount.';
        const cents = Math.round(amount * 100);
        return {
          ...common,
          action,
          contributionId: detail.id,
          amountCents: cents,
          ...(nonDeductible !== '' ? { nonDeductibleCents: Math.round(nonDeductible * 100) } : {}),
          ...(fixPayment ? { paymentAmountCents: cents } : {}),
        };
      }
      case 'MOVE':
        if (!moveTo) return 'Pick the donor it belongs to.';
        return { ...common, action, contributionIds: [detail.id], toContactId: moveTo.id };
      case 'SPLIT_CONTRIBUTION':
      case 'REALLOCATE':
        if (parts.some((p) => p.amount === '' || p.amount <= 0)) return 'Every part needs an amount.';
        if (parts.some((p) => p.entityKind !== 'PARTY' && p.ridingNumber === null)) return 'A CA or campaign part needs its riding number.';
        return { ...common, action, contributionId: detail.id, parts: toParts() };
      case 'REFUND':
        return { ...common, action, paymentId: detail.payment.id };
      case 'MERGE_CONTACTS':
        if (!survivor) return 'Pick the contact to merge into.';
        return {
          ...common,
          action,
          survivorId: survivor.id,
          mergedAwayId: detail.contact.id,
          ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
        };
    }
  }

  const preview = useMutation({
    mutationFn: async () => {
      const body = buildRequest();
      if (typeof body === 'string') throw new Error(body);
      return api.previewCorrection(body);
    },
    onSuccess: (p) => {
      setPlan(p);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Preview failed.'),
  });

  const commit = useMutation({
    mutationFn: async () => {
      const body = buildRequest();
      if (typeof body === 'string') throw new Error(body);
      return api.applyCorrection(body);
    },
    onSuccess: (r) => {
      setResult(r);
      setPlan(null);
      setError(null);
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : 'Correction failed.'),
  });

  async function loadProposal() {
    try {
      setProposal(await api.reallocationProposal(detail.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the proposal.');
    }
  }

  function useOption(o: ReallocationProposal['options'][number]) {
    const keep = detail.amountCents - o.moveCents;
    const next: PartDraft[] = [];
    if (keep > 0) {
      next.push({ amount: keep / 100, contact: null, entityKind: currentEntity, ridingNumber: currentRiding === null ? null : String(currentRiding) });
    }
    next.push({ amount: o.moveCents / 100, contact: null, entityKind: o.entityKind, ridingNumber: o.ridingNumber === null ? null : String(o.ridingNumber) });
    setParts(next);
    setPlan(null);
  }

  const partsTotal = parts.reduce((sum, p) => sum + (p.amount === '' ? 0 : Math.round(p.amount * 100)), 0);

  function partsEditor() {
    return (
      <Stack gap="xs">
        {parts.map((p, i) => (
          <Group key={i} align="flex-end" grow>
            <NumberInput
              label={`Part ${i + 1} amount ($)`}
              min={0.01}
              decimalScale={2}
              value={p.amount}
              onChange={(v) => edit(setParts)(parts.map((x, j) => (j === i ? { ...x, amount: typeof v === 'number' ? v : '' } : x)))}
            />
            {action === 'SPLIT_CONTRIBUTION' && (
              <DonorPicker
                label="Donor (blank = the current donor)"
                value={p.contact}
                onChange={(hit) => edit(setParts)(parts.map((x, j) => (j === i ? { ...x, contact: hit } : x)))}
              />
            )}
            <NativeSelect
              label="Entity"
              data={[
                { value: 'PARTY', label: 'Party' },
                { value: 'CA', label: 'Constituency association' },
                { value: 'CAMPAIGN', label: 'Campaign' },
              ]}
              value={p.entityKind}
              onChange={(e) =>
                edit(setParts)(
                  parts.map((x, j) => (j === i ? { ...x, entityKind: e.currentTarget.value as PartDraft['entityKind'] } : x)),
                )
              }
            />
            <NumberInput
              label="Riding (1 to 124)"
              min={1}
              max={124}
              disabled={p.entityKind === 'PARTY'}
              value={p.entityKind === 'PARTY' ? '' : (p.ridingNumber ?? '')}
              onChange={(v) =>
                edit(setParts)(parts.map((x, j) => (j === i ? { ...x, ridingNumber: typeof v === 'number' ? String(v) : null } : x)))
              }
            />
          </Group>
        ))}
        <Group>
          {action === 'SPLIT_CONTRIBUTION' && (
            <Button size="xs" variant="light" onClick={() => edit(setParts)([...parts, { amount: '', contact: null, entityKind: currentEntity, ridingNumber: currentRiding === null ? null : String(currentRiding) }])}>
              Add a part
            </Button>
          )}
          <Text size="sm" c={partsTotal === detail.amountCents ? 'green' : 'orange'}>
            Parts total {money(partsTotal)} of {money(detail.amountCents)}
          </Text>
        </Group>
      </Stack>
    );
  }

  if (result) {
    return (
      <Card withBorder>
        <Stack gap="sm">
          <Alert color="green" title="Correction committed">
            {result.createdContributionIds.length} contribution{result.createdContributionIds.length === 1 ? '' : 's'} created,{' '}
            {result.cancelledReceiptIds.length} receipt{result.cancelledReceiptIds.length === 1 ? '' : 's'} cancelled,{' '}
            {result.issuedReceipts.length === 0
              ? 'no receipts issued'
              : `issued ${result.issuedReceipts.map((r) => r.receiptNumber).join(', ')}`}
            {result.owedToEoWorkItemIds.length > 0 ? `; ${result.owedToEoWorkItemIds.length} owed-to-EO item(s) queued` : ''}.
          </Alert>
          {result.followUps.map((f) => (
            <Alert key={f} color="blue" variant="light">
              {f}
            </Alert>
          ))}
          {result.validationFailures.length > 0 && (
            <Alert color="orange">
              The correction is committed, but validating {result.validationFailures.length} replacement(s) failed; the
              nightly pass will retry.
            </Alert>
          )}
          {result.createdContributionIds.length > 0 && (
            <Group gap="md">
              <Text size="sm">Replacement{result.createdContributionIds.length === 1 ? '' : 's'}:</Text>
              {result.createdContributionIds.map((cid, i) => (
                <Link key={cid} to="/contributions/$id" params={{ id: cid }}>
                  {result.createdContributionIds.length === 1 ? 'open it' : `part ${i + 1}`}
                </Link>
              ))}
            </Group>
          )}
        </Stack>
      </Card>
    );
  }

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text fw={600}>Correct this contribution</Text>
        <Text size="sm" c="dimmed">
          A correction never edits the contribution in place: it is replaced by new rows, affected receipts are cancelled and
          reissued, and anything EO has already seen is queued for the owed-to-EO list. Preview it first.
        </Text>
        <NativeSelect
          label="Action"
          data={(Object.keys(ACTION_LABELS) as ActionKey[])
            .filter((k) => k !== 'REALLOCATE' || canFile)
            .map((k) => ({ value: k, label: ACTION_LABELS[k] }))}
          value={action}
          onChange={(e) => changeAction(e.currentTarget.value as ActionKey)}
        />

        {action === 'CORRECT_AMOUNT' && (
          <Group grow align="flex-end">
            <NumberInput
              label={`Corrected amount ($); now ${money(detail.amountCents)}`}
              min={0.01}
              decimalScale={2}
              value={amount}
              onChange={(v) => edit(setAmount)(typeof v === 'number' ? v : '')}
            />
            {detail.metadata && detail.metadata.nonDeductibleCents > 0 && (
              <NumberInput
                label={`Non-deductible ($); now ${money(detail.metadata.nonDeductibleCents)}`}
                min={0}
                decimalScale={2}
                value={nonDeductible}
                onChange={(v) => edit(setNonDeductible)(typeof v === 'number' ? v : '')}
              />
            )}
            <NativeSelect
              label="The payment itself was mis-keyed"
              data={[
                { value: 'no', label: 'No, only the contribution' },
                { value: 'yes', label: `Yes, correct the payment (${money(detail.payment.amountCents)}) too` },
              ]}
              value={fixPayment ? 'yes' : 'no'}
              onChange={(e) => edit(setFixPayment)(e.currentTarget.value === 'yes')}
            />
          </Group>
        )}

        {action === 'MOVE' && <DonorPicker label="Move to donor" value={moveTo} onChange={edit(setMoveTo)} />}

        {(action === 'SPLIT_CONTRIBUTION' || action === 'REALLOCATE') && partsEditor()}

        {action === 'REALLOCATE' && (
          <Stack gap="xs">
            <Group>
              <Button size="xs" variant="light" onClick={loadProposal}>
                Show over-limit proposal
              </Button>
            </Group>
            {proposal &&
              (proposal.overLimitBucket ? (
                <Stack gap={4}>
                  <Text size="sm">
                    Over the {proposal.overLimitBucket.bucket} limit by {money(proposal.overLimitBucket.overageCents)} (
                    {money(proposal.overLimitBucket.aggregateCents)} against {money(proposal.overLimitBucket.limitCents)}).
                  </Text>
                  {proposal.options.map((o) => (
                    <Group key={`${o.entityKind}:${o.ridingNumber ?? 'new'}`} gap="xs">
                      <Text size="sm">
                        Move {money(o.moveCents)} to {entityText(o.entityKind, o.ridingNumber)}
                        {o.needsRiding ? ' (choose the riding)' : ''}; room for {money(o.headroomCents)}.
                      </Text>
                      <Button size="compact-xs" variant="subtle" onClick={() => useOption(o)}>
                        Use this
                      </Button>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  This contribution is not over any limit.
                </Text>
              ))}
            <Text size="xs" c="dimmed">
              A reallocation needs a filer's sign-off: committing it records you as the one who signed off.
            </Text>
          </Stack>
        )}

        {action === 'REFUND' && (
          <Text size="sm">
            Marks this payment ({money(detail.payment.amountCents)}) and its contributions refunded, and cancels any receipt
            for them. The money moves in the processor; the tool only records it.
          </Text>
        )}

        {action === 'MERGE_CONTACTS' && (
          <Stack gap="xs">
            <DonorPicker label={`Merge ${detail.contact.name} into`} value={survivor} onChange={edit(setSurvivor)} />
            <TextInput
              label="Evidence they are the same person (required if anything was RTD-reported)"
              value={evidence}
              onChange={(e) => edit(setEvidence)(e.currentTarget.value)}
            />
            <Text size="xs" c="dimmed">
              This moves all of this donor's contributions to the surviving contact. Nothing is deleted, and the merge can
              be reversed.
            </Text>
          </Stack>
        )}

        <Group grow align="flex-start">
          <TextInput
            label="Reason (required)"
            placeholder="e.g. cheque was for $80, keyed as $100"
            value={reason}
            onChange={(e) => edit(setReason)(e.currentTarget.value)}
          />
          <TextInput
            label="Received-by label on any new receipt"
            value={label}
            onChange={(e) => edit(setLabel)(e.currentTarget.value)}
          />
        </Group>

        {plan?.labelsNeeded
          .filter((n) => n.entityKind !== 'PARTY')
          .map((n) => (
            <TextInput
              key={n.key}
              label={`Received-by label for ${entityText(n.entityKind, n.ridingNumber)} receipts`}
              value={entityLabels[n.key] ?? ''}
              onChange={(e) => {
                setEntityLabels({ ...entityLabels, [n.key]: e.currentTarget.value });
              }}
            />
          ))}

        {error && <Alert color="red">{error}</Alert>}
        {plan && <CascadeView plan={plan} />}

        <Group>
          <Button variant="light" onClick={() => preview.mutate()} loading={preview.isPending}>
            Preview cascade
          </Button>
          <Button
            color="orange"
            onClick={() => commit.mutate()}
            loading={commit.isPending}
            disabled={!plan || plan.blockers.length > 0}
          >
            Commit correction
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
