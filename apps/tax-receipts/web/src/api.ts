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
  refreshContribution: (id: string) =>
    request<{ outcome: string }>(`/contributions/${id}/refresh`, { method: 'POST' }),
  editContributionMetadata: (id: string, input: MetadataEditInput) =>
    request<unknown>(`/contributions/${id}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listWorkItems: (filters: { kind?: string; status?: string; cursor?: string } = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const qs = params.toString();
    return request<WorkItemListPage>(`/work-items${qs ? `?${qs}` : ''}`);
  },
  resolveWorkItem: (id: string, input: { reason: string; outcome: 'RESOLVED' | 'EXCEPTION' }) =>
    request<WorkItemRow>(`/work-items/${id}/resolve`, { method: 'POST', body: JSON.stringify(input) }),
  listSpaces: () => request<{ data: SpaceDashboardRow[] }>('/spaces'),
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
};
