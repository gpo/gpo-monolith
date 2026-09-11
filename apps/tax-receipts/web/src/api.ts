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
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
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
  can: { issueReceipts: boolean; administerKillSwitch: boolean };
}

export interface ContributionListRow {
  id: string;
  qomonTransactionId: string;
  contactName: string;
  contactEmail: string | null;
  amountCents: number;
  currency: string;
  acceptedAt: string;
  statusKind: string;
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

function filtersToQuery(filters: ContributionListFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface ContributionDetail {
  id: string;
  qomonTransactionId: string;
  qomonBundleId: string | null;
  contact: { id: string; name: string; email: string | null };
  amountCents: number;
  currency: string;
  acceptedAt: string;
  paymentMethodKind: string | null;
  statusKind: string;
  codeCampaign: string | null;
  comment: string | null;
  externalRef: string | null;
  firstSeenAt: string;
  lastSyncedAt: string | null;
  deletedInQomonAt: string | null;
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
    checksum: string | null;
    syncedAt: string | null;
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
  refreshContribution: (id: string) =>
    request<{ outcome: string }>(`/contributions/${id}/refresh`, { method: 'POST' }),
  editContributionMetadata: (id: string, input: MetadataEditInput) =>
    request<unknown>(`/contributions/${id}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};
