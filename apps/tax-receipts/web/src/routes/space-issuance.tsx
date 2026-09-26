import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NativeSelect,
  SimpleGrid,
  Stack,
  Stepper,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import {
  api,
  ApiError,
  type QueueReceiptEmailsResult,
  type SendDonorPrechecksResult,
  type SpaceDeliverySummary,
  type SpaceIssuanceResult,
} from '../api.js';
import { describeRuleRef } from '../rule-labels.js';
import { PageHeader } from '../components/PageHeader.js';
import { defaultPoliticalEntityLabel, money } from './contribution-detail.js';

/**
 * Per-space issuance wizard (tickets 3.12 and 3.6, screens.md screen 6):
 * Review (gate check, pre-issuance preview, and the donor pre-check send) ->
 * Generate -> Deliver. Deliver queues the email receipts (sent in the
 * background by the API's dispatcher), makes print batches for the mail
 * receipts, and records when a batch went in the post. It lists any email
 * that bounced: those receipts have already moved to mail and land in the
 * next print batch.
 *
 * Every step is repeatable for stragglers, so the Deliver step is reachable
 * whenever the space has issued receipts, not only straight after
 * generating.
 *
 * Reachable from the space dashboard's "Issue" action per row.
 */

const DEFAULT_RECEIPT_SUBJECT = 'Your official contribution receipt';
const DEFAULT_PRECHECK_SUBJECT = 'Please confirm your address for your contribution receipt';

interface SpaceIssuanceParams {
  periodId: number;
  entityKind: string;
  ridingNumber: number | null;
}

function spaceLabel({ periodId, ridingNumber, entityKind }: SpaceIssuanceParams): string {
  return `Period ${periodId} · ${ridingNumber !== null ? `Riding ${ridingNumber}` : 'Party'} · ${entityKind}`;
}

export function SpaceIssuancePage(params: SpaceIssuanceParams) {
  const { periodId, entityKind, ridingNumber } = params;
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const preview = useQuery({
    queryKey: ['space-issuance-preview', periodId, entityKind, ridingNumber],
    queryFn: () => api.previewSpaceIssuance(periodId, entityKind, ridingNumber),
  });

  const delivery = useQuery({
    queryKey: ['space-delivery', periodId, entityKind, ridingNumber],
    queryFn: () => api.getSpaceDelivery(periodId, entityKind, ridingNumber),
    // email goes out in the background; keep the counts moving while any is queued
    refetchInterval: (query) => ((query.state.data?.email.queued ?? 0) > 0 ? 5_000 : false),
  });

  const [active, setActive] = useState(0);
  const [reason, setReason] = useState('');
  const [politicalEntityLabel, setPoliticalEntityLabel] = useState<string | null>(null);
  const [deliveryOverride, setDeliveryOverride] = useState<'' | 'EMAIL' | 'MAIL'>('');
  const [genError, setGenError] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<SpaceIssuanceResult | null>(null);
  const [precheckReason, setPrecheckReason] = useState('');
  const [precheckSubject, setPrecheckSubject] = useState(DEFAULT_PRECHECK_SUBJECT);
  const [precheckBody, setPrecheckBody] = useState('');
  const [precheckError, setPrecheckError] = useState<string | null>(null);
  const [precheckResult, setPrecheckResult] = useState<SendDonorPrechecksResult | null>(null);

  const effectiveLabel = (politicalEntityLabel ?? defaultPoliticalEntityLabel(entityKind)).trim();

  const sendPrecheck = useMutation({
    mutationFn: () =>
      api.sendSpacePrecheck(periodId, entityKind, ridingNumber, {
        reason: precheckReason,
        emailSubject: precheckSubject.trim(),
        emailBody: precheckBody.trim(),
      }),
    onSuccess: (result) => {
      setPrecheckError(null);
      setPrecheckResult(result);
    },
    onError: (err) => {
      setPrecheckError(err instanceof ApiError ? err.message : 'Failed to send the donor pre-check.');
    },
  });

  const generate = useMutation({
    mutationFn: () =>
      api.issueSpaceReceipts(periodId, entityKind, ridingNumber, {
        reason,
        politicalEntityLabel: effectiveLabel,
        delivery: deliveryOverride || undefined,
      }),
    onSuccess: (result) => {
      setGenError(null);
      setGenResult(result);
      setActive(2);
      return Promise.all([
        qc.invalidateQueries({ queryKey: ['space-issuance-preview', periodId, entityKind, ridingNumber] }),
        qc.invalidateQueries({ queryKey: ['space-delivery', periodId, entityKind, ridingNumber] }),
      ]);
    },
    onError: (err) => {
      setGenError(err instanceof ApiError ? err.message : 'Failed to generate receipts.');
    },
  });

  const canIssue = me.data?.can.issueReceipts ?? false;
  const canSendPrecheck = me.data?.can.sendDonorPrechecks ?? false;
  const canReview = preview.data !== undefined && !preview.data.blocked && preview.data.lines.length > 0;
  const hasIssued = (delivery.data?.issuedCount ?? 0) > 0;

  return (
    <Stack gap="lg">
      <PageHeader title="Issue receipts" backTo="/" backLabel="Back to spaces" />
      <Text c="dimmed">{spaceLabel(params)}</Text>

      <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false}>
        <Stepper.Step label="Review" description="Gate check + pre-issuance preview">
          {preview.isLoading ? (
            <Loader mt="md" />
          ) : preview.isError ? (
            <Alert color="red" mt="md">
              Failed to load the preview.
            </Alert>
          ) : preview.data ? (
            <Stack gap="md" mt="md">
              {preview.data.blocked ? (
                <Card withBorder>
                  <Stack gap="xs">
                    <Text fw={600} c="orange">
                      {preview.data.blockers.length} open work item(s) block issuance for this space
                    </Text>
                    <Text size="sm" c="dimmed">
                      Resolve every item below, then refresh this preview.
                    </Text>
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Donor</Table.Th>
                          <Table.Th>Rule</Table.Th>
                          <Table.Th></Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {preview.data.blockers.map((b) => (
                          <Table.Tr key={b.workItemId}>
                            <Table.Td>{b.contactName ?? '—'}</Table.Td>
                            <Table.Td>
                              {b.ruleRef ? (
                                <>
                                  {describeRuleRef(b.ruleRef)}{' '}
                                  <Text span size="xs" c="dimmed">
                                    ({b.ruleRef})
                                  </Text>
                                </>
                              ) : (
                                b.kind
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Link to="/contributions/$id" params={{ id: b.contributionId }}>
                                <Text span c="blue" size="sm">
                                  Open contribution
                                </Text>
                              </Link>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Stack>
                </Card>
              ) : preview.data.lines.length === 0 ? (
                <Card withBorder>
                  <Text c="dimmed">
                    Nothing to issue — every contribution in this space is already fully receipted (or there are
                    none yet).
                  </Text>
                </Card>
              ) : (
                <>
                  <SimpleGrid cols={{ base: 2, sm: 4 }}>
                    <Card withBorder>
                      <Text size="xs" c="dimmed">
                        Receipts
                      </Text>
                      <Text fw={700} size="xl">
                        {preview.data.totals.receiptCount}
                      </Text>
                    </Card>
                    <Card withBorder>
                      <Text size="xs" c="dimmed">
                        Total amount
                      </Text>
                      <Text fw={700} size="xl">
                        {money(preview.data.totals.amountCents)}
                      </Text>
                    </Card>
                    <Card withBorder>
                      <Text size="xs" c="dimmed">
                        Email delivery
                      </Text>
                      <Text fw={700} size="xl">
                        {preview.data.totals.emailCount}
                      </Text>
                    </Card>
                    <Card withBorder>
                      <Text size="xs" c="dimmed">
                        Mail delivery
                      </Text>
                      <Text fw={700} size="xl">
                        {preview.data.totals.mailCount}
                      </Text>
                    </Card>
                  </SimpleGrid>
                  <Table striped withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Donor</Table.Th>
                        <Table.Th>Amount</Table.Th>
                        <Table.Th>Delivery</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {preview.data.lines.map((l) => (
                        <Table.Tr key={l.contributionId}>
                          <Table.Td>
                            <Link to="/contributions/$id" params={{ id: l.contributionId }}>
                              <Text span c="blue">
                                {l.contactName}
                              </Text>
                            </Link>
                          </Table.Td>
                          <Table.Td>{money(l.amountCents)}</Table.Td>
                          <Table.Td>
                            <Badge color={l.delivery === 'EMAIL' ? 'blue' : 'gray'}>{l.delivery}</Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </>
              )}
              <Card withBorder>
                <Stack gap="sm">
                  <Text fw={600}>Donor pre-check</Text>
                  <Text size="sm" c="dimmed">
                    Emails every donor above a link to confirm their address and choose email or mail,
                    ahead of generating anything. Donors who don't confirm get their receipt by mail.
                  </Text>
                  {!canSendPrecheck && (
                    <Alert color="yellow">
                      You don't have permission to send the donor pre-check for this space.
                    </Alert>
                  )}
                  <Stack gap="xs" maw={560}>
                    <TextInput
                      label="Email subject"
                      value={precheckSubject}
                      onChange={(e) => setPrecheckSubject(e.currentTarget.value)}
                      disabled={!canSendPrecheck}
                    />
                    <Textarea
                      label="Email message"
                      description="The donor's confirmation link is added below this message."
                      placeholder="e.g. Before we send your receipt, please confirm your mailing address and whether you'd like it by email or by post."
                      autosize
                      minRows={3}
                      value={precheckBody}
                      onChange={(e) => setPrecheckBody(e.currentTarget.value)}
                      disabled={!canSendPrecheck}
                    />
                    <TextInput
                      label="Reason"
                      placeholder="e.g. annual pre-check window opens"
                      value={precheckReason}
                      onChange={(e) => setPrecheckReason(e.currentTarget.value)}
                      disabled={!canSendPrecheck}
                    />
                  </Stack>
                  <Group>
                    <Button
                      variant="light"
                      onClick={() => sendPrecheck.mutate()}
                      loading={sendPrecheck.isPending}
                      disabled={
                        !canSendPrecheck ||
                        precheckReason.trim().length < 3 ||
                        precheckSubject.trim().length === 0 ||
                        precheckBody.trim().length === 0
                      }
                    >
                      Send pre-checks
                    </Button>
                  </Group>
                  {precheckError && <Alert color="red">{precheckError}</Alert>}
                  {precheckResult && (
                    <Text size="sm">
                      {precheckResult.sent.length} sent
                      {precheckResult.skipped.length > 0 &&
                        `, ${precheckResult.skipped.length} skipped (no email on file)`}
                      .
                    </Text>
                  )}
                </Stack>
              </Card>
              <Group>
                <Button variant="light" onClick={() => preview.refetch()} loading={preview.isFetching}>
                  Refresh preview
                </Button>
                <Button disabled={!canReview} onClick={() => setActive(1)}>
                  Next: generate
                </Button>
                {hasIssued && (
                  <Button variant="light" onClick={() => setActive(2)}>
                    Go to delivery
                  </Button>
                )}
              </Group>
            </Stack>
          ) : null}
        </Stepper.Step>

        <Stepper.Step label="Generate" description="Issue every receipt in this space">
          <Stack gap="md" mt="md" maw={480}>
            {!canIssue && (
              <Alert color="yellow">
                Only the party CFO (or an authorized designate) may issue receipts (s. 25.1(6)).
              </Alert>
            )}
            <Text size="sm" c="dimmed">
              This will issue {preview.data?.totals.receiptCount ?? '—'} receipt(s) totalling{' '}
              {preview.data ? money(preview.data.totals.amountCents) : '—'}.
            </Text>
            <TextInput
              label="Received-by label (as it should print on every receipt)"
              placeholder="e.g. Green Party of Ontario"
              value={politicalEntityLabel ?? defaultPoliticalEntityLabel(entityKind)}
              onChange={(e) => setPoliticalEntityLabel(e.currentTarget.value)}
            />
            <NativeSelect
              label="Delivery override"
              description="Leave as-is to use each donor's own preference (defaulting to mail)."
              data={[
                { value: '', label: "Use each donor's preference" },
                { value: 'MAIL', label: 'Force mail for all' },
                { value: 'EMAIL', label: 'Force email for all' },
              ]}
              value={deliveryOverride}
              onChange={(e) => setDeliveryOverride(e.currentTarget.value as '' | 'EMAIL' | 'MAIL')}
            />
            <TextInput
              label="Reason for this issuance run (required)"
              placeholder="e.g. period-end batch issuance"
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            {genError && <Alert color="red">{genError}</Alert>}
            <Group>
              <Button variant="subtle" onClick={() => setActive(0)}>
                Back
              </Button>
              <Button
                onClick={() => generate.mutate()}
                loading={generate.isPending}
                disabled={!canIssue || reason.trim().length < 3 || effectiveLabel.length === 0}
              >
                Generate receipts
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Deliver" description="Email, print, and mail">
          <Stack gap="md" mt="md">
            {genResult && <GenerateResults result={genResult} />}
            <DeliverStep
              periodId={periodId}
              entityKind={entityKind}
              ridingNumber={ridingNumber}
              canDeliver={canIssue}
              summary={delivery.data}
              loading={delivery.isLoading}
              onChanged={() => delivery.refetch()}
            />
          </Stack>
        </Stepper.Step>
      </Stepper>
    </Stack>
  );
}

function GenerateResults({ result }: { result: SpaceIssuanceResult }) {
  return (
    <Stack gap="xs">
      <Alert color={result.failed === 0 ? 'green' : 'orange'}>
        {result.succeeded} issued, {result.failed} failed.
      </Alert>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Contribution</Table.Th>
            <Table.Th>Result</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {result.results.map((r) => (
            <Table.Tr key={r.contributionId}>
              <Table.Td>
                <Link to="/contributions/$id" params={{ id: r.contributionId }}>
                  <Text span c="blue">
                    {r.contributionId}
                  </Text>
                </Link>
              </Table.Td>
              <Table.Td>
                {r.ok ? (
                  <Group gap="xs">
                    <Badge color="green">{r.receiptNumber}</Badge>
                    <Text size="sm">{money(r.amountCents ?? 0)}</Text>
                    {r.receiptId && (
                      <Text component="a" href={api.receiptPdfUrl(r.receiptId)} target="_blank" rel="noreferrer" c="blue" size="sm">
                        View PDF
                      </Text>
                    )}
                  </Group>
                ) : (
                  <Text c="red" size="sm">
                    {r.error}
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700}>{value}</Text>
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function DeliverStep(props: {
  periodId: number;
  entityKind: string;
  ridingNumber: number | null;
  canDeliver: boolean;
  summary: SpaceDeliverySummary | undefined;
  loading: boolean;
  onChanged: () => void;
}) {
  const { periodId, entityKind, ridingNumber, canDeliver, summary } = props;
  const [coverLetterBody, setCoverLetterBody] = useState('');
  const [subject, setSubject] = useState(DEFAULT_RECEIPT_SUBJECT);
  const [reason, setReason] = useState('');
  const [mailedOn, setMailedOn] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [emailResult, setEmailResult] = useState<QueueReceiptEmailsResult | null>(null);

  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong.');
  const done = () => {
    setError(null);
    props.onChanged();
  };

  const queueEmails = useMutation({
    mutationFn: () =>
      api.queueSpaceReceiptEmails(periodId, entityKind, ridingNumber, {
        reason,
        subject: subject.trim(),
        coverLetterBody: coverLetterBody.trim(),
      }),
    onSuccess: (result) => {
      setEmailResult(result);
      done();
    },
    onError,
  });
  const printBatch = useMutation({
    mutationFn: () =>
      api.createPrintBatch(periodId, entityKind, ridingNumber, { reason, coverLetterBody: coverLetterBody.trim() }),
    onSuccess: done,
    onError,
  });
  const markMailed = useMutation({
    mutationFn: (id: string) => api.markPrintBatchMailed(id, { reason, mailedOn: mailedOn[id] ?? todayIso() }),
    onSuccess: done,
    onError,
  });

  if (props.loading) return <Loader />;
  if (!summary) return <Alert color="red">Failed to load delivery status.</Alert>;
  if (summary.issuedCount === 0) {
    return (
      <Card withBorder>
        <Text c="dimmed">No receipts have been issued in this space yet.</Text>
      </Card>
    );
  }

  const ready = reason.trim().length >= 3 && coverLetterBody.trim().length > 0;

  return (
    <Stack gap="md">
      {summary.deliveredCount === summary.issuedCount ? (
        <Alert color="green">Every receipt in this space has been delivered ({summary.issuedCount}).</Alert>
      ) : (
        <Text size="sm">
          {summary.deliveredCount} of {summary.issuedCount} receipt(s) delivered.
        </Text>
      )}
      {!canDeliver && (
        <Alert color="yellow">Only the party CFO (or an authorized designate) may deliver receipts.</Alert>
      )}

      <Card withBorder>
        <Stack gap="xs" maw={640}>
          <Text fw={600}>Cover letter</Text>
          <Textarea
            label="Letter"
            description="Goes in the body of each receipt email and on a page in front of each printed receipt, after the donor's name and receipt number."
            placeholder="e.g. Thank you for your support of the Green Party of Ontario. Your official receipt for income tax purposes is enclosed."
            autosize
            minRows={4}
            value={coverLetterBody}
            onChange={(e) => setCoverLetterBody(e.currentTarget.value)}
            disabled={!canDeliver}
          />
          <TextInput
            label="Reason (required)"
            placeholder="e.g. 2026 annual receipts"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            disabled={!canDeliver}
          />
        </Stack>
      </Card>

      {error && <Alert color="red">{error}</Alert>}

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600}>Email</Text>
            <Group gap="xl">
              <Stat label="Ready to send" value={summary.email.readyToQueue} />
              <Stat label="Sending" value={summary.email.queued} />
              <Stat label="Sent" value={summary.email.sent} />
              <Stat label="Delivered" value={summary.email.delivered} />
            </Group>
            <TextInput
              label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.currentTarget.value)}
              disabled={!canDeliver}
            />
            <Group>
              <Button
                onClick={() => queueEmails.mutate()}
                loading={queueEmails.isPending}
                disabled={!canDeliver || !ready || subject.trim().length === 0 || summary.email.readyToQueue === 0}
              >
                Send {summary.email.readyToQueue} email(s)
              </Button>
            </Group>
            {emailResult && (
              <Text size="sm">
                {emailResult.queued.length} queued
                {emailResult.movedToMail.length > 0 &&
                  `; ${emailResult.movedToMail.length} moved to mail (no email address on file)`}
                .
              </Text>
            )}
            <Text size="xs" c="dimmed">
              Emails go out in the background, each with the receipt PDF attached.
            </Text>
          </Stack>
        </Card>

        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600}>Mail</Text>
            <Group gap="xl">
              <Stat label="Ready to print" value={summary.mail.readyToPrint} />
              <Stat label="Printed, not mailed" value={summary.mail.printed} />
              <Stat label="Mailed" value={summary.mail.mailed} />
            </Group>
            <Group>
              <Button
                onClick={() => printBatch.mutate()}
                loading={printBatch.isPending}
                disabled={!canDeliver || !ready || summary.mail.readyToPrint === 0}
              >
                Create print batch ({summary.mail.readyToPrint})
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              One PDF: a letter addressed for a window envelope, then the receipt, for each donor. Print it,
              post it, then mark the batch mailed.
            </Text>
          </Stack>
        </Card>
      </SimpleGrid>

      {summary.printBatches.length > 0 && (
        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600}>Print batches</Text>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Receipts</Table.Th>
                  <Table.Th>PDF</Table.Th>
                  <Table.Th>Mailed</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summary.printBatches.map((b) => (
                  <Table.Tr key={b.id}>
                    <Table.Td>{new Date(b.createdAt).toLocaleString()}</Table.Td>
                    <Table.Td>{b.receiptCount}</Table.Td>
                    <Table.Td>
                      <Text component="a" href={api.printBatchPdfUrl(b.id)} target="_blank" rel="noreferrer" c="blue" size="sm">
                        Download
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {b.mailedAt ? (
                        <Badge color="green">{new Date(b.mailedAt).toLocaleDateString()}</Badge>
                      ) : (
                        <Group gap="xs">
                          <TextInput
                            type="date"
                            size="xs"
                            aria-label="Date mailed"
                            value={mailedOn[b.id] ?? todayIso()}
                            max={todayIso()}
                            onChange={(e) => {
                              const value = e.currentTarget.value;
                              setMailedOn((m) => ({ ...m, [b.id]: value }));
                            }}
                            disabled={!canDeliver}
                          />
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => markMailed.mutate(b.id)}
                            loading={markMailed.isPending && markMailed.variables === b.id}
                            disabled={!canDeliver || reason.trim().length < 3}
                          >
                            Mark mailed
                          </Button>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Card>
      )}

      {summary.problems.length > 0 && (
        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600} c="orange">
              {summary.problems.length} email(s) could not be delivered
            </Text>
            <Text size="sm" c="dimmed">
              These receipts have moved to mail and will be in the next print batch. Check the donor's email
              address in Qomon; each is also in the work queue's Delivery tab.
            </Text>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Receipt</Table.Th>
                  <Table.Th>Donor</Table.Th>
                  <Table.Th>Reason</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summary.problems.map((p) => (
                  <Table.Tr key={p.workItemId}>
                    <Table.Td>{p.receiptNumber}</Table.Td>
                    <Table.Td>{p.contactName}</Table.Td>
                    <Table.Td>{p.detail ?? '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
