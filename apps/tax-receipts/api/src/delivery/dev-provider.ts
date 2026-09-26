import type { EmailProvider, EmailSendResult, OutgoingEmail } from './email-provider.js';

/**
 * Development and test adapter (ticket 3.6): accepts every message and sends
 * nothing. The outbox row itself is the record, so Admin > Dev tools lists
 * what "went out", and the dev-only simulate endpoint plays the webhook
 * events a real provider would send (delivered, bounced) through the same
 * handling code.
 */
export class DevEmailProvider implements EmailProvider {
  readonly name = 'dev';
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<EmailSendResult> {
    this.sent.push(email);
    return { providerMessageId: `dev_${email.idempotencyKey}` };
  }
}
