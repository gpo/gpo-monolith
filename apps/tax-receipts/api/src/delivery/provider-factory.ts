import type { Env } from '../env.js';
import { DevEmailProvider } from './dev-provider.js';
import type { EmailProvider } from './email-provider.js';
import { ResendEmailProvider } from './resend-provider.js';

/** The one place that knows which adapters exist (ticket 3.6). A new
 *  provider is a new `EmailProvider` implementation and a case here. */
export function buildEmailProvider(env: Env): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailProvider({
        apiKey: env.RESEND_API_KEY!,
        from: env.EMAIL_FROM,
        replyTo: env.EMAIL_REPLY_TO,
        webhookSecret: env.RESEND_WEBHOOK_SECRET,
      });
    case 'dev':
      return new DevEmailProvider();
  }
}
