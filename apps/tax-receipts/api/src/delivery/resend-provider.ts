import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  EmailSendError,
  WebhookVerificationError,
  type EmailDeliveryEvent,
  type EmailDeliveryEventType,
  type EmailProvider,
  type EmailSendResult,
  type OutgoingEmail,
  type WebhookRequest,
} from './email-provider.js';

/**
 * Resend adapter (ticket 3.6). Plain `fetch` against the REST API rather than
 * the SDK: one endpoint, and nothing vendor-shaped leaks past this file.
 *
 * Send: `POST /emails` with base64 attachments and an `Idempotency-Key`
 * (Resend keeps keys for 24 hours). Resend refuses requests without a
 * User-Agent (error 1010), so one is always set.
 *
 * Webhooks are signed the Svix way: HMAC-SHA256, keyed with the base64 part
 * of the `whsec_` secret, over `${svix-id}.${svix-timestamp}.${rawBody}`,
 * compared against any `v1,<base64>` entry in `svix-signature`. A timestamp
 * more than five minutes off is refused, so a captured request cannot be
 * replayed later.
 */

const DEFAULT_BASE_URL = 'https://api.resend.com';
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface ResendProviderOptions {
  apiKey: string;
  /** e.g. `Green Party of Ontario <receipts@mail.gpo.ca>`; must be on a
   *  domain verified in Resend */
  from: string;
  replyTo?: string;
  /** `whsec_...`; without it, webhook requests are refused */
  webhookSecret?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

const EVENT_TYPES: Record<string, EmailDeliveryEventType> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.suppressed': 'suppressed',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

function header(headers: WebhookRequest['headers'], name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly opts: ResendProviderOptions) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  async send(email: OutgoingEmail): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          'content-type': 'application/json',
          'user-agent': 'gpo-tax-receipts',
          'idempotency-key': email.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.opts.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          ...(email.html ? { html: email.html } : {}),
          ...(this.opts.replyTo ? { reply_to: this.opts.replyTo } : {}),
          attachments: email.attachments.map((a) => ({
            filename: a.filename,
            content: a.content.toString('base64'),
            content_type: a.contentType,
          })),
          ...(email.tags
            ? { tags: Object.entries(email.tags).map(([name, value]) => ({ name, value })) }
            : {}),
        }),
      });
    } catch (err) {
      throw new EmailSendError(`resend: ${err instanceof Error ? err.message : 'network error'}`, true);
    }

    const body = (await response.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const detail = body?.message ?? body?.name ?? response.statusText;
      throw new EmailSendError(`resend ${response.status}: ${detail}`, retryable);
    }
    if (!body?.id) throw new EmailSendError('resend: response carried no email id', true);
    return { providerMessageId: body.id };
  }

  parseWebhook(request: WebhookRequest): EmailDeliveryEvent[] {
    this.verify(request);

    let event: {
      type?: string;
      created_at?: string;
      data?: {
        email_id?: string;
        bounce?: { type?: string; subType?: string; message?: string };
        suppressed?: { type?: string; message?: string };
        failed?: { reason?: string };
      };
    };
    try {
      event = JSON.parse(request.rawBody);
    } catch {
      throw new WebhookVerificationError('webhook body is not JSON');
    }

    const type = event.type ? EVENT_TYPES[event.type] : undefined;
    const providerMessageId = event.data?.email_id;
    if (!type || !providerMessageId) return [];

    const data = event.data!;
    const detail =
      data.bounce
        ? [data.bounce.type, data.bounce.subType, data.bounce.message].filter(Boolean).join(': ')
        : data.suppressed
          ? [data.suppressed.type, data.suppressed.message].filter(Boolean).join(': ')
          : data.failed?.reason;

    return [
      {
        providerEventId: header(request.headers, 'svix-id')!,
        providerMessageId,
        type,
        occurredAt: event.created_at ? new Date(event.created_at) : this.now(),
        ...(detail ? { detail } : {}),
        payload: event,
      },
    ];
  }

  private verify(request: WebhookRequest): void {
    if (!this.opts.webhookSecret) {
      throw new WebhookVerificationError('no webhook secret configured');
    }
    const id = header(request.headers, 'svix-id');
    const timestamp = header(request.headers, 'svix-timestamp');
    const signatures = header(request.headers, 'svix-signature');
    if (!id || !timestamp || !signatures) {
      throw new WebhookVerificationError('missing webhook signature headers');
    }

    const seconds = Number(timestamp);
    const skew = Math.abs(this.now().getTime() / 1000 - seconds);
    if (!Number.isFinite(seconds) || skew > WEBHOOK_TOLERANCE_SECONDS) {
      throw new WebhookVerificationError('webhook timestamp outside tolerance');
    }

    const key = Buffer.from(this.opts.webhookSecret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${request.rawBody}`).digest();
    const matches = signatures.split(' ').some((entry) => {
      const [version, signature] = entry.split(',');
      if (version !== 'v1' || !signature) return false;
      const given = Buffer.from(signature, 'base64');
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
    if (!matches) throw new WebhookVerificationError('webhook signature does not match');
  }
}
