import {
  QomonClient,
  QomonError,
  QomonPollChangeFeed,
  type QomonApi,
} from '@gpo/qomon-client';
import type { PrismaClient } from '../generated/prisma/index.js';
import {
  DEFAULT_QOMON_API_BASE,
  type BuildQomon,
  type QomonSource,
} from '../qomon/settings.js';
import { runPagedMirrorSweep, type MirrorSweepResult } from './mirror-sweep.js';

export type SweepTarget =
  { kind: 'party' } | { kind: 'riding'; ridingNumber: number };
export type SweepTargetFailure =
  'UNKNOWN_RIDING' | 'INACTIVE_RIDING' | 'QOMON_DISABLED' | 'MISSING_API_KEY';

export class SweepTargetError extends Error {
  constructor(
    readonly code: SweepTargetFailure,
    message: string,
  ) {
    super(message);
    this.name = 'SweepTargetError';
  }
}

/** Safe to persist or log. Never retains the underlying error or its response body. */
export class SweepExecutionError extends Error {
  constructor(readonly retryable: boolean) {
    super('Qomon sweep execution failed');
    this.name = 'SweepExecutionError';
  }
}

export interface ExecuteSweepTargetDeps {
  prisma: PrismaClient;
  buildQomon?: BuildQomon;
  /** Optional source override for existing HTTP integrations and tests. */
  qomon?: QomonSource;
  buildRidingQomon?: (riding: {
    qomonApiKey: string;
    qomonApiBase: string | null;
  }) => QomonApi;
}

/** Resolve current target configuration and execute without an HTTP or worker lifecycle. */
export async function executeSweepTarget(
  deps: ExecuteSweepTargetDeps,
  input: { target: SweepTarget; mode: 'incremental' | 'full' },
): Promise<MirrorSweepResult> {
  const { prisma } = deps;
  const build =
    deps.buildQomon ??
    ((config) =>
      new QomonClient({ apiKey: config.apiKey, baseUrl: config.apiBase }));
  // Retain keys only inside this boundary, including for warning redaction.
  const secrets: string[] = [];
  try {
    let qomon: QomonApi;
    let feedKind = 'qomon-poll';
    if (input.target.kind === 'party' && deps.qomon) {
      const client = await deps.qomon();
      if (!client) {
        throw new SweepTargetError(
          'QOMON_DISABLED',
          'Qomon is not enabled (Admin > Qomon); cannot sweep',
        );
      }
      qomon = client;
    } else if (input.target.kind === 'party') {
      const settings = await prisma.qomonSettings.findUnique({
        where: { id: 'singleton' },
      });
      if (!settings?.enabled) {
        throw new SweepTargetError(
          'QOMON_DISABLED',
          'Qomon is not enabled (Admin > Qomon); cannot sweep',
        );
      }
      if (!settings.apiKey.trim()) {
        throw new SweepTargetError(
          'MISSING_API_KEY',
          'Qomon is not enabled (Admin > Qomon); cannot sweep',
        );
      }
      secrets.push(settings.apiKey);
      qomon = build({ apiKey: settings.apiKey, apiBase: settings.apiBase });
    } else {
      const { ridingNumber } = input.target;
      const riding = await prisma.riding.findUnique({
        where: { ridingNumber },
      });
      if (!riding)
        throw new SweepTargetError(
          'UNKNOWN_RIDING',
          `no riding ${ridingNumber} on file`,
        );
      if (!riding.active)
        throw new SweepTargetError(
          'INACTIVE_RIDING',
          `riding ${ridingNumber} is inactive`,
        );
      if (!riding.qomonApiKey.trim()) {
        throw new SweepTargetError(
          'MISSING_API_KEY',
          `riding ${ridingNumber} has no Qomon API key configured`,
        );
      }
      secrets.push(riding.qomonApiKey);
      const settings =
        riding.qomonApiBase === null
          ? await prisma.qomonSettings.findUnique({
              where: { id: 'singleton' },
            })
          : null;
      const apiBase =
        riding.qomonApiBase ?? settings?.apiBase ?? DEFAULT_QOMON_API_BASE;
      qomon = deps.buildRidingQomon
        ? deps.buildRidingQomon(riding)
        : build({ apiKey: riding.qomonApiKey, apiBase });
      feedKind = `qomon-poll:riding-${ridingNumber}`;
    }
    const result = await runPagedMirrorSweep(
      {
        prisma,
        qomon,
        feed: new QomonPollChangeFeed(qomon, { kind: feedKind }),
      },
      { mode: input.mode },
    );
    return {
      ...result,
      contactFetchFailures: result.contactFetchFailures.map((failure) => ({
        ...failure,
        message: secrets.reduce(
          (message, secret) => message.split(secret).join('[redacted]'),
          failure.message,
        ),
      })),
    };
  } catch (error) {
    if (error instanceof SweepTargetError) throw error;
    const databaseCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    throw new SweepExecutionError(
      error instanceof QomonError
        ? error.retryable
        : ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034'].includes(
            String(databaseCode),
          ),
    );
  }
}
