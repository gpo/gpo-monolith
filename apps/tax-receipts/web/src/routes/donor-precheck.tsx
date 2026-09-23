import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ApiError, api, type DonorPrecheckAddress } from '../api.js';
import gpoLogo from '../assets/gpo-logo-EN-horizontal-green.svg';

/**
 * Donor pre-check confirmation (ticket 3.9, story V4): the page a real
 * pre-check email would link to. Deliberately outside the staff app shell —
 * router.tsx renders this with no session check and no AppShell chrome, since
 * a donor has no `User` account and this route is identified solely by the
 * token in its URL, matching `donors/precheck.ts`'s unauthenticated
 * `confirmDonorPrecheck`.
 */
export function DonorPrecheckConfirmPage({ token }: { token: string }) {
  const [delivery, setDelivery] = useState<'EMAIL' | 'MAIL'>('EMAIL');
  const [address, setAddress] = useState<DonorPrecheckAddress>({
    line1: '',
    line2: '',
    city: '',
    province: 'ON',
    postalCode: '',
    country: 'CA',
  });

  const confirm = useMutation({
    mutationFn: () =>
      api.confirmDonorPrecheck(token, {
        delivery,
        address: { ...address, line2: address.line2 || undefined },
      }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    confirm.mutate();
  }

  const notFound = confirm.error instanceof ApiError && confirm.error.status === 404;
  const expired = confirm.error instanceof ApiError && confirm.error.status === 410;

  return (
    <Center mih="100vh" p="md">
      <Card withBorder maw={480} w="100%">
        <Stack gap="md">
          <Group justify="center">
            <img src={gpoLogo} alt="Green Party of Ontario" height={28} />
          </Group>
          <Title order={3} ta="center">
            Confirm your tax receipt details
          </Title>

          {confirm.isSuccess ? (
            <Alert color="green">
              Thanks — your address is on file and your receipt will be sent by{' '}
              {confirm.data.delivery === 'EMAIL' ? 'email' : 'mail'}.
            </Alert>
          ) : notFound ? (
            <Alert color="red">
              This link is invalid or has already been used. If you meant to update your details, ask GPO to
              resend your pre-check.
            </Alert>
          ) : expired ? (
            <Alert color="orange">This link has expired. Ask GPO to resend your pre-check.</Alert>
          ) : (
            <Stack gap="sm" component="form" onSubmit={submit}>
              <Text size="sm" c="dimmed">
                Please confirm the mailing address for your tax receipt, and let us know whether you'd like it by
                email or mail.
              </Text>
              <TextInput
                label="Street address"
                value={address.line1}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setAddress((a) => ({ ...a, line1: value }));
                }}
                required
              />
              <TextInput
                label="Apartment / unit (optional)"
                value={address.line2}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setAddress((a) => ({ ...a, line2: value }));
                }}
              />
              <Group grow>
                <TextInput
                  label="City"
                  value={address.city}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setAddress((a) => ({ ...a, city: value }));
                  }}
                  required
                />
                <TextInput
                  label="Province"
                  value={address.province}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setAddress((a) => ({ ...a, province: value }));
                  }}
                  required
                />
              </Group>
              <Group grow>
                <TextInput
                  label="Postal code"
                  value={address.postalCode}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setAddress((a) => ({ ...a, postalCode: value }));
                  }}
                  required
                />
                <TextInput
                  label="Country"
                  value={address.country}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setAddress((a) => ({ ...a, country: value }));
                  }}
                />
              </Group>
              <NativeSelect
                label="How would you like your receipt?"
                data={[
                  { value: 'EMAIL', label: 'Email' },
                  { value: 'MAIL', label: 'Mail' },
                ]}
                value={delivery}
                onChange={(e) => setDelivery(e.currentTarget.value as 'EMAIL' | 'MAIL')}
              />
              {confirm.isError && !notFound && !expired && (
                <Alert color="red">Something went wrong — please try again.</Alert>
              )}
              <Button
                type="submit"
                loading={confirm.isPending}
                disabled={!address.line1 || !address.city || !address.province || !address.postalCode}
              >
                Confirm
              </Button>
            </Stack>
          )}
        </Stack>
      </Card>
    </Center>
  );
}
