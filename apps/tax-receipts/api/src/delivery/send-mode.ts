import { withChangeLog, type ActorContext } from '../changelog/write.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import type { EmailProvider } from './email-provider.js';

/**
 * The live-sending guard. An email reaches the provider only when all three
 * hold:
 *
 *  1. the environment allows it (`EMAIL_LIVE_SENDING_ALLOWED=true`, set in
 *     production only);
 *  2. an administrator has turned live sending on (`EmailDeliverySettings`,
 *     off by default, change-logged);
 *  3. the provider is a real one (the dev adapter never counts as live).
 *
 * Otherwise the dispatcher simulates: the email goes through every step
 * except the provider call (marked SENT, receipt delivered) and is flagged
 * `simulated`, so staging and development behave end to end without
 * emailing a real donor. The env flag is the hard stop: a database copied
 * from production brings its toggle with it, but not the flag.
 */

const SINGLETON_ID = 'singleton';

export type EmailSendMode = 'live' | 'simulated';

export interface EmailDeliverySettingsView {
  provider: string;
  /** EMAIL_LIVE_SENDING_ALLOWED in this environment */
  liveSendingAllowed: boolean;
  /** the admin toggle */
  liveSendingEnabled: boolean;
  /** what the dispatcher will actually do */
  mode: EmailSendMode;
  updatedByUserId: string | null;
  updatedAt: Date | null;
}

export class LiveSendingNotAllowedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('live email sending is not allowed in this environment (EMAIL_LIVE_SENDING_ALLOWED is not set)');
    this.name = 'LiveSendingNotAllowedError';
  }
}

export class DevProviderCannotSendError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('the dev email provider sends nothing; configure a real provider (EMAIL_PROVIDER) first');
    this.name = 'DevProviderCannotSendError';
  }
}

export interface SendModeDeps {
  prisma: PrismaClient;
  provider: EmailProvider;
  liveSendingAllowed: boolean;
}

export async function getEmailDeliverySettings(deps: SendModeDeps): Promise<EmailDeliverySettingsView> {
  const row = await deps.prisma.emailDeliverySettings.findUnique({ where: { id: SINGLETON_ID } });
  const liveSendingEnabled = row?.liveSendingEnabled ?? false;
  const live = deps.liveSendingAllowed && liveSendingEnabled && deps.provider.name !== 'dev';
  return {
    provider: deps.provider.name,
    liveSendingAllowed: deps.liveSendingAllowed,
    liveSendingEnabled,
    mode: live ? 'live' : 'simulated',
    updatedByUserId: row?.updatedByUserId ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function resolveEmailSendMode(deps: SendModeDeps): Promise<EmailSendMode> {
  return (await getEmailDeliverySettings(deps)).mode;
}

/** Turning live sending on is refused unless this environment allows it and
 *  the provider is real; turning it off always works. */
export async function setLiveSending(
  deps: SendModeDeps,
  actor: ActorContext,
  enabled: boolean,
): Promise<EmailDeliverySettingsView> {
  if (enabled && !deps.liveSendingAllowed) throw new LiveSendingNotAllowedError();
  if (enabled && deps.provider.name === 'dev') throw new DevProviderCannotSendError();

  await withChangeLog(deps.prisma, actor, async (ctx) => {
    const before = await ctx.tx.emailDeliverySettings.findUnique({ where: { id: SINGLETON_ID } });
    const after = await ctx.tx.emailDeliverySettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, liveSendingEnabled: enabled, updatedByUserId: actor.userId },
      update: { liveSendingEnabled: enabled, updatedByUserId: actor.userId },
    });
    await ctx.log({
      subjectType: 'EmailDeliverySettings',
      subjectId: SINGLETON_ID,
      before: { liveSendingEnabled: before?.liveSendingEnabled ?? false },
      after: { liveSendingEnabled: after.liveSendingEnabled },
    });
  });
  return getEmailDeliverySettings(deps);
}
