import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Group, Menu, Modal, Stack, Text, TextInput } from '@mantine/core';
import { api, ApiError } from '../api.js';

/**
 * Per-receipt correction actions (screens.md screen 8): cancel, reissue, a
 * lost-receipt "Copy" reprint, and the typo-only lightweight reprint. Each is
 * one confirm dialog with a mandatory reason. Whether a change is a spelling
 * fix or material is the server's call: a material one is refused and the
 * operator is pointed at reissue.
 */

type Kind = 'CANCEL' | 'REISSUE' | 'LOST_COPY' | 'CORRECTED';

const TITLES: Record<Kind, string> = {
  CANCEL: 'Cancel this receipt',
  REISSUE: 'Reissue this receipt',
  LOST_COPY: 'Reprint as a lost-receipt copy',
  CORRECTED: 'Fix the spelling of the donor name',
};

const EXPLANATION: Record<Kind, string> = {
  CANCEL:
    'The receipt is cancelled (its number is kept) and a watermarked cancellation notice is stored. If it was RTD-reported, a DC-1A is queued.',
  REISSUE:
    'Cancels this receipt and issues a replacement from current data, which says it cancels and replaces this one.',
  LOST_COPY:
    'Reprints the receipt unaltered, stamped COPY, and flags the original lost. The receipt stays valid and is not cancelled.',
  CORRECTED:
    'Regenerates the receipt with the corrected spelling. Only a spelling fix of the same person qualifies; anything else is a reissue. The receipt is not cancelled.',
};

export function ReceiptActions({
  receipt,
  donorName,
  defaultLabel,
  onDone,
}: {
  receipt: { id: string; receiptNumber: string; status: string };
  donorName: string;
  defaultLabel: string;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState(defaultLabel);
  const [name, setName] = useState(donorName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      switch (kind) {
        case 'CANCEL':
          await api.cancelReceipt(receipt.id, reason);
          return 'Receipt cancelled.';
        case 'REISSUE': {
          const r = await api.reissueReceipt(receipt.id, { reason, politicalEntityLabel: label });
          return `Reissued as ${r.newReceiptNumber}.`;
        }
        case 'LOST_COPY':
          await api.reprintReceipt(receipt.id, { kind, reason, politicalEntityLabel: label });
          return 'Copy generated; the original is flagged lost.';
        case 'CORRECTED':
          await api.reprintReceipt(receipt.id, { kind, reason, politicalEntityLabel: label, correctedName: name });
          return 'Reprint generated with the corrected spelling.';
        default:
          throw new Error('choose an action');
      }
    },
    onSuccess: (message) => {
      setError(null);
      setDone(message);
      setReason('');
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not work.'),
  });

  if (receipt.status !== 'ISSUED') return null;
  const needsLabel = kind === 'REISSUE' || kind === 'LOST_COPY' || kind === 'CORRECTED';

  return (
    <>
      <Menu withinPortal>
        <Menu.Target>
          <Button size="compact-xs" variant="light" aria-label={`Correct receipt ${receipt.receiptNumber}`}>
            Correct
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {(Object.keys(TITLES) as Kind[]).map((k) => (
            <Menu.Item
              key={k}
              onClick={() => {
                setKind(k);
                setError(null);
                setDone(null);
              }}
            >
              {TITLES[k]}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      <Modal opened={kind !== null} onClose={() => setKind(null)} title={kind ? `${TITLES[kind]}: ${receipt.receiptNumber}` : ''}>
        {kind && (
          <Stack gap="sm">
            <Text size="sm">{EXPLANATION[kind]}</Text>
            {kind === 'CORRECTED' && (
              <TextInput label="Corrected name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
            )}
            {needsLabel && (
              <TextInput
                label="Received-by label (as it prints on the receipt)"
                value={label}
                onChange={(e) => setLabel(e.currentTarget.value)}
              />
            )}
            <TextInput
              label="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            {error && <Alert color="red">{error}</Alert>}
            {done && <Alert color="green">{done}</Alert>}
            <Group>
              <Button
                onClick={() => run.mutate()}
                loading={run.isPending}
                disabled={
                  reason.trim().length < 3 || (needsLabel && label.trim().length === 0) || (kind === 'CORRECTED' && name.trim().length === 0)
                }
              >
                Confirm
              </Button>
              <Button variant="subtle" onClick={() => setKind(null)}>
                Close
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
