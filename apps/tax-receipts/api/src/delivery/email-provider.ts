/**
 * The email provider seam (ticket 3.6). Everything above this file (the
 * outbox, the dispatcher, the webhook route, bounce handling) talks to an
 * `EmailProvider`, never to a vendor SDK, so replacing Resend is one new
 * adapter plus a line in `buildEmailProvider`. An adapter owns exactly two
 * things: sending one message, and turning the vendor's webhook request into
 * provider-neutral `EmailDeliveryEvent`s.
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments: EmailAttachment[];
  /** stable per outbox row; a retry of the same row reuses it, so a send the
   *  provider accepted before a crash is not sent twice (where the provider
   *  supports idempotency keys). */
  idempotencyKey: string;
  /** provider-side tags, for filtering in the provider's own dashboard */
  tags?: Record<string, string>;
}

export interface EmailSendResult {
  providerMessageId: string;
}

/** A send the provider refused. `retryable` separates "try again later"
 *  (rate limit, 5xx, network) from "this message will never go" (a
 *  validation error, a bad address). */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/** What the tool does with a provider event. `bounced` is a permanent
 *  bounce; a temporary one arrives as `delayed`. `suppressed` means the
 *  provider refused to try (the address is on its suppression list), which
 *  the tool treats the same as a bounce. */
export type EmailDeliveryEventType =
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'suppressed'
  | 'complained'
  | 'failed';

export interface EmailDeliveryEvent {
  /** dedupes the provider's at-least-once webhook redelivery */
  providerEventId: string;
  providerMessageId: string;
  type: EmailDeliveryEventType;
  occurredAt: Date;
  detail?: string;
  payload: unknown;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}

export class WebhookVerificationError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface EmailProvider {
  /** short, stable name stored on each sent message (`EmailMessage.provider`) */
  readonly name: string;
  send(email: OutgoingEmail): Promise<EmailSendResult>;
  /** Verifies and parses one webhook delivery. Throws
   *  `WebhookVerificationError` when the request is not authentic. Returns
   *  an empty list for event types the tool does not act on. Absent when the
   *  provider has no webhooks (the dev adapter). */
  parseWebhook?(request: WebhookRequest): EmailDeliveryEvent[];
}
