import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert, Button, Card, Group, Loader, NativeSelect, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { api, ApiError, type ContactHit, type IntakeFlag, type PaymentMethodKey } from '../api.js';
import { DonorPicker } from '../components/donor-picker.js';
import {
  ContributionFields,
  dollarsToCents,
  emptyRow,
  dateToInstant,
  rowProblem,
  rowToEntry,
  todayIso,
  type ContributionRow,
} from '../components/contribution-fields.js';
import { PageHeader } from '../components/PageHeader.js';
import { money } from './contribution-detail.js';

/**
 * Manual entry (D12, screens.md): record a payment and attribute it to one or
 * more contributions, or attribute what is left of a payment already on file.
 * The tool owns payments and contributions; nothing here touches Qomon. Fields
 * left on "derived" (the period, chiefly) are settled by the same intake
 * derivation the Qomon import uses.
 */

const METHODS: Array<{ value: PaymentMethodKey; label: string }> = [
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
  { value: 'CASH', label: 'Cash' },
  { value: 'PAD', label: 'Pre-authorized debit' },
  { value: 'EFT', label: 'Bank transfer (EFT)' },
  { value: 'IN_KIND', label: 'In kind' },
  { value: 'OTHER', label: 'Other' },
];

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

function FlagNotes({ flags }: { flags: IntakeFlag[] }) {
  const worth = flags.filter((f) => f.field === 'period_id');
  if (worth.length === 0) return null;
  return (
    <Alert color="orange">
      {worth.map((f) => (
        <div key={f.reason}>{f.reason}</div>
      ))}
    </Alert>
  );
}

export function NewPaymentPage() {
  const qc = useQueryClient();
  const [donor, setDonor] = useState<ContactHit | null>(null);
  const [amount, setAmount] = useState<number | ''>('');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [method, setMethod] = useState<PaymentMethodKey>('CHEQUE');
  const [externalRef, setExternalRef] = useState('');
  const [payerName, setPayerName] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<ContributionRow[]>([emptyRow(1)]);
  const [nextKey, setNextKey] = useState(2);
  const [error, setError] = useState<string | null>(null);

  const split = rows.length > 1;
  const paymentCents = dollarsToCents(amount);
  const rowCents = (r: ContributionRow) => (split ? dollarsToCents(r.amount) : paymentCents);
  const attributedCents = rows.reduce((sum, r) => sum + rowCents(r), 0);

  const save = useMutation({
    mutationFn: () => {
      if (!donor) throw new Error('Pick the donor who paid.');
      if (paymentCents <= 0) throw new Error('Enter the payment amount.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) throw new Error('Enter the date the payment was received.');
      if (reason.trim().length < 3) throw new Error('Give a reason (at least three characters).');
      if (attributedCents > paymentCents) {
        throw new Error(`The contributions add up to ${money(attributedCents)}, more than the ${money(paymentCents)} payment.`);
      }
      for (const [i, r] of rows.entries()) {
        const problem = rowProblem(r, rowCents(r));
        if (problem) throw new Error(split ? `Contribution ${i + 1}: ${problem}` : problem);
      }
      return api.createPayment({
        reason: reason.trim(),
        contactId: donor.id,
        amountCents: paymentCents,
        receivedAt: dateToInstant(receivedOn),
        method,
        ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
        ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        contributions: rows.map((r) => rowToEntry(r, rowCents(r))),
      });
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['contributions'] });
    },
    onError: (err) => setError(errorText(err, 'Could not save the payment.')),
  });

  function reset() {
    save.reset();
    setDonor(null);
    setAmount('');
    setExternalRef('');
    setPayerName('');
    setNote('');
    setReason('');
    setRows([emptyRow(nextKey)]);
    setNextKey(nextKey + 1);
  }

  if (save.data) {
    const flags = save.data.contributions.flatMap((c) => c.flags);
    return (
      <Stack gap="lg">
        <PageHeader title="Payment recorded" backTo="/contributions" backLabel="Back to contributions" />
        <Card withBorder>
          <Stack gap="sm">
            <Alert color="green" title="Saved">
              {save.data.contributions.length === 1
                ? 'The payment and its contribution were recorded.'
                : `The payment and its ${save.data.contributions.length} contributions were recorded.`}
            </Alert>
            <FlagNotes flags={flags} />
            <Group gap="md">
              {save.data.contributions.map((c, i) => (
                <Link key={c.id} to="/contributions/$id" params={{ id: c.id }}>
                  {save.data.contributions.length === 1 ? 'Open the contribution' : `Contribution ${i + 1} (${money(c.amountCents)})`}
                </Link>
              ))}
            </Group>
            <Group>
              <Button onClick={reset}>Enter another payment</Button>
            </Group>
          </Stack>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <PageHeader title="Add a payment" backTo="/contributions" backLabel="Back to contributions" />

      <Card withBorder>
        <Stack gap="sm">
          <Text fw={600}>Payment</Text>
          <Group align="flex-start" grow>
            <DonorPicker label="Donor who paid" value={donor} onChange={setDonor} />
            <NumberInput
              label="Amount ($)"
              min={0.01}
              decimalScale={2}
              value={amount}
              onChange={(v) => setAmount(typeof v === 'number' ? v : '')}
            />
            <TextInput
              type="date"
              label="Received on"
              value={receivedOn}
              onChange={(e) => setReceivedOn(e.currentTarget.value)}
            />
            <NativeSelect
              label="Method"
              data={METHODS}
              value={method}
              onChange={(e) => setMethod(e.currentTarget.value as PaymentMethodKey)}
            />
          </Group>
          <Group align="flex-start" grow>
            <TextInput
              label="Cheque number or processor reference"
              placeholder="optional; used to match bank statements"
              value={externalRef}
              onChange={(e) => setExternalRef(e.currentTarget.value)}
            />
            <TextInput
              label="Payer name, if it differs from the donor"
              placeholder="e.g. Dana and Sam Donor"
              value={payerName}
              onChange={(e) => setPayerName(e.currentTarget.value)}
            />
            <TextInput label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          </Group>
        </Stack>
      </Card>

      {rows.map((row, i) => (
        <Card key={row.key} withBorder>
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>{split ? `Contribution ${i + 1}` : 'Contribution'}</Text>
              {split && (
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => setRows(rows.filter((r) => r.key !== row.key))}>
                  Remove
                </Button>
              )}
            </Group>
            {!split && (
              <Text size="sm" c="dimmed">
                Covers the whole payment{paymentCents > 0 ? ` (${money(paymentCents)})` : ''}. Split it if it belongs to more
                than one donor or entity.
              </Text>
            )}
            <ContributionFields
              row={row}
              onChange={(next) => setRows(rows.map((r) => (r.key === row.key ? next : r)))}
              fallbackDate={receivedOn}
              externalRef={externalRef}
              paymentDonorName={donor?.name ?? null}
              amountLabel="Amount ($)"
              amountDisabled={!split}
            />
          </Stack>
        </Card>
      ))}

      <Group>
        <Button
          variant="light"
          onClick={() => {
            setRows(rows.length === 1 ? [{ ...rows[0]!, amount: paymentCents > 0 ? paymentCents / 100 : '' }, emptyRow(nextKey)] : [...rows, emptyRow(nextKey)]);
            setNextKey(nextKey + 1);
          }}
        >
          {split ? 'Add another contribution' : 'Split across more contributions'}
        </Button>
        {split && (
          <Text size="sm" c={attributedCents > paymentCents ? 'red' : attributedCents === paymentCents ? 'green' : 'orange'}>
            {money(attributedCents)} of {money(paymentCents)} attributed
            {attributedCents < paymentCents ? '; the rest stays unattributed until you add it' : ''}
          </Text>
        )}
      </Group>

      <Card withBorder>
        <Stack gap="sm">
          <TextInput
            label="Reason (required)"
            placeholder="e.g. cheque received at the party office"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          {error && <Alert color="red">{error}</Alert>}
          <Group>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Save payment
            </Button>
            <Button variant="subtle" component={Link} to="/contributions">
              Cancel
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}

/** Attribute the part of an existing payment no contribution covers yet. */
export function AttributePaymentPage({ paymentId }: { paymentId: string }) {
  const qc = useQueryClient();
  const payment = useQuery({ queryKey: ['payment', paymentId], queryFn: () => api.getPayment(paymentId) });
  const [row, setRow] = useState<ContributionRow>(emptyRow(1));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const p = payment.data;
  const amountCents = row.amount === '' ? (p?.unattributedCents ?? 0) : dollarsToCents(row.amount);

  const save = useMutation({
    mutationFn: () => {
      if (!p) throw new Error('The payment has not loaded.');
      if (reason.trim().length < 3) throw new Error('Give a reason (at least three characters).');
      if (amountCents > p.unattributedCents) {
        throw new Error(`Only ${money(p.unattributedCents)} of this payment is unattributed.`);
      }
      const problem = rowProblem(row, amountCents);
      if (problem) throw new Error(problem);
      return api.addContributionToPayment(paymentId, { ...rowToEntry(row, amountCents), reason: reason.trim() });
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['payment', paymentId] });
      void qc.invalidateQueries({ queryKey: ['contributions'] });
    },
    onError: (err) => setError(errorText(err, 'Could not add the contribution.')),
  });

  if (payment.isLoading) return <Loader />;
  if (payment.isError || !p) return <Text c="red">Payment not found.</Text>;

  if (save.data) {
    return (
      <Stack gap="lg">
        <PageHeader title="Contribution added" backTo="/contributions" backLabel="Back to contributions" />
        <Card withBorder>
          <Stack gap="sm">
            <Alert color="green" title="Saved">
              {save.data.remainingCents > 0
                ? `${money(save.data.remainingCents)} of the payment is still unattributed.`
                : 'The whole payment is now attributed.'}
            </Alert>
            <FlagNotes flags={save.data.flags} />
            <Group gap="md">
              <Link to="/contributions/$id" params={{ id: save.data.contributionId }}>
                Open the contribution
              </Link>
              {save.data.remainingCents > 0 && (
                <Button
                  variant="light"
                  onClick={() => {
                    save.reset();
                    setRow(emptyRow(row.key + 1));
                    setReason('');
                  }}
                >
                  Attribute more of it
                </Button>
              )}
            </Group>
          </Stack>
        </Card>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <PageHeader title="Attribute the rest of a payment" backTo="/contributions" backLabel="Back to contributions" />
      <Card withBorder>
        <Stack gap={4}>
          <Text fw={600}>Payment</Text>
          <Text size="sm">
            {p.contactName} paid {money(p.amountCents)} on {new Date(p.receivedAt).toLocaleDateString()} ({p.method.toLowerCase()}
            {p.externalRef ? `, ${p.externalRef}` : ''}).
          </Text>
          <Text size="sm" c={p.unattributedCents > 0 ? 'orange' : 'green'}>
            {money(p.attributedCents)} attributed, {money(p.unattributedCents)} unattributed.
          </Text>
          {p.contributions.filter((c) => c.status === 'ACTIVE').map((c) => (
            <Text key={c.id} size="xs" c="dimmed">
              <Link to="/contributions/$id" params={{ id: c.id }}>
                {c.contactName}, {money(c.amountCents)}
              </Link>
            </Text>
          ))}
        </Stack>
      </Card>

      {p.unattributedCents <= 0 ? (
        <Alert color="blue">
          Every dollar of this payment is attributed. To change how it is split, correct one of its contributions.
        </Alert>
      ) : (
        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600}>New contribution</Text>
            <ContributionFields
              row={row}
              onChange={setRow}
              fallbackDate={p.receivedAt.slice(0, 10)}
              externalRef={p.externalRef ?? ''}
              paymentDonorName={p.contactName}
              amountLabel={`Amount ($, blank = the remaining ${money(p.unattributedCents)})`}
            />
            <TextInput
              label="Reason (required)"
              placeholder="e.g. the other half was Sam's"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            {error && <Alert color="red">{error}</Alert>}
            <Group>
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                Add contribution
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
