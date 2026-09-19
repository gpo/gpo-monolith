import { PrismaClient } from '../src/generated/prisma/index.js';
import { withChangeLog } from '../src/changelog/write.js';
import { runValidationForAllContributions } from '../src/validation/run.js';

/**
 * Phase 2 manual-test fixtures. Companion to PHASE-2-MANUAL-TEST-PLAN.md.
 *
 * `pnpm db:seed` (prisma/seed.ts) only creates configuration — no sample
 * contributions. Until the mirror sweep can reliably pull from a real Qomon
 * sandbox (see PHASE-1-MANUAL-TEST-PLAN.md's Qomon-key caveat), this is the
 * supported way to get data into the mirror that's actually *shaped* to
 * exercise every rule ticket 2.1 added, plus a few contributions shaped for
 * the RTD work still to come (2.2+) — rather than one throwaway contribution
 * per manual session.
 *
 * Idempotent by construction: every contact/contribution is keyed by a
 * reserved id range (800001+) so re-running only fills in whatever's
 * missing, and every `Riding` is create-if-absent so this never clobbers
 * real riding config if it happens to share a number. **Local/dev database
 * only** — do not point this at a shared environment with real riding
 * config or real donor data.
 *
 * Run: `pnpm db:seed:fixtures` (needs `pnpm db:seed` run first, for periods).
 */

const prisma = new PrismaClient();

const ANNUAL_PERIOD_ID = 67; // '2026 Annual', from prisma/seed.ts
const BY_ELECTION_PERIOD_ID = 9001; // fixture-only id, well outside real EO period ids
const ACTIVE_RIDING = 84; // reused from existing test fixtures (rules.test.ts, mirror-sweep.test.ts)
const DEFUNCT_RIDING = 12; // fixture-only; picked to demo A3, not a claim about the real riding 12

interface RawAddress {
  [key: string]: string | undefined;
  housenumber?: string;
  street?: string;
  city?: string;
  state?: string;
  postalcode?: string;
  country?: string;
}

const ONTARIO_ADDRESS: RawAddress = {
  housenumber: '123',
  street: 'Main St',
  city: 'Toronto',
  state: 'ON',
  postalcode: 'M5V 2T6',
  country: 'CA',
};

interface ContributionFixture {
  /** rule(s) this is built to demonstrate — printed to the console and
   *  cross-referenced by name in PHASE-2-MANUAL-TEST-PLAN.md. */
  demonstrates: string;
  qomonContactId: bigint;
  contactName: string;
  email?: string | null;
  address?: RawAddress | null;
  qomonTransactionId: bigint;
  amountCents: number;
  acceptedAt: string;
  paymentMethodKind?: string | null;
  externalRef?: string | null;
  periodId: number;
  ridingNumber: number | null;
  entityKind: 'PARTY' | 'CA' | 'CAMPAIGN';
  receivedBy: 'GPO' | 'ENTITY';
}

const FIXTURES: ContributionFixture[] = [
  {
    demonstrates: 'clean baseline — expect zero new findings',
    qomonContactId: 800_001n,
    contactName: 'Baseline Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_001n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'A2/A3 pass — CA in an active riding',
    qomonContactId: 800_002n,
    contactName: 'Active CA Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_002n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: ACTIVE_RIDING,
    entityKind: 'CA',
    receivedBy: 'ENTITY',
  },
  {
    demonstrates: 'A3 — CA in a defunct riding',
    qomonContactId: 800_003n,
    contactName: 'Defunct CA Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_003n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: DEFUNCT_RIDING,
    entityKind: 'CA',
    receivedBy: 'ENTITY',
  },
  {
    demonstrates: 'A2 — CAMPAIGN with no active campaign for the (ANNUAL) period',
    qomonContactId: 800_004n,
    contactName: 'No-Campaign Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_004n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: ACTIVE_RIDING,
    entityKind: 'CAMPAIGN',
    receivedBy: 'ENTITY',
  },
  {
    demonstrates: 'A2 pass — CAMPAIGN in a by-election period naming the riding',
    qomonContactId: 800_005n,
    contactName: 'By-Election Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_005n,
    amountCents: 5_000,
    acceptedAt: '2026-07-01T12:00:00Z',
    periodId: BY_ELECTION_PERIOD_ID,
    ridingNumber: ACTIVE_RIDING,
    entityKind: 'CAMPAIGN',
    receivedBy: 'ENTITY',
  },
  {
    demonstrates: 'A4 — processor record (external_ref set) but received_by ENTITY',
    qomonContactId: 800_006n,
    contactName: 'Provenance Mismatch Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_006n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    externalRef: 'ch_fixture_800006',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'ENTITY',
  },
  {
    demonstrates: 'B1 + C3 — out-of-province address (BC)',
    qomonContactId: 800_007n,
    contactName: 'Out Of Province Donor',
    address: { housenumber: '456', street: 'Robson St', city: 'Vancouver', state: 'BC', postalcode: 'V6B 1A1', country: 'CA' },
    qomonTransactionId: 800_007n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'B3 + C4 — "Anonymous" is both an anonymous name (B3) and not a two-word printable name (C4)',
    qomonContactId: 800_008n,
    contactName: 'Anonymous',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_008n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'C1 — no address on file',
    qomonContactId: 800_009n,
    contactName: 'No Address Donor',
    address: null,
    qomonTransactionId: 800_009n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'C2 — comma in the address line',
    qomonContactId: 800_010n,
    contactName: 'Comma Address Donor',
    address: { housenumber: '123', street: 'Main St, Unit 4', city: 'Toronto', state: 'ON', postalcode: 'M5V 2T6', country: 'CA' },
    qomonTransactionId: 800_010n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'C3 — malformed postal code',
    qomonContactId: 800_011n,
    contactName: 'Bad Postal Donor',
    address: { housenumber: '123', street: 'Main St', city: 'Toronto', state: 'ON', postalcode: '12345', country: 'CA' },
    qomonTransactionId: 800_011n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'C4 — initial instead of a full first name',
    qomonContactId: 800_012n,
    contactName: 'D. Smith',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_012n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'C4 — joint name',
    qomonContactId: 800_013n,
    contactName: 'June and John Smith',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_013n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'kitchen sink — B1 + B3 + C2 + C3 + C4 together, one contribution, for queue-triage practice',
    qomonContactId: 800_014n,
    contactName: 'Anonymous',
    address: { housenumber: '456', street: 'Robson St, Suite 2', city: 'Vancouver', state: 'BC', postalcode: '12345', country: 'CA' },
    qomonTransactionId: 800_014n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  // --- RTD-forward fixtures (2.2+ isn't built yet, but this data is ready
  //     for it): one contact, three deposits, crossing the $200 RTD
  //     threshold on the second. ---
  {
    demonstrates: 'RTD row-inclusion prep — deposit 1/3, $150, stays under $200',
    qomonContactId: 800_015n,
    contactName: 'Threshold Crossing Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_015n,
    amountCents: 15_000,
    acceptedAt: '2026-02-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'RTD row-inclusion prep — deposit 2/3, $100, crosses $200 (year-to-date $250)',
    qomonContactId: 800_015n,
    contactName: 'Threshold Crossing Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_016n,
    amountCents: 10_000,
    acceptedAt: '2026-04-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'RTD row-inclusion prep — deposit 3/3, $75, its own row (year-to-date $325)',
    qomonContactId: 800_015n,
    contactName: 'Threshold Crossing Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_017n,
    amountCents: 7_500,
    acceptedAt: '2026-06-01T12:00:00Z',
    periodId: ANNUAL_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
];

async function ensureRiding(ridingNumber: number, name: string, active: boolean): Promise<void> {
  const existing = await prisma.riding.findUnique({ where: { ridingNumber } });
  if (existing) {
    console.log(`  riding ${ridingNumber}: already exists ("${existing.name}", active=${existing.active}) — left as-is`);
    return;
  }
  await prisma.riding.create({
    data: { ridingNumber, name, active, qomonApiKey: 'fixture-not-a-real-qomon-key' },
  });
  console.log(`  riding ${ridingNumber}: created ("${name}", active=${active})`);
}

async function ensureByElectionPeriod(): Promise<void> {
  const existing = await prisma.period.findUnique({ where: { id: BY_ELECTION_PERIOD_ID } });
  if (existing) {
    console.log(`  period ${BY_ELECTION_PERIOD_ID}: already exists — left as-is`);
    return;
  }
  await prisma.period.create({
    data: {
      id: BY_ELECTION_PERIOD_ID,
      name: 'York-Simcoe by-election (fixture)',
      kind: 'BY_ELECTION',
      ridingNumbers: [ACTIVE_RIDING],
      startsAt: new Date('2026-06-01T05:00:00Z'),
      endsAt: new Date('2026-09-01T04:00:00Z'),
    },
  });
  console.log(`  period ${BY_ELECTION_PERIOD_ID}: created (BY_ELECTION, riding ${ACTIVE_RIDING})`);
}

async function ensureFixture(f: ContributionFixture): Promise<void> {
  const existingContribution = await prisma.contribution.findUnique({
    where: { qomonTransactionId: f.qomonTransactionId },
  });
  if (existingContribution) {
    console.log(`  skip (already seeded): ${f.demonstrates}`);
    return;
  }

  let contact = await prisma.contact.findUnique({ where: { qomonContactId: f.qomonContactId } });
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        qomonContactId: f.qomonContactId,
        name: f.contactName,
        email: f.email ?? null,
        addresses: f.address ? [f.address] : [],
      },
    });
  }

  const contribution = await prisma.contribution.create({
    data: {
      contactId: contact.id,
      qomonTransactionId: f.qomonTransactionId,
      amountCents: f.amountCents,
      acceptedAt: new Date(f.acceptedAt),
      paymentMethodKind: f.paymentMethodKind ?? 'card',
      externalRef: f.externalRef ?? null,
    },
  });

  await withChangeLog(prisma, { userId: null, reason: `phase-2 fixture: ${f.demonstrates}` }, async (ctx) => {
    const after = await ctx.tx.contributionMetadata.create({
      data: {
        contributionId: contribution.id,
        periodId: f.periodId,
        ridingNumber: f.ridingNumber,
        entityKind: f.entityKind,
        receivedBy: f.receivedBy,
      },
    });
    await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
  });

  console.log(`  created: ${f.demonstrates}`);
}

async function main(): Promise<void> {
  console.log('Ridings + periods:');
  await ensureRiding(ACTIVE_RIDING, 'York-Simcoe (fixture)', true);
  await ensureRiding(DEFUNCT_RIDING, 'Testville (fixture — inactive, demonstrates A3)', false);
  await ensureByElectionPeriod();

  console.log('Contributions:');
  for (const fixture of FIXTURES) {
    await ensureFixture(fixture);
  }

  console.log('Running the validation registry over everything just seeded...');
  const result = await runValidationForAllContributions(prisma);
  console.log(
    `  checked ${result.contributionsChecked}, opened ${result.opened}, reopened ${result.reopened}, resolved ${result.resolved}`,
  );
  console.log('Done — see PHASE-2-MANUAL-TEST-PLAN.md for what to check against each fixture.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
