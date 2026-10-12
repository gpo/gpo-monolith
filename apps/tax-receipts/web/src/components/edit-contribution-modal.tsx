import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  NativeSelect,
  NumberInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { api, ApiError, type ContributionDetail, type MetadataEditInput } from '../api.js';
import { ENTITY_KIND_OPTIONS, isRidingScoped } from '../entity-kind.js';
import { LeadershipContestantSelect } from './leadership-contestant-select.js';
import { RidingSelect } from './riding-select.js';

/** Field help text, kept next to the form so it stays in sync with what the
 * fields actually do (packages/tax-receipts-core/src/metadata.ts). */
const METADATA_HELP = {
  entityKind:
    'Who received the contribution: the party centrally (province-wide, no riding), a constituency association (tied to a riding), a candidate’s campaign (tied to a riding), or a leadership contestant (no riding).',
  ridingNumber:
    'Electoral district (1–124) this contribution is attributed to. Required for a constituency association or campaign; not applicable when the recipient is the party (rule A2).',
  leadershipContestantId:
    'The leadership contestant this contribution is directed to. Their name prints on the receipt and in the EO reports (entity type LC). Add contestants under Admin.',
  receivedBy:
    'Who physically processed the contribution, independent of who it’s attributed to above. GPO: entered centrally by the party office. Entity: entered directly by a constituency association or campaign’s own CFO/subspace (this can happen even when the recipient kind above is Party, e.g. intake can’t yet always tell which subspace handled it).',
  periodId: 'The receipting period (tax year) this contribution is attributed to.',
  nonDeductibleCents:
    'Portion of the amount that is not eligible for a tax receipt, e.g. the value of goods or services the donor received in exchange.',
  goodsServices:
    'Check if the donor received goods or services in exchange for this contribution; affects the non-deductible amount.',
  sourceCode:
    'Qomon/EO source code identifying the campaign or intake channel this contribution came in through; may also encode a riding number (rule A7).',
} as const;

/** The ENTITY label for PARTY deliberately does NOT say "Party (central)":
 * receivedBy tracks processing provenance (who entered it), not attribution.
 * ENTITY means "a subspace/CFO entry, not GPO centrally," which can be true
 * even when the recipient kind above is Party (intake defaults entity_kind
 * to PARTY whenever it can't yet identify the real subspace; see
 * packages/tax-receipts-core/src/intake/defaults.ts, invariant 8). Labelling
 * it as if it meant "the party" would claim the opposite of what it means. */
export function receivedByOptions(entityKind: string): { value: string; label: string }[] {
  const entityLabel =
    entityKind === 'CA'
      ? 'Constituency association'
      : entityKind === 'CAMPAIGN'
        ? 'Campaign'
        : entityKind === 'LEADERSHIP'
          ? 'Leadership contestant’s campaign'
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
function a2RidingEntityWarning(entityKind: string, ridingNumber: number | null): string | null {
  if (!isRidingScoped(entityKind) && ridingNumber !== null) {
    return `Entity kind ${entityKind} must not carry a riding number.`;
  }
  if (isRidingScoped(entityKind) && ridingNumber === null) {
    return `Entity kind ${entityKind} requires a riding number.`;
  }
  return null;
}

/**
 * Edit a contribution's details (ticket 1.2) with a mandatory reason. The
 * amount, donor, and date are not here: those change through a correction or,
 * for a mis-keyed date, the payment edit.
 */
export function EditContributionModal({ detail, onClose }: { detail: ContributionDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const periods = useQuery({ queryKey: ['admin-periods'], queryFn: api.listPeriods });
  const metadata = detail.metadata!;
  const [form, setForm] = useState<Omit<MetadataEditInput, 'reason'>>({
    periodId: metadata.periodId,
    ridingNumber: metadata.ridingNumber,
    entityKind: metadata.entityKind,
    leadershipContestantId: metadata.leadershipContestantId,
    receivedBy: metadata.receivedBy,
    goodsServices: metadata.goodsServices,
    nonDeductibleCents: metadata.nonDeductibleCents,
    processedDate: metadata.processedDate,
    sourceCode: metadata.sourceCode,
    exceptionReason: metadata.exceptionReason,
    // external_ref lives on the payment (data-model §2, D12) and is edited there
    externalRef: detail.payment.externalRef,
  });
  const [reason, setReason] = useState('');

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value });

  const periodOptions = periods.data?.data.map((p) => ({ value: String(p.id), label: p.name })) ?? [];
  const periodSelectData = periodOptions.some((o) => o.value === String(form.periodId))
    ? periodOptions
    : [...periodOptions, { value: String(form.periodId), label: `Period ${form.periodId} (not in list)` }];

  const save = useMutation({
    mutationFn: () => api.editContributionMetadata(detail.id, { ...form, reason: reason.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contribution', detail.id] });
      void qc.invalidateQueries({ queryKey: ['contributions'] });
      onClose();
    },
  });

  return (
    <Modal opened onClose={onClose} title="Edit contribution">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          To change the amount or the donor, correct the contribution instead.
        </Text>
        <NativeSelect
          label={<FieldLabel label="Recipient" help={METADATA_HELP.entityKind} />}
          data={ENTITY_KIND_OPTIONS}
          value={form.entityKind}
          onChange={(e) => {
            const entityKind = e.currentTarget.value;
            setForm({
              ...form,
              entityKind,
              // Rule A2: a party or leadership recipient never carries a
              // riding number, and only a leadership one names a contestant.
              ridingNumber: isRidingScoped(entityKind) ? form.ridingNumber : null,
              leadershipContestantId: entityKind === 'LEADERSHIP' ? form.leadershipContestantId : null,
            });
          }}
        />
        {form.entityKind === 'LEADERSHIP' ? (
          <LeadershipContestantSelect
            label={<FieldLabel label="Leadership contestant" help={METADATA_HELP.leadershipContestantId} required />}
            value={form.leadershipContestantId}
            onChange={(v) => update('leadershipContestantId', v)}
            error={form.leadershipContestantId === null ? 'Choose the contestant (rule A2).' : null}
          />
        ) : (
          <RidingSelect
            label={
              <FieldLabel label="Riding" help={METADATA_HELP.ridingNumber} required={isRidingScoped(form.entityKind)} />
            }
            disabled={!isRidingScoped(form.entityKind)}
            placeholder={!isRidingScoped(form.entityKind) ? 'N/A for the party' : undefined}
            value={form.ridingNumber}
            onChange={(v) => update('ridingNumber', v)}
            error={a2RidingEntityWarning(form.entityKind, form.ridingNumber)}
          />
        )}
        <NativeSelect
          label={<FieldLabel label="Period" help={METADATA_HELP.periodId} />}
          data={periodSelectData}
          disabled={periods.isLoading}
          value={String(form.periodId)}
          onChange={(e) => update('periodId', Number(e.currentTarget.value))}
        />
        <NativeSelect
          label={<FieldLabel label="Received by" help={METADATA_HELP.receivedBy} />}
          data={receivedByOptions(form.entityKind)}
          value={form.receivedBy}
          onChange={(e) => update('receivedBy', e.currentTarget.value)}
        />
        <TextInput
          label={<FieldLabel label="Source code" help={METADATA_HELP.sourceCode} />}
          value={form.sourceCode}
          onChange={(e) => update('sourceCode', e.currentTarget.value)}
        />
        <Checkbox
          label={<FieldLabel label="Donor received goods or services" help={METADATA_HELP.goodsServices} />}
          checked={form.goodsServices}
          onChange={(e) => update('goodsServices', e.currentTarget.checked)}
        />
        <NumberInput
          label={<FieldLabel label="Non-deductible ($)" help={METADATA_HELP.nonDeductibleCents} />}
          min={0}
          decimalScale={2}
          value={form.nonDeductibleCents / 100}
          onChange={(v) => update('nonDeductibleCents', typeof v === 'number' ? Math.round(v * 100) : 0)}
        />
        <TextInput
          label="Reason (required)"
          placeholder="e.g. CFO subspace intake review"
          description="At least 3 characters."
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        {save.error && (
          <Alert color="red">{save.error instanceof ApiError ? save.error.message : 'Failed to save.'}</Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={reason.trim().length < 3}>
            Save contribution
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
