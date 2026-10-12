import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Group, Modal, NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import { api, ApiError, type ContributionDetail, type PaymentMethodKey } from '../api.js';
import { dateToInstant } from './contribution-fields.js';
import { PAYMENT_METHODS, paymentReferenceLabel } from './payment-reference.js';

/**
 * Fix how a manual payment was keyed: the same payment fields as Add a
 * payment, less the donor and amount, which move money and so go through a
 * correction. A date fix also moves the contributions still on the old date
 * (api/src/payments/edit.ts).
 */
export function EditPaymentModal({
  contributionId,
  payment,
  onClose,
}: {
  contributionId: string;
  payment: ContributionDetail['payment'];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [receivedOn, setReceivedOn] = useState(payment.receivedAt.slice(0, 10));
  const [method, setMethod] = useState(payment.method as PaymentMethodKey);
  const [externalRef, setExternalRef] = useState(payment.externalRef ?? '');
  const [payerName, setPayerName] = useState(payment.payerName ?? '');
  const [note, setNote] = useState(payment.note ?? '');
  const [reason, setReason] = useState('');

  const referenceLabel = paymentReferenceLabel(method);
  // the stored instant keeps its time of day when the date is unchanged, so an
  // untouched date is not logged as a change
  const receivedAt = receivedOn === payment.receivedAt.slice(0, 10) ? payment.receivedAt : dateToInstant(receivedOn);

  const save = useMutation({
    mutationFn: () =>
      api.editPayment(payment.id, {
        reason: reason.trim(),
        receivedAt,
        method,
        externalRef: referenceLabel ? externalRef : null,
        payerName,
        note,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contribution', contributionId] });
      void qc.invalidateQueries({ queryKey: ['contributions'] });
      onClose();
    },
  });

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(receivedOn);

  return (
    <Modal opened onClose={onClose} title="Edit payment">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          To change the amount or the donor, correct the contribution instead: that also handles any receipt.
        </Text>
        <TextInput
          type="date"
          label="Received on"
          description="Contributions still on the old date move with it."
          value={receivedOn}
          onChange={(e) => setReceivedOn(e.currentTarget.value)}
        />
        <NativeSelect
          label="Method"
          data={PAYMENT_METHODS}
          value={method}
          onChange={(e) => setMethod(e.currentTarget.value as PaymentMethodKey)}
        />
        {referenceLabel && (
          <TextInput
            label={referenceLabel}
            placeholder="optional; used to match bank statements"
            value={externalRef}
            onChange={(e) => setExternalRef(e.currentTarget.value)}
          />
        )}
        <TextInput
          label="Payer name, if it differs from the donor"
          placeholder="e.g. Dana and Sam Donor"
          value={payerName}
          onChange={(e) => setPayerName(e.currentTarget.value)}
        />
        <TextInput label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <TextInput
          label="Reason (required)"
          placeholder="e.g. cheque number was mis-keyed"
          description="At least 3 characters."
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        {save.error && (
          <Alert color="red">{save.error instanceof ApiError ? save.error.message : 'Could not save the payment.'}</Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={reason.trim().length < 3 || !dateValid}>
            Save payment
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
