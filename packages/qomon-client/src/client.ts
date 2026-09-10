import { z } from 'zod';
import type { QomonMetadataEnvelope } from '@gpo/tax-receipts-core';
import type {
  BundlePatch,
  CreateBundleInput,
  ListBundlesParams,
  ListPage,
  QomonApi,
} from './api.js';
import { GuardedContactWriter } from './contact-write.js';
import { QomonHttp, type QomonHttpOptions } from './http.js';
import {
  QomonBundle,
  QomonCodeCampaign,
  QomonContact,
  QomonHistoryEntry,
  QomonTransactionSettings,
  QomonTransactionStatus,
} from './types.js';

export type QomonClientOptions = QomonHttpOptions;

/**
 * Typed Qomon REST client. Self-throttled, backed off, Bearer-authed. Every
 * write is idempotent by construction (whole-object metadata keyed by checksum;
 * contact create is the sync endpoint). Contact writes go through
 * {@link GuardedContactWriter} so the record-dropping async upsert is
 * unreachable.
 */
export class QomonClient implements QomonApi {
  private readonly http: QomonHttp;
  private readonly contacts: GuardedContactWriter;

  constructor(opts: QomonClientOptions) {
    this.http = new QomonHttp(opts);
    this.contacts = new GuardedContactWriter({
      createContact: (c) =>
        this.http
          .request({
            method: 'POST',
            path: '/contacts',
            body: { data: { contact: c } },
            schema: z.object({ contact: QomonContact }).or(QomonContact),
          })
          .then((r) => normalizeContact(r.data)),
      replaceContact: (id, c) =>
        this.http
          .request({
            method: 'PATCH',
            path: `/contacts/${id}`,
            body: { data: { contact: c } },
            schema: z.object({ contact: QomonContact }).or(QomonContact),
          })
          .then((r) => normalizeContact(r.data)),
      getContact: (id) =>
        this.http
          .request({
            method: 'GET',
            path: `/contacts/${id}`,
            schema: z.object({ contact: QomonContact }).or(QomonContact),
          })
          .then((r) => normalizeContact(r.data)),
    });
  }

  async listTransactionBundles(
    params: ListBundlesParams = {},
  ): Promise<ListPage<QomonBundle>> {
    const res = await this.http.request({
      method: 'GET',
      path: '/v1/transaction_bundles',
      query: { limit: params.limit ?? 100, offset: params.offset ?? 0 },
      schema: z.array(QomonBundle),
    });
    return { data: res.data, total: res.total };
  }

  async getTransactionBundle(id: number): Promise<QomonBundle> {
    const res = await this.http.request({
      method: 'GET',
      path: `/v1/transaction_bundles/${id}`,
      schema: QomonBundle,
    });
    return res.data;
  }

  async createTransactionBundle(input: CreateBundleInput): Promise<QomonBundle> {
    const res = await this.http.request({
      method: 'POST',
      path: '/v1/transaction_bundles',
      body: { data: input },
      schema: QomonBundle,
    });
    return res.data;
  }

  async patchTransactionBundle(patch: BundlePatch): Promise<QomonBundle> {
    const res = await this.http.request({
      method: 'PATCH',
      path: `/v1/transaction_bundles/${patch.id}`,
      body: { data: patch },
      schema: QomonBundle,
    });
    return res.data;
  }

  async getTransactionBundleHistory(id: number): Promise<QomonHistoryEntry[]> {
    const res = await this.http.request({
      method: 'GET',
      path: `/v1/transaction_bundles/${id}/history`,
      // the spec declares `data` as an object where a list is expected; accept both
      schema: z.array(QomonHistoryEntry).or(QomonHistoryEntry.transform((e) => [e])),
    });
    return res.data;
  }

  async listTransactionStatuses(): Promise<QomonTransactionStatus[]> {
    const res = await this.http.request({
      method: 'GET',
      path: '/v1/transaction_statuses',
      schema: z.array(QomonTransactionStatus),
    });
    return res.data;
  }

  async listCodeCampaigns(): Promise<QomonCodeCampaign[]> {
    const res = await this.http.request({
      method: 'GET',
      path: '/v1/code_campaigns',
      schema: z.array(QomonCodeCampaign),
    });
    return res.data;
  }

  async getTransactionSettings(): Promise<QomonTransactionSettings> {
    const res = await this.http.request({
      method: 'GET',
      path: '/v1/transaction_settings',
      schema: QomonTransactionSettings,
    });
    return res.data;
  }

  async writeTransactionMetadata(
    bundleId: number,
    transactionId: number,
    metadata: QomonMetadataEnvelope,
  ): Promise<QomonBundle> {
    return this.patchTransactionBundle({
      id: bundleId,
      transactions: [{ id: transactionId, metadata }],
    });
  }

  createContact(contact: QomonContact) {
    return this.contacts.createContact(contact);
  }
  replaceContact(id: number, contact: QomonContact) {
    return this.contacts.replaceContact(id, contact);
  }
  getContact(id: number) {
    return this.contacts.getContact(id);
  }
}

function normalizeContact(data: unknown): QomonContact {
  if (data && typeof data === 'object' && 'contact' in data) {
    return (data as { contact: QomonContact }).contact;
  }
  return data as QomonContact;
}
