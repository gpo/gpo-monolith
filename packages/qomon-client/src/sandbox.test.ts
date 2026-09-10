import { readFileSync } from 'node:fs';
import { describe } from 'vitest';
import { QomonClient } from './client.js';
import { runQomonContractSuite } from './contract-suite.js';

/**
 * Runs the same contract suite against the real Qomon sandbox. Skipped unless
 * QOMON_SANDBOX=1. The key is read from the environment or, failing that, from
 * `../qomon-test/.env` (gitignored, never committed). See PHASE-0-NOTES.md.
 *
 *   QOMON_SANDBOX=1 pnpm --filter @gpo/qomon-client test:sandbox
 */
const enabled = process.env.QOMON_SANDBOX === '1';

function resolveKey(): string | null {
  if (process.env.QOMON_API_KEY) return process.env.QOMON_API_KEY;
  for (const path of [
    process.env.QOMON_ENV_FILE,
    '../qomon-test/.env',
    '../../../qomon-test/.env',
  ]) {
    if (!path) continue;
    try {
      const text = readFileSync(path, 'utf8');
      const line = text.split('\n').find((l) => l.startsWith('QOMON_API_KEY='));
      if (line) return line.slice('QOMON_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const key = enabled ? resolveKey() : null;

const suite = enabled && key ? describe : describe.skip;

suite('sandbox', { timeout: 30_000 }, () => {
  runQomonContractSuite('qomon sandbox', async () => {
    const api = new QomonClient({
      apiKey: key!,
      baseUrl: process.env.QOMON_API_BASE ?? 'https://incoming.qomon.app',
      rps: 3,
    });
    return {
      api,
      // Qomon has not shipped the transaction metadata field yet (A1 / R1).
      metadataSupported: false,
      async makeBundle() {
        const settings = await api.getTransactionSettings();
        const paymentMethod = settings.payment_method_kinds[0] ?? 'VIR';
        const currency = settings.currency ?? 'cad';
        const contact = await api.createContact({
          firstname: 'Contract',
          surname: `Sandbox-${Date.now()}`,
          mail: `contract-${Date.now()}@example.org`,
        });
        const bundle = await api.createTransactionBundle({
          transactions: [
            {
              amount: 12_345,
              currency,
              payment_method_kind: paymentMethod,
              contact_id: contact.id,
              date: new Date().toISOString(),
            },
          ],
        });
        return {
          bundleId: bundle.id,
          transactionId: bundle.transactions[0]!.id,
          contactId: contact.id,
        };
      },
    };
  });
});
