import { QomonClient, type QomonApi } from '@gpo/qomon-client';
import { withChangeLog, type ActorContext } from '../changelog/write.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * The party-level Qomon space (singleton row, `QomonSettings`). Qomon is off
 * until a system administrator enables it with an API key (Admin > Qomon);
 * nothing in the environment can turn it on, so a fresh database (the e2e
 * one, a new deployment) never talks to Qomon until someone decides it
 * should.
 *
 * Read on every request that needs Qomon (contact writes, donor refresh, the
 * party mirror sweep, riding sweeps for their default base URL), so a change
 * takes effect without a restart and holds across API instances.
 *
 * `apiKey` is write-only, the same rule as `Riding.qomonApiKey`: callers see
 * only whether one is on file, and the change log records that, never the
 * key.
 */

const SINGLETON_ID = 'singleton';
export const DEFAULT_QOMON_API_BASE = 'https://incoming.qomon.app';

export interface QomonSettingsView {
  enabled: boolean;
  apiBase: string;
  apiKeySet: boolean;
  updatedByUserId: string | null;
  updatedAt: Date | null;
}

export interface QomonSettingsInput {
  enabled?: boolean;
  apiBase?: string;
  /** omit to keep the key on file; it is never read back */
  apiKey?: string;
}

export class QomonKeyRequiredError extends Error {
  constructor() {
    super('an API key is required to enable Qomon');
    this.name = 'QomonKeyRequiredError';
  }
}

type Row = { enabled: boolean; apiKey: string; apiBase: string; updatedByUserId: string | null; updatedAt: Date };

function view(row: Row | null): QomonSettingsView {
  return {
    enabled: row?.enabled ?? false,
    apiBase: row?.apiBase ?? DEFAULT_QOMON_API_BASE,
    apiKeySet: (row?.apiKey.trim().length ?? 0) > 0,
    updatedByUserId: row?.updatedByUserId ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** what the change log records: the settings without the key */
function logged(v: QomonSettingsView) {
  return { enabled: v.enabled, apiBase: v.apiBase, apiKeySet: v.apiKeySet };
}

export async function getQomonSettings(prisma: PrismaClient): Promise<QomonSettingsView> {
  return view(await prisma.qomonSettings.findUnique({ where: { id: SINGLETON_ID } }));
}

export async function setQomonSettings(
  prisma: PrismaClient,
  actor: ActorContext,
  input: QomonSettingsInput,
): Promise<QomonSettingsView> {
  await withChangeLog(prisma, actor, async (ctx) => {
    const before = await ctx.tx.qomonSettings.findUnique({ where: { id: SINGLETON_ID } });
    const data = {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.apiBase !== undefined ? { apiBase: input.apiBase } : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      updatedByUserId: actor.userId,
    };
    // checked on the merged result: most saves omit the key and keep it
    const nextEnabled = input.enabled ?? before?.enabled ?? false;
    const nextKey = input.apiKey ?? before?.apiKey ?? '';
    if (nextEnabled && nextKey.trim().length === 0) throw new QomonKeyRequiredError();
    const after = await ctx.tx.qomonSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...data },
      update: data,
    });
    await ctx.log({
      subjectType: 'QomonSettings',
      subjectId: SINGLETON_ID,
      before: logged(view(before)),
      after: logged(view(after)),
    });
  });
  return getQomonSettings(prisma);
}

/** The party Qomon client for this request, or undefined while Qomon is off. */
export type QomonSource = () => Promise<QomonApi | undefined>;

export type BuildQomon = (config: { apiKey: string; apiBase: string }) => QomonApi;

const buildRealQomon: BuildQomon = ({ apiKey, apiBase }) => new QomonClient({ apiKey, baseUrl: apiBase });

/**
 * A QomonSource backed by `QomonSettings`. The row is read on each call (one
 * primary-key lookup); the client is rebuilt only when the key or base URL
 * changes.
 */
export function qomonFromSettings(prisma: PrismaClient, build: BuildQomon = buildRealQomon): QomonSource {
  let cached: { signature: string; client: QomonApi } | undefined;
  return async () => {
    const row = await prisma.qomonSettings.findUnique({ where: { id: SINGLETON_ID } });
    if (!row?.enabled || row.apiKey.trim().length === 0) return undefined;
    const signature = `${row.apiBase}\n${row.apiKey}`;
    if (cached?.signature !== signature) {
      cached = { signature, client: build({ apiKey: row.apiKey, apiBase: row.apiBase }) };
    }
    return cached.client;
  };
}

/** The party-level base URL, the default for a riding's own space. */
export async function partyQomonApiBase(prisma: PrismaClient): Promise<string> {
  return (await getQomonSettings(prisma)).apiBase;
}
