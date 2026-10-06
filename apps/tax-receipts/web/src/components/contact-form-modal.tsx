import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Group, Modal, NativeSelect, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { api, ApiError, type ContactAddress, type ContactRecord, type ContactSource } from '../api.js';

/**
 * Add or edit a contributor (D13; EO evaluation rows 21 to 23). The same form
 * serves both ownership modes; what it says above the Save button depends on
 * where the write goes:
 *
 *  - a new contributor while Qomon is configured is created in Qomon first;
 *  - an edit of a Qomon contact is written to Qomon first;
 *  - otherwise the tool owns the record.
 *
 * Every save needs a reason, which goes on the change-log entry. A new
 * contributor that looks like one on file (same email, or same name and
 * postal code) is held back until the operator confirms it is a different
 * person.
 */

export const PROVINCES = ['ON', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'PE', 'QC', 'SK', 'YT'];

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  housenumber: string;
  street: string;
  city: string;
  state: string;
  postalcode: string;
  country: string;
  reason: string;
}

function initialState(contact: ContactRecord | null): FormState {
  const a = contact?.address;
  return {
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    email: contact?.email ?? '',
    housenumber: a?.housenumber ?? '',
    street: a?.street ?? '',
    city: a?.city ?? '',
    state: a?.state || 'ON',
    postalcode: a?.postalcode ?? '',
    country: a?.country || 'CA',
    reason: '',
  };
}

/** An address is optional, but once any line is filled in it must be whole. */
function addressFrom(f: FormState): ContactAddress | null | 'incomplete' {
  const any = [f.housenumber, f.street, f.city, f.postalcode].some((v) => v.trim());
  if (!any) return null;
  if (!f.street.trim() || !f.city.trim() || !f.state.trim() || !f.postalcode.trim() || !f.country.trim()) {
    return 'incomplete';
  }
  return {
    housenumber: f.housenumber.trim() || null,
    street: f.street.trim(),
    city: f.city.trim(),
    state: f.state.trim(),
    postalcode: f.postalcode.trim(),
    country: f.country.trim(),
  };
}

export function ownershipNote(mode: 'create' | 'edit', source: ContactSource): string {
  if (mode === 'create') {
    return source === 'qomon'
      ? 'This contributor will be created in Qomon first, then copied here.'
      : 'Qomon is not connected, so this contributor will be kept in this tool only.';
  }
  return source === 'qomon'
    ? 'This is a Qomon contact: your changes are written to Qomon first, then copied here.'
    : 'This contributor is kept in this tool only.';
}

export function ContactFormModal({
  contact,
  onClose,
  onSaved,
}: {
  /** null to add a new contributor */
  contact: ContactRecord | null;
  onClose: () => void;
  onSaved?: (saved: ContactRecord) => void;
}) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['contact-settings'], queryFn: api.contactSettings });
  const [form, setForm] = useState<FormState>(() => initialState(contact));
  // set once the operator confirms a likely duplicate is a different person
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const set = (key: keyof FormState) => (e: { currentTarget: { value: string } }) =>
    setForm({ ...form, [key]: e.currentTarget.value });

  const address = addressFrom(form);
  const ready =
    form.firstName.trim() && form.lastName.trim() && address !== 'incomplete' && form.reason.trim().length >= 3;

  const save = useMutation({
    mutationFn: () => {
      const input = {
        reason: form.reason.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || null,
        address: address === 'incomplete' ? null : address,
      };
      return contact ? api.updateContact(contact.id, input) : api.createContact({ ...input, allowDuplicate });
    },
    onSuccess: async (saved) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['contact', saved.id] }),
        qc.invalidateQueries({ queryKey: ['contacts'] }),
        qc.invalidateQueries({ queryKey: ['contribution'] }),
      ]);
      onSaved?.(saved);
      onClose();
    },
  });

  const mode = contact ? 'edit' : 'create';
  const source: ContactSource | undefined = contact ? contact.source : settings.data?.source;

  return (
    <Modal opened onClose={onClose} title={contact ? `Edit ${contact.name}` : 'Add a contributor'} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <Stack gap="sm">
          <Group grow align="flex-start">
            <TextInput label="First name" required value={form.firstName} onChange={set('firstName')} />
            <TextInput label="Last name" required value={form.lastName} onChange={set('lastName')} />
          </Group>
          <Group grow align="flex-start">
            <TextInput label="Email" type="email" value={form.email} onChange={set('email')} />
            <TextInput
              label="Contributor type"
              value="Individual"
              readOnly
              description="Ontario accepts political contributions from individuals only."
            />
          </Group>
          <Text size="sm" fw={600} mt="xs">
            Mailing address
          </Text>
          <Text size="xs" c="dimmed">
            Optional here, but a receipt cannot be issued without one.
          </Text>
          <Group grow align="flex-start">
            <TextInput label="Street number" value={form.housenumber} onChange={set('housenumber')} style={{ flexGrow: 0, minWidth: 120 }} />
            <TextInput label="Street" value={form.street} onChange={set('street')} />
          </Group>
          <Group grow align="flex-start">
            <TextInput label="City" value={form.city} onChange={set('city')} />
            <NativeSelect
              label="Province"
              data={PROVINCES.includes(form.state) ? PROVINCES : [form.state, ...PROVINCES]}
              value={form.state}
              onChange={set('state')}
            />
            <TextInput label="Postal code" value={form.postalcode} onChange={set('postalcode')} />
            <TextInput label="Country" value={form.country} onChange={set('country')} />
          </Group>
          {address === 'incomplete' && (
            <Text size="xs" c="orange">
              Fill in the street, city, province, postal code, and country, or leave the address blank.
            </Text>
          )}
          <Textarea
            label="Reason (required)"
            description="Recorded in the change log with your name and the before and after values."
            autosize
            minRows={1}
            value={form.reason}
            onChange={set('reason')}
          />
          {source && (
            <Alert color={source === 'qomon' ? 'blue' : 'gray'} variant="light">
              {ownershipNote(mode, source)}
            </Alert>
          )}
          {save.isError && <Alert color="red">{save.error.message}</Alert>}
          {!contact && save.error instanceof ApiError && save.error.status === 409 && (
            <Checkbox
              label="This is a different person; add them anyway"
              checked={allowDuplicate}
              onChange={(e) => setAllowDuplicate(e.currentTarget.checked)}
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready} loading={save.isPending}>
              {contact ? 'Save changes' : 'Add contributor'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
