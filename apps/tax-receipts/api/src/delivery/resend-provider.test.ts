import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EmailSendError, WebhookVerificationError } from './email-provider.js';
import { ResendEmailProvider } from './resend-provider.js';

const SECRET_BYTES = Buffer.from('a-test-webhook-secret-32-bytes!!');
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;
const NOW = new Date('2026-12-01T15:00:00Z');

function sign(id: string, timestamp: string, body: string, key = SECRET_BYTES): string {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function provider(fetchImpl?: typeof fetch) {
  return new ResendEmailProvider({
    apiKey: 're_test',
    from: 'GPO <receipts@mail.example.org>',
    replyTo: 'donations@example.org',
    webhookSecret: SECRET,
    fetch: fetchImpl,
    now: () => NOW,
  });
}

const EMAIL = {
  to: 'dana@example.org',
  subject: 'Your receipt',
  text: 'Dana',
  html: '<p>Dana</p>',
  attachments: [{ filename: 'GPO-1.pdf', content: Buffer.from('%PDF'), contentType: 'application/pdf' }],
  idempotencyKey: 'msg_1',
  tags: { purpose: 'receipt' },
};

describe('ResendEmailProvider.send', () => {
  it('posts the message with base64 attachments, an idempotency key, and a user agent', async () => {
    const { impl, calls } = fakeFetch(200, { id: 'resend-id-1' });
    const result = await provider(impl).send(EMAIL);

    expect(result).toEqual({ providerMessageId: 'resend-id-1' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test');
    expect(headers['idempotency-key']).toBe('msg_1');
    expect(headers['user-agent']).toBeTruthy();
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({
      from: 'GPO <receipts@mail.example.org>',
      to: ['dana@example.org'],
      reply_to: 'donations@example.org',
      subject: 'Your receipt',
      attachments: [{ filename: 'GPO-1.pdf', content: Buffer.from('%PDF').toString('base64') }],
      tags: [{ name: 'purpose', value: 'receipt' }],
    });
  });

  it('treats a rate limit or server error as retryable and a validation error as final', async () => {
    const rateLimited = provider(fakeFetch(429, { message: 'Too many requests' }).impl).send(EMAIL);
    await expect(rateLimited).rejects.toMatchObject({ retryable: true });
    const serverError = provider(fakeFetch(503, {}).impl).send(EMAIL);
    await expect(serverError).rejects.toMatchObject({ retryable: true });
    const invalid = provider(fakeFetch(422, { message: 'Invalid `to` field' }).impl).send(EMAIL);
    await expect(invalid).rejects.toBeInstanceOf(EmailSendError);
    await expect(invalid).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('Invalid') });
  });

  it('treats a network failure as retryable', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(provider(impl).send(EMAIL)).rejects.toMatchObject({ retryable: true });
  });
});

describe('ResendEmailProvider.parseWebhook', () => {
  const bounced = JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-12-01T14:59:00.000Z',
    data: {
      email_id: 'resend-id-1',
      to: ['dana@example.org'],
      bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' },
    },
  });
  const timestamp = String(Math.floor(NOW.getTime() / 1000));

  function request(body: string, overrides: Record<string, string> = {}) {
    return {
      headers: {
        'svix-id': 'evt_1',
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${sign('evt_1', timestamp, body)}`,
        ...overrides,
      },
      rawBody: body,
    };
  }

  it('verifies the signature and maps a bounce to a provider-neutral event', () => {
    const events = provider().parseWebhook(request(bounced));
    expect(events).toEqual([
      {
        providerEventId: 'evt_1',
        providerMessageId: 'resend-id-1',
        type: 'bounced',
        occurredAt: new Date('2026-12-01T14:59:00.000Z'),
        detail: 'Permanent: General: mailbox does not exist',
        payload: JSON.parse(bounced),
      },
    ]);
  });

  it('accepts any matching signature among several (secret rotation)', () => {
    const header = `v1,${sign('evt_1', timestamp, bounced, Buffer.from('an-old-secret'))} v1,${sign('evt_1', timestamp, bounced)}`;
    expect(provider().parseWebhook(request(bounced, { 'svix-signature': header }))).toHaveLength(1);
  });

  it('refuses a tampered body, a wrong signature, a stale timestamp, and missing headers', () => {
    const p = provider();
    expect(() => p.parseWebhook({ ...request(bounced), rawBody: bounced.replace('Permanent', 'Transient') })).toThrow(
      WebhookVerificationError,
    );
    expect(() => p.parseWebhook(request(bounced, { 'svix-signature': 'v1,AAAA' }))).toThrow(WebhookVerificationError);
    const stale = String(Number(timestamp) - 10 * 60);
    expect(() =>
      p.parseWebhook(
        request(bounced, { 'svix-timestamp': stale, 'svix-signature': `v1,${sign('evt_1', stale, bounced)}` }),
      ),
    ).toThrow(WebhookVerificationError);
    expect(() => p.parseWebhook({ headers: {}, rawBody: bounced })).toThrow(WebhookVerificationError);
  });

  it('refuses everything when no secret is configured', () => {
    const p = new ResendEmailProvider({ apiKey: 're_test', from: 'x@example.org', now: () => NOW });
    expect(() => p.parseWebhook(request(bounced))).toThrow(WebhookVerificationError);
  });

  it('ignores event types the tool does not act on', () => {
    const opened = JSON.stringify({ type: 'email.opened', created_at: NOW.toISOString(), data: { email_id: 'x' } });
    expect(provider().parseWebhook(request(opened))).toEqual([]);
  });
});
