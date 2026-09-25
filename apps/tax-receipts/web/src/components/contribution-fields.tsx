import { useQuery } from '@tanstack/react-query';
import { Alert, Checkbox, Group, NativeSelect, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { api, type ContactHit, type ContributionEntryInput } from '../api.js';
import { DonorPicker } from './donor-picker.js';

/**
 * The fields of one contribution on the entry form (manual entry, D12): who it
 * is attributed to, how much, which entity and riding, and the descriptive
 * fields the operator may override. Anything left on "derived" is settled by
 * the same intake derivation the Qomon import uses; the preview line shows what
 * that will be before anything is saved.
 */

export interface ContributionRow {
  key: number;
  /** null = the payment's donor */
  donor: ContactHit | null;
  amount: number | '';
  /** YYYY-MM-DD; '' = the date the payment was received */
  acceptedOn: string;
  entityKind: 'PARTY' | 'CA' | 'CAMPAIGN';
  riding: number | '';
  /** '' = derive from the date */
  periodId: string;
  receivedBy: 'GPO' | 'ENTITY';
  goodsServices: boolean;
  nonDeductible: number | '';
  sourceCode: string;
  note: string;
}

export function emptyRow(key: number): ContributionRow {
  return {
    key,
    donor: null,
    amount: '',
    acceptedOn: '',
    entityKind: 'PARTY',
    riding: '',
    periodId: '',
    receivedBy: 'GPO',
    goodsServices: false,
    nonDeductible: '',
    sourceCode: '',
    note: '',
  };
}

/** A calendar date as an instant that is the same date in Ontario in any season
 *  (17:00 UTC is noon EST and 1pm EDT), so a date near a period boundary, such
 *  as December 31, cannot slip a day. */
export function dateToInstant(date: string): string {
  return `${date}T17:00:00.000Z`;
}

export function dollarsToCents(v: number | ''): number {
  return v === '' ? 0 : Math.round(v * 100);
}

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** What is wrong with a row, or null when it can be sent. */
export function rowProblem(row: ContributionRow, amountCents: number): string | null {
  if (amountCents <= 0) return 'Enter an amount.';
  if (row.entityKind !== 'PARTY' && row.riding === '') return 'A CA or campaign contribution needs its riding number.';
  if (dollarsToCents(row.nonDeductible) > amountCents) return 'The non-deductible portion cannot exceed the amount.';
  return null;
}

/** The request entry for a row. Entity and riding are always sent explicitly, so a
 *  riding read from a source code cannot contradict a party-level entity. */
export function rowToEntry(row: ContributionRow, amountCents: number): ContributionEntryInput {
  return {
    amountCents,
    ...(row.donor ? { contactId: row.donor.id } : {}),
    ...(row.acceptedOn ? { acceptedAt: dateToInstant(row.acceptedOn) } : {}),
    ...(row.note.trim() ? { note: row.note.trim() } : {}),
    descriptive: {
      entity_kind: row.entityKind,
      riding_number: row.entityKind === 'PARTY' ? null : row.riding === '' ? null : row.riding,
      received_by: row.receivedBy,
      goods_services: row.goodsServices,
      ...(dollarsToCents(row.nonDeductible) > 0 ? { non_deductible_cents: dollarsToCents(row.nonDeductible) } : {}),
      ...(row.sourceCode.trim() ? { source_code: row.sourceCode.trim() } : {}),
      ...(row.periodId ? { period_id: Number(row.periodId) } : {}),
    },
  };
}

export function ContributionFields({
  row,
  onChange,
  fallbackDate,
  externalRef,
  paymentDonorName,
  showDonor = true,
  amountLabel,
  amountDisabled = false,
}: {
  row: ContributionRow;
  onChange: (next: ContributionRow) => void;
  /** the payment's received date, YYYY-MM-DD, used when the row has no date of its own */
  fallbackDate: string;
  externalRef: string;
  paymentDonorName: string | null;
  showDonor?: boolean;
  amountLabel: string;
  /** a single contribution that covers the whole payment takes its amount from it */
  amountDisabled?: boolean;
}) {
  const periods = useQuery({ queryKey: ['admin-periods'], queryFn: api.listPeriods });
  const ridings = useQuery({ queryKey: ['admin-ridings'], queryFn: api.listRidings });

  const effectiveDate = row.acceptedOn || fallbackDate;
  const riding = row.entityKind === 'PARTY' || row.riding === '' ? null : row.riding;
  const preview = useQuery({
    queryKey: ['intake-preview', effectiveDate, riding, row.sourceCode, externalRef],
    queryFn: () =>
      api.intakePreview({
        acceptedAt: dateToInstant(effectiveDate),
        ridingNumber: riding,
        sourceCode: row.sourceCode.trim() || undefined,
        externalRef: externalRef.trim() || undefined,
      }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate),
    retry: false,
  });

  const periodName = (id: number) => periods.data?.data.find((p) => p.id === id)?.name ?? `period ${id}`;
  const derivedId = preview.data?.descriptive?.period_id;
  const set = (patch: Partial<ContributionRow>) => onChange({ ...row, ...patch });

  return (
    <Stack gap="xs">
      <Group align="flex-start" grow>
        {showDonor && (
          <DonorPicker
            label={`Donor${paymentDonorName ? ` (blank = ${paymentDonorName})` : ''}`}
            value={row.donor}
            onChange={(donor) => set({ donor })}
          />
        )}
        <NumberInput
          label={amountLabel}
          min={0.01}
          decimalScale={2}
          disabled={amountDisabled}
          value={row.amount}
          onChange={(v) => set({ amount: typeof v === 'number' ? v : '' })}
        />
        <NativeSelect
          label="Recipient"
          data={[
            { value: 'PARTY', label: 'Party (province-wide)' },
            { value: 'CA', label: 'Constituency association' },
            { value: 'CAMPAIGN', label: 'Campaign' },
          ]}
          value={row.entityKind}
          onChange={(e) => set({ entityKind: e.currentTarget.value as ContributionRow['entityKind'], riding: '' })}
        />
        <NumberInput
          label="Riding (1 to 124)"
          min={1}
          max={124}
          allowDecimal={false}
          disabled={row.entityKind === 'PARTY'}
          placeholder={row.entityKind === 'PARTY' ? 'N/A for the party' : ''}
          value={row.riding}
          onChange={(v) => set({ riding: typeof v === 'number' ? v : '' })}
          description={
            row.entityKind !== 'PARTY' && typeof row.riding === 'number'
              ? (ridings.data?.data.find((r) => r.ridingNumber === row.riding)?.name ?? 'not a riding on file')
              : undefined
          }
        />
      </Group>
      <Group align="flex-start" grow>
        <NativeSelect
          label="Period"
          data={[
            {
              value: '',
              label: derivedId !== undefined ? `Derived from the date: ${periodName(derivedId)}` : 'Derived from the date',
            },
            ...(periods.data?.data.map((p) => ({ value: String(p.id), label: p.name })) ?? []),
          ]}
          value={row.periodId}
          onChange={(e) => set({ periodId: e.currentTarget.value })}
        />
        <TextInput
          type="date"
          label="Accepted on"
          description={`blank = ${fallbackDate || 'the received date'}`}
          value={row.acceptedOn}
          onChange={(e) => set({ acceptedOn: e.currentTarget.value })}
        />
        <NativeSelect
          label="Received by"
          data={[
            { value: 'GPO', label: 'GPO (party office, central)' },
            { value: 'ENTITY', label: 'Entity / subspace entry' },
          ]}
          value={row.receivedBy}
          onChange={(e) => set({ receivedBy: e.currentTarget.value as ContributionRow['receivedBy'] })}
        />
        <TextInput
          label="Source code"
          placeholder="optional"
          value={row.sourceCode}
          onChange={(e) => set({ sourceCode: e.currentTarget.value })}
        />
      </Group>
      <Group align="flex-end" grow>
        <NumberInput
          label="Non-deductible ($)"
          description="e.g. the value of goods or services the donor received"
          min={0}
          decimalScale={2}
          value={row.nonDeductible}
          onChange={(v) => set({ nonDeductible: typeof v === 'number' ? v : '' })}
        />
        <Checkbox
          label="Donor received goods or services"
          checked={row.goodsServices}
          onChange={(e) => set({ goodsServices: e.currentTarget.checked })}
        />
        <TextInput label="Note" value={row.note} onChange={(e) => set({ note: e.currentTarget.value })} />
      </Group>
      {preview.data && preview.data.descriptive === null && row.periodId === '' && (
        <Alert color="orange" py={4}>
          No reporting period covers this date. Choose one, or configure one under Admin first.
        </Alert>
      )}
      {preview.data?.descriptive && row.periodId === '' && (
        <Text size="xs" c="dimmed">
          Will be filed in {periodName(preview.data.descriptive.period_id)}.
        </Text>
      )}
    </Stack>
  );
}
