/**
 * Thin client for the tax-receipts API. In dev, Vite proxies `/api/*` to the
 * Fastify server (see vite.config.ts); in production the two are served from
 * the same origin.
 */
const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    // Only claim a JSON body when one is actually being sent — Fastify's
    // default JSON body parser 400s ("Body cannot be empty when
    // content-type is set to 'application/json'") on a bodyless request
    // (e.g. POST /refresh, POST /logout) that still carries this header.
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string })?.error ?? res.statusText);
  }
  return body as T;
}

export interface Health {
  status: 'ok';
  service: string;
  time: string;
  db: 'up' | 'down';
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  allRidings: boolean;
  ridingGrants: number[];
  can: {
    issueReceipts: boolean;
    sendDonorPrechecks: boolean;
    administerKillSwitch: boolean;
    generateEntityReports: boolean;
    shareEntityReports: boolean;
    prepareRtdFilings: boolean;
    sendRtdFilings: boolean;
    fileEOForms: boolean;
    enterPayments: boolean;
    correctContributions: boolean;
    correctReceipts: boolean;
  };
}

export interface ContributionListRow {
  id: string;
  /** null for manual and legacy-imported payments */
  qomonTransactionId: string | null;
  source: string;
  contactName: string;
  contactEmail: string | null;
  amountCents: number;
  currency: string;
  acceptedAt: string;
  paymentState: string;
  periodId: number | null;
  ridingNumber: number | null;
  entityKind: string | null;
  receivedBy: string | null;
  sourceCode: string | null;
  nonDeductibleCents: number | null;
  hasReceipt: boolean;
  openValidationCount: number;
  lastSyncedAt: string | null;
}

export interface ContributionListPage {
  data: ContributionListRow[];
  nextCursor: string | null;
}

export interface ContributionListFilters {
  periodId?: number;
  ridingNumber?: number;
  partyLevelOnly?: boolean;
  entityKind?: string;
  receivedBy?: string;
  contactQuery?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
  acceptedFrom?: string; // ISO date
  acceptedTo?: string;
  hasOpenValidation?: boolean;
  ruleRef?: string;
  hasReceipt?: boolean;
  cursor?: string;
}

function filtersToQuery(filters: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface ContributionDetail {
  id: string;
  status: string;
  supersedesId: string | null;
  contact: {
    id: string;
    name: string;
    email: string | null;
    address: { line1: string; city: string; province: string; postalCode: string; country: string } | null;
  };
  amountCents: number;
  acceptedAt: string;
  note: string | null;
  /** the money event behind this contribution */
  payment: {
    id: string;
    source: string;
    method: string;
    state: string;
    amountCents: number;
    currency: string;
    receivedAt: string;
    externalRef: string | null;
    payerName: string | null;
    note: string | null;
    /** what no ACTIVE contribution on this payment covers yet */
    unattributedCents: number;
  };
  /** import provenance; null for manual and legacy-imported payments */
  qomon: {
    transactionId: string;
    bundleId: string | null;
    paymentMethodKind: string | null;
    codeCampaign: string | null;
    firstSeenAt: string;
    lastSyncedAt: string | null;
    deletedInQomonAt: string | null;
  } | null;
  metadata: {
    periodId: number;
    ridingNumber: number | null;
    entityKind: string;
    receivedBy: string;
    goodsServices: boolean;
    nonDeductibleCents: number;
    processedDate: string | null;
    sourceCode: string;
    eoContributorId: string | null;
    exceptionReason: string | null;
  } | null;
  allocations: Array<{
    id: string;
    amountCents: number;
    receipt: { id: string; receiptNumber: string; status: string; issueDate: string };
  }>;
  rtdInclusions: Array<{ id: string; rtdFilingId: string; amountCents: number; aggregateAfterCents: number }>;
  workItems: Array<{
    id: string;
    kind: string;
    ruleRef: string | null;
    status: string;
    openedAt: string;
    closedAt: string | null;
    resolutionNote: string | null;
  }>;
  changeLog: Array<{
    id: string;
    subjectType: string;
    actorUserId: string | null;
    reason: string;
    before: unknown;
    after: unknown;
    at: string;
    correlationId: string;
  }>;
}

// --- corrections (corrections.md; api/src/corrections) ----------------------

export interface CorrectionPart {
  amountCents: number;
  contactId?: string;
  entityKind?: 'PARTY' | 'CA' | 'CAMPAIGN';
  ridingNumber?: number | null;
  nonDeductibleCents?: number;
}

interface CorrectionCommon {
  reason: string;
  politicalEntityLabel?: string;
  entityLabels?: Record<string, string>;
}

export type CorrectionRequest =
  | (CorrectionCommon & {
      action: 'CORRECT_AMOUNT';
      contributionId: string;
      amountCents: number;
      nonDeductibleCents?: number;
      paymentAmountCents?: number;
    })
  | (CorrectionCommon & { action: 'MOVE'; contributionIds: string[]; toContactId: string })
  | (CorrectionCommon & { action: 'SPLIT_CONTRIBUTION'; contributionId: string; parts: CorrectionPart[] })
  | (CorrectionCommon & { action: 'REALLOCATE'; contributionId: string; parts: CorrectionPart[] })
  | (CorrectionCommon & { action: 'REFUND'; contributionIds?: string[]; paymentId?: string })
  | (CorrectionCommon & { action: 'MERGE_CONTACTS'; survivorId: string; mergedAwayId: string; evidence?: string });

export interface CorrectionPlan {
  action: string;
  changes: Array<{
    contributionId: string;
    kind: 'supersede' | 'refund';
    before: { contactName: string; amountCents: number; entityKind: string; ridingNumber: number | null };
    replacements: Array<{
      ref: string;
      contactName: string;
      amountCents: number;
      entityKind: string;
      ridingNumber: number | null;
      nonDeductibleCents: number;
    }>;
  }>;
  payments: Array<{ paymentId: string; amountBeforeCents: number; amountAfterCents: number; stateBefore: string; stateAfter: string }>;
  cancelReceipts: Array<{ receiptId: string; receiptNumber: string; contactName: string; totalAmountCents: number; hasPdf: boolean }>;
  issueReceipts: Array<{
    key: string;
    contactName: string;
    entityKind: string;
    ridingNumber: number | null;
    totalAmountCents: number;
    replacesReceiptNumber: string | null;
  }>;
  owedToEo: Array<{ kind: 'DC1A' | 'RETURN_NOTE'; description: string }>;
  dirtyReports: Array<{ entityReportId: string; kind: string; periodId: number; filed: boolean }>;
  labelsNeeded: Array<{ entityKind: string; ridingNumber: number | null; key: string }>;
  followUps: string[];
  blockers: string[];
}

export interface CorrectionResult {
  correlationId: string;
  supersededContributionIds: string[];
  refundedContributionIds: string[];
  createdContributionIds: string[];
  cancelledReceiptIds: string[];
  issuedReceipts: Array<{ id: string; receiptNumber: string; contactId: string; amountCents: number }>;
  owedToEoWorkItemIds: string[];
  followUps: string[];
  validationFailures: string[];
}

export interface ContactHit {
  id: string;
  name: string;
  email: string | null;
  qomonContactId: string | null;
}

export interface ReallocationProposal {
  contributionId: string;
  year: number;
  amountCents: number;
  overLimitBucket: { bucket: string; limitCents: number; aggregateCents: number; overageCents: number } | null;
  options: Array<{
    entityKind: 'PARTY' | 'CA' | 'CAMPAIGN';
    ridingNumber: number | null;
    needsRiding: boolean;
    headroomCents: number;
    moveCents: number;
  }>;
}

export interface ReprintInput {
  kind: 'LOST_COPY' | 'CORRECTED';
  reason: string;
  correctedName?: string;
  politicalEntityLabel: string;
}

// --- manual entry (D12; api/src/payments) -----------------------------------

export type PaymentMethodKey = 'CARD' | 'CHEQUE' | 'CASH' | 'PAD' | 'EFT' | 'IN_KIND' | 'OTHER';

/** Only the fields the operator chose; the server derives the rest from the date. */
export interface DescriptiveOverrides {
  period_id?: number;
  riding_number?: number | null;
  entity_kind?: 'PARTY' | 'CA' | 'CAMPAIGN';
  received_by?: 'GPO' | 'ENTITY';
  goods_services?: boolean;
  non_deductible_cents?: number;
  source_code?: string;
}

export interface ContributionEntryInput {
  amountCents: number;
  contactId?: string;
  acceptedAt?: string;
  note?: string | null;
  descriptive?: DescriptiveOverrides;
}

export interface NewPaymentInput {
  reason: string;
  contactId: string;
  amountCents: number;
  receivedAt: string;
  method: PaymentMethodKey;
  payerName?: string | null;
  externalRef?: string | null;
  note?: string | null;
  contributions?: ContributionEntryInput[];
}

export interface IntakeFlag {
  field: string;
  reason: string;
}

export interface IntakePreview {
  descriptive: { period_id: number; riding_number: number | null; entity_kind: string; received_by: string } | null;
  flags: IntakeFlag[];
}

export interface PaymentSummary {
  id: string;
  contactId: string;
  contactName: string;
  amountCents: number;
  receivedAt: string;
  method: string;
  state: string;
  source: string;
  externalRef: string | null;
  attributedCents: number;
  unattributedCents: number;
  contributions: Array<{ id: string; contactName: string; amountCents: number; status: string }>;
}

export interface IssueReceiptInput {
  reason: string;
  amountCents?: number;
  delivery?: 'EMAIL' | 'MAIL';
  politicalEntityLabel: string;
}

export interface IssuedReceipt {
  id: string;
  receiptNumber: string;
  amountCents: number;
  pdfArtifactId: string;
}

export interface MetadataEditInput {
  reason: string;
  periodId: number;
  ridingNumber: number | null;
  entityKind: string;
  receivedBy: string;
  goodsServices: boolean;
  nonDeductibleCents: number;
  processedDate: string | null;
  sourceCode: string;
  eoContributorId: string | null;
  exceptionReason: string | null;
  externalRef: string | null;
}

export interface WorkItemRow {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  contactId: string | null;
  contactName: string | null;
  ruleRef: string | null;
  dueAt: string | null;
  status: string;
  assigneeUserId: string | null;
  resolutionNote: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface WorkItemListPage {
  data: WorkItemRow[];
  nextCursor: string | null;
}

export interface SpaceDashboardRow {
  periodId: number;
  ridingNumber: number | null;
  entityKind: string;
  stage: string;
  stageOwner: string | null;
  contributionCount: number;
  openWorkItemCount: number;
}

export interface SpaceIssuanceBlocker {
  workItemId: string;
  contributionId: string;
  contactId: string | null;
  contactName: string | null;
  kind: string;
  ruleRef: string | null;
}

export interface SpaceIssuanceLine {
  contributionId: string;
  contactId: string;
  contactName: string;
  amountCents: number;
  delivery: 'EMAIL' | 'MAIL';
}

export interface SpaceIssuanceTotals {
  receiptCount: number;
  amountCents: number;
  emailCount: number;
  mailCount: number;
}

export interface SpaceIssuancePreview {
  blocked: boolean;
  blockers: SpaceIssuanceBlocker[];
  lines: SpaceIssuanceLine[];
  totals: SpaceIssuanceTotals;
}

export interface SpaceIssuanceRowResult {
  contributionId: string;
  ok: boolean;
  receiptId?: string;
  receiptNumber?: string;
  amountCents?: number;
  error?: string;
}

export interface SpaceIssuanceResult {
  results: SpaceIssuanceRowResult[];
  succeeded: number;
  failed: number;
}

export interface IssueSpaceReceiptsInput {
  reason: string;
  politicalEntityLabel: string;
  delivery?: 'EMAIL' | 'MAIL';
}

export interface SentDonorPrecheck {
  contactId: string;
  contactName: string;
  email: string;
  precheckSentAt: string;
  confirmationToken: string;
  confirmationTokenExpiresAt: string;
  emailMessageId: string | null;
}

export interface SkippedDonorPrecheck {
  contactId: string;
  contactName: string;
  reason: 'no-email-on-file';
}

export interface SendDonorPrechecksResult {
  sent: SentDonorPrecheck[];
  skipped: SkippedDonorPrecheck[];
}

export interface SpaceDeliverySummary {
  issuedCount: number;
  deliveredCount: number;
  email: { readyToQueue: number; queued: number; sent: number; delivered: number };
  mail: { readyToPrint: number; printed: number; mailed: number };
  printBatches: Array<{ id: string; receiptCount: number; createdAt: string; mailedAt: string | null }>;
  problems: Array<{ receiptId: string; receiptNumber: string; contactName: string; workItemId: string; detail: string | null }>;
  stage: string;
}

export interface QueueReceiptEmailsResult {
  queued: Array<{ receiptId: string; receiptNumber: string; emailMessageId: string; toAddress: string }>;
  movedToMail: Array<{ receiptId: string; receiptNumber: string; contactName: string }>;
}

export interface MarkPrintBatchMailedResult {
  deliveredCount: number;
  skipped: Array<{ receiptId: string; receiptNumber: string; status: string }>;
  closedWorkItemIds: string[];
}

export interface OutboxEmail {
  id: string;
  purpose: 'RECEIPT' | 'PRECHECK';
  status: string;
  statusDetail: string | null;
  toAddress: string;
  contactName: string;
  receiptNumber: string | null;
  subject: string;
  textBody: string;
  attempts: number;
  queuedAt: string;
  sentAt: string | null;
  providerMessageId: string | null;
}

export interface DispatchResult {
  sent: number;
  retrying: number;
  failed: number;
  heldByKillSwitch: boolean;
  dailyLimitReached: boolean;
}

export interface DonorPrecheckAddress {
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
}

export interface ConfirmedDonorPrecheck {
  contactId: string;
  year: number;
  delivery: 'EMAIL' | 'MAIL';
  addressConfirmedAt: string;
  addressSnapshotId: string;
}

export interface OutstandingDonorPrecheck {
  contactId: string;
  contactName: string;
  email: string | null;
  year: number;
  precheckSentAt: string;
  confirmationToken: string;
  confirmationTokenExpiresAt: string;
}

export interface ChangeLogRow {
  id: string;
  subjectType: string;
  subjectId: string;
  actorUserId: string | null;
  actorName: string | null;
  reason: string;
  before: unknown;
  after: unknown;
  at: string;
  correlationId: string;
}

export interface ChangeLogFilters {
  subjectType?: string;
  subjectId?: string;
  actorUserId?: string;
  correlationId?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
}

export interface PeriodRow {
  id: number;
  name: string;
  kind: string;
  ridingNumbers: number[];
  startsAt: string;
  endsAt: string;
}

export interface ContributionLimitRow {
  id: string;
  year: number;
  bucket: string;
  amountCents: number;
  notes: string | null;
}

export interface BusinessDayCalendarRow {
  year: number;
  holidays: string[];
}

export interface ContactFetchFailure {
  qomonTransactionId: string;
  qomonContactId: number;
  message: string;
}

export interface SweepResult {
  mode: 'incremental' | 'full';
  pulled: number;
  created: number;
  backfilled: number;
  changedInQomon: number;
  unchanged: number;
  syncIncidents: number;
  hasMore: boolean;
  contactFetchFailures: ContactFetchFailure[];
}

export interface RidingRow {
  ridingNumber: number;
  name: string;
  qomonApiBase: string | null;
  active: boolean;
  qomonApiKeySet: boolean;
  updatedAt: string;
}

export interface RidingImportRow {
  ridingNumber: number;
  name: string;
  qomonApiKey?: string;
  qomonApiBase?: string | null;
  active?: boolean;
}

export interface RidingImportResult {
  imported: number;
  created: number;
  updated: number;
  data: RidingRow[];
}

export interface EntityReportSummaryRow {
  id: string;
  kind: 'ALL' | 'S2P2';
  periodId: number;
  ridingNumber: number | null;
  entityKind: 'PARTY' | 'CA' | 'CAMPAIGN' | null;
  generatedAt: string;
  sentToCfoAt: string | null;
  artifactId: string | null;
  rowCount: number;
  /** null = combined report, not drift-checked (ticket 4.5). */
  dirty: boolean | null;
}

export interface RowFieldDiff {
  field: string;
  before: string | number;
  after: string | number;
}

export interface ReportRow {
  [key: string]: string | number;
}

export interface RowDiff {
  key: string;
  before: ReportRow;
  after: ReportRow;
  fields: RowFieldDiff[];
}

export interface EntityReportDrift {
  status: 'clean' | 'dirty' | 'blocked' | 'not-checked';
  diff: { changed: RowDiff[]; added: ReportRow[]; removed: ReportRow[] } | null;
}

export interface EntityReportDetail {
  report: {
    id: string;
    kind: 'ALL' | 'S2P2';
    periodId: number;
    ridingNumber: number | null;
    entityKind: 'PARTY' | 'CA' | 'CAMPAIGN' | null;
    generatedAt: string;
    sentToCfoAt: string | null;
    artifactId: string | null;
  };
  drift: EntityReportDrift;
}

export interface GenerateEntityReportInput {
  kind: 'ALL' | 'S2P2';
  entityKind: 'PARTY' | 'CA' | 'CAMPAIGN';
  ridingNumber: number | null;
  politicalEntityLabel: string;
  reason: string;
}

export interface GeneratedEntityReportResult {
  entityReportId: string | null;
  artifactId: string | null;
  rowCount: number;
  csv: string | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  isCfoDesignate: boolean;
  allRidings: boolean;
  ridingGrants: number[];
}

export interface RtdFilingSummary {
  id: string;
  name: string;
  kind: 'INITIAL' | 'DC1A_AMENDMENT';
  format: 'CSV' | 'PIPE';
  generatedAt: string;
  submittedAt: string | null;
  submittedBy: string | null;
  artifactId: string | null;
  amendsFilingId: string | null;
  rowCount: number;
}

export interface RtdGateFinding {
  workItemId: string;
  ruleRef: string;
}

export interface RtdDraftRow {
  contributionId: string;
  contactId: string;
  contactFirstName: string;
  contactLastName: string;
  amountCents: number;
  acceptedAt: string;
  contributionYear: number;
  aggregateAfterCents: number;
  periodId: number;
  eoContributorId: string | null;
  dueDate: string;
  businessDaysRemaining: number;
  overdue: boolean;
  gateFindings: RtdGateFinding[];
}

export interface RtdDraft {
  year: number;
  asOf: string;
  rows: RtdDraftRow[];
}

export interface PrepareRtdFilingInput {
  year: number;
  contributionIds: string[];
  reason: string;
  cfoName: string;
  format?: 'CSV' | 'PIPE';
}

export interface PreparedRtdFiling {
  rtdFilingId: string;
  filingName: string;
  preparedCount: number;
  artifactId: string;
  sha256: string;
  byteSize: number;
}

export interface SentRtdFiling {
  rtdFilingId: string;
  submittedAt: string;
}

export const api = {
  health: () => request<Health>('/health'),
  me: () => request<Me>('/auth/me'),
  login: (email: string, password: string) =>
    request<{ id: string; name: string; role: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  killSwitch: () =>
    request<{ engaged: boolean; reason: string | null }>('/admin/kill-switch'),
  setKillSwitch: (engaged: boolean, reason: string) =>
    request<{ engaged: boolean; reason: string | null }>('/admin/kill-switch', {
      method: 'POST',
      body: JSON.stringify({ engaged, reason }),
    }),
  listContributions: (filters: ContributionListFilters = {}) =>
    request<ContributionListPage>(`/contributions${filtersToQuery(filters)}`),
  getContribution: (id: string) => request<ContributionDetail>(`/contributions/${id}`),
  bulkEditContributions: (input: {
    contributionIds: string[];
    reason: string;
    changes: Record<string, unknown>;
  }) =>
    request<{
      results: Array<{ contributionId: string; ok: boolean; error?: string }>;
      succeeded: number;
      failed: number;
    }>('/contributions/bulk-edit', { method: 'POST', body: JSON.stringify(input) }),
  refreshContributionContact: (id: string) =>
    request<{ outcome: 'refreshed' | 'not-linked' | 'not-found-in-qomon' }>(
      `/contributions/${id}/refresh-contact`,
      { method: 'POST' },
    ),
  editContributionMetadata: (id: string, input: MetadataEditInput) =>
    request<unknown>(`/contributions/${id}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  issueReceipt: (contributionId: string, input: IssueReceiptInput) =>
    request<IssuedReceipt>(`/contributions/${contributionId}/receipts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  receiptPdfUrl: (receiptId: string) => `${BASE}/receipts/${receiptId}/pdf`,
  createPayment: (input: NewPaymentInput) =>
    request<{ paymentId: string; contributions: Array<{ id: string; amountCents: number; periodId: number | null; flags: IntakeFlag[] }> }>(
      '/payments',
      { method: 'POST', body: JSON.stringify(input) },
    ),
  addContributionToPayment: (paymentId: string, input: ContributionEntryInput & { reason: string }) =>
    request<{ contributionId: string; remainingCents: number; flags: IntakeFlag[] }>(
      `/payments/${paymentId}/contributions`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  getPayment: (paymentId: string) => request<PaymentSummary>(`/payments/${paymentId}`),
  intakePreview: (q: { acceptedAt: string; ridingNumber?: number | null; sourceCode?: string; externalRef?: string }) => {
    const params = new URLSearchParams({ acceptedAt: q.acceptedAt });
    if (q.ridingNumber != null) params.set('ridingNumber', String(q.ridingNumber));
    if (q.sourceCode) params.set('sourceCode', q.sourceCode);
    if (q.externalRef) params.set('externalRef', q.externalRef);
    return request<IntakePreview>(`/intake-preview?${params.toString()}`);
  },
  searchContacts: (query: string) => request<{ data: ContactHit[] }>(`/contacts?query=${encodeURIComponent(query)}`),
  previewCorrection: (body: CorrectionRequest) =>
    request<CorrectionPlan>('/corrections/preview', { method: 'POST', body: JSON.stringify(body) }),
  applyCorrection: (body: CorrectionRequest) =>
    request<CorrectionResult>('/corrections', { method: 'POST', body: JSON.stringify(body) }),
  reallocationProposal: (contributionId: string) =>
    request<ReallocationProposal>(`/contributions/${contributionId}/reallocation-proposal`),
  cancelReceipt: (receiptId: string, reason: string) =>
    request<{ receiptId: string }>(`/receipts/${receiptId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reissueReceipt: (receiptId: string, input: { reason: string; politicalEntityLabel: string }) =>
    request<{ newReceiptNumber: string }>(`/receipts/${receiptId}/reissue`, { method: 'POST', body: JSON.stringify(input) }),
  reprintReceipt: (receiptId: string, input: ReprintInput) =>
    request<{ reprintId: string; kind: string }>(`/receipts/${receiptId}/reprint`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reprintPdfUrl: (receiptId: string, reprintId: string) => `${BASE}/receipts/${receiptId}/reprints/${reprintId}/pdf`,
  listWorkItems: (filters: { kind?: string; status?: string; cursor?: string } = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const qs = params.toString();
    return request<WorkItemListPage>(`/work-items${qs ? `?${qs}` : ''}`);
  },
  resolveWorkItem: (id: string, input: { reason: string; outcome: 'RESOLVED' | 'EXCEPTION' }) =>
    request<WorkItemRow>(`/work-items/${id}/resolve`, { method: 'POST', body: JSON.stringify(input) }),
  listSpaces: () => request<{ data: SpaceDashboardRow[] }>('/spaces'),
  previewSpaceIssuance: (periodId: number, entityKind: string, ridingNumber: number | null) =>
    request<SpaceIssuancePreview>(
      `/spaces/${periodId}/${entityKind}/issuance-preview${ridingNumber !== null ? `?ridingNumber=${ridingNumber}` : ''}`,
    ),
  issueSpaceReceipts: (
    periodId: number,
    entityKind: string,
    ridingNumber: number | null,
    input: IssueSpaceReceiptsInput,
  ) =>
    request<SpaceIssuanceResult>(
      `/spaces/${periodId}/${entityKind}/receipts${ridingNumber !== null ? `?ridingNumber=${ridingNumber}` : ''}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  sendSpacePrecheck: (
    periodId: number,
    entityKind: string,
    ridingNumber: number | null,
    input: { reason: string; expiresInDays?: number; emailSubject?: string; emailBody?: string },
  ) =>
    request<SendDonorPrechecksResult>(
      `/spaces/${periodId}/${entityKind}/precheck${ridingNumber !== null ? `?ridingNumber=${ridingNumber}` : ''}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  confirmDonorPrecheck: (token: string, input: { delivery: 'EMAIL' | 'MAIL'; address: DonorPrecheckAddress }) =>
    request<ConfirmedDonorPrecheck>(`/donor-precheck/${token}/confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listOutstandingDonorPrechecks: () =>
    request<{ data: OutstandingDonorPrecheck[] }>('/admin/donor-prechecks'),
  getSpaceDelivery: (periodId: number, entityKind: string, ridingNumber: number | null) =>
    request<SpaceDeliverySummary>(
      `/spaces/${periodId}/${entityKind}/delivery${ridingNumber !== null ? `?ridingNumber=${ridingNumber}` : ''}`,
    ),
  queueSpaceReceiptEmails: (
    periodId: number,
    entityKind: string,
    ridingNumber: number | null,
    input: { reason: string; subject: string; coverLetterBody: string },
  ) =>
    request<QueueReceiptEmailsResult>(
      `/spaces/${periodId}/${entityKind}/deliver/email${ridingNumber !== null ? `?ridingNumber=${ridingNumber}` : ''}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  createPrintBatch: (
    periodId: number,
    entityKind: string,
    ridingNumber: number | null,
    input: { reason: string; coverLetterBody: string },
  ) =>
    request<{ printBatch: { id: string }; receiptCount: number }>(
      `/spaces/${periodId}/${entityKind}/print-batches${ridingNumber !== null ? `?ridingNumber=${ridingNumber}` : ''}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  printBatchPdfUrl: (id: string) => `${BASE}/print-batches/${id}/pdf`,
  markPrintBatchMailed: (id: string, input: { reason: string; mailedOn?: string }) =>
    request<MarkPrintBatchMailedResult>(`/print-batches/${id}/mailed`, { method: 'POST', body: JSON.stringify(input) }),
  listOutboxEmails: () => request<{ provider: string; data: OutboxEmail[] }>('/admin/emails'),
  dispatchEmails: () => request<DispatchResult>('/admin/emails/dispatch', { method: 'POST' }),
  simulateEmailEvent: (id: string, type: 'delivered' | 'bounced' | 'complained') =>
    request<{ applied: number }>(`/admin/emails/${id}/simulate`, { method: 'POST', body: JSON.stringify({ type }) }),
  listPeriods: () => request<{ data: PeriodRow[] }>('/admin/periods'),
  savePeriod: (id: number, input: Omit<PeriodRow, 'id'>) =>
    request<{ period: PeriodRow; revalidation: unknown }>(`/admin/periods/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listContributionLimits: () => request<{ data: ContributionLimitRow[] }>('/admin/contribution-limits'),
  saveContributionLimit: (input: Omit<ContributionLimitRow, 'id'>) =>
    request<ContributionLimitRow>('/admin/contribution-limits', { method: 'PUT', body: JSON.stringify(input) }),
  deleteContributionLimit: (id: string) =>
    request<void>(`/admin/contribution-limits/${id}`, { method: 'DELETE' }),
  listBusinessDayCalendars: () => request<{ data: BusinessDayCalendarRow[] }>('/admin/business-day-calendars'),
  saveBusinessDayCalendar: (year: number, holidays: string[]) =>
    request<BusinessDayCalendarRow>(`/admin/business-day-calendars/${year}`, {
      method: 'PUT',
      body: JSON.stringify({ holidays }),
    }),
  listUsers: () => request<{ data: AdminUserRow[] }>('/admin/users'),
  createUser: (input: { name: string; email: string; password: string; role: string }) =>
    request<{ id: string }>('/admin/users', { method: 'POST', body: JSON.stringify(input) }),
  updateUser: (id: string, input: Partial<Pick<AdminUserRow, 'role' | 'active' | 'allRidings' | 'ridingGrants' | 'isCfoDesignate'>>) =>
    request<AdminUserRow>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  listChangeLog: (filters: ChangeLogFilters = {}) =>
    request<{ data: ChangeLogRow[]; nextCursor: string | null }>(
      `/change-log${filtersToQuery(filters)}`,
    ),
  changeLogExportUrl: (filters: Omit<ChangeLogFilters, 'cursor'> = {}) =>
    `${BASE}/change-log/export${filtersToQuery(filters)}`,
  syncSweep: (mode?: 'incremental' | 'full', ridingNumber?: number) =>
    request<SweepResult>('/internal/sync/sweep', {
      method: 'POST',
      body: JSON.stringify({ ...(mode ? { mode } : {}), ...(ridingNumber ? { ridingNumber } : {}) }),
    }),
  listRidings: () => request<{ data: RidingRow[] }>('/admin/ridings'),
  saveRiding: (
    ridingNumber: number,
    input: { name: string; qomonApiKey: string; qomonApiBase?: string | null; active?: boolean },
  ) =>
    request<RidingRow>(`/admin/ridings/${ridingNumber}`, { method: 'PUT', body: JSON.stringify(input) }),
  updateRiding: (
    ridingNumber: number,
    input: Partial<{ name: string; qomonApiKey: string; qomonApiBase: string | null; active: boolean }>,
  ) =>
    request<RidingRow>(`/admin/ridings/${ridingNumber}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteRiding: (ridingNumber: number) =>
    request<void>(`/admin/ridings/${ridingNumber}`, { method: 'DELETE' }),
  importRidings: (rows: RidingImportRow[]) =>
    request<RidingImportResult>('/admin/ridings/import', { method: 'POST', body: JSON.stringify(rows) }),
  listEntityReports: (periodId: number) =>
    request<{ data: EntityReportSummaryRow[] }>(`/periods/${periodId}/entity-reports`),
  generateEntityReport: (periodId: number, input: GenerateEntityReportInput) =>
    request<GeneratedEntityReportResult>(`/periods/${periodId}/entity-reports`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getEntityReport: (id: string) => request<EntityReportDetail>(`/entity-reports/${id}`),
  entityReportCsvUrl: (id: string) => `${BASE}/entity-reports/${id}/csv`,
  markEntityReportSentToCfo: (id: string, reason: string) =>
    request<unknown>(`/entity-reports/${id}/sent-to-cfo`, { method: 'POST', body: JSON.stringify({ reason }) }),
  listRtdFilings: () => request<{ data: RtdFilingSummary[] }>('/rtd/filings'),
  getRtdDraft: (year: number) => request<RtdDraft>(`/rtd/draft?year=${year}`),
  prepareRtdFiling: (input: PrepareRtdFilingInput) =>
    request<PreparedRtdFiling>('/rtd/filings', { method: 'POST', body: JSON.stringify(input) }),
  sendRtdFiling: (id: string, input: { reason: string }) =>
    request<SentRtdFiling>(`/rtd/filings/${id}/send`, { method: 'POST', body: JSON.stringify(input) }),
  rtdFilingDownloadUrl: (id: string) => `${BASE}/rtd/filings/${id}/download`,
};
