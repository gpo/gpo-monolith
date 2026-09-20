import { contributionYear } from '@gpo/tax-receipts-core';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { withChangeLog } from '../src/changelog/write.js';
import { issueReceipt } from '../src/receipts/issue.js';
import { runValidationForAllContributions } from '../src/validation/run.js';
import { resolveWorkItem } from '../src/work-items/resolve.js';

/**
 * Phase 3 manual-test fixtures. Companion to PHASE-3-MANUAL-TEST-PLAN.md.
 *
 * Where seed-phase-2-fixtures.ts shapes contributions one at a time to
 * exercise each validation rule, this shapes **spaces** (period, riding,
 * entity kind) to exercise per-space issuance (ticket 3.12): a clean space
 * ready to generate, a space blocked end-to-end by one donor's open work
 * item, a space where one donor's generate fails while the rest succeed, and
 * one donor ("Rambling Randy") who gives into three different spaces so the
 * "same person, different period/riding/entity" case is real data, not just
 * a claim in a doc.
 *
 * Idempotent by construction, same pattern as seed-phase-2-fixtures.ts: every
 * contact/contribution is keyed by a reserved id range (900001-900012, plus
 * 900101/900102 for Randy's second and third contributions), every `Riding`
 * is create-if-absent, and the by-election period (9001) is the same
 * fixture-only id seed-phase-2-fixtures.ts uses, so running both in either
 * order never conflicts. **Local/dev database only.**
 *
 * Run: `pnpm db:seed:phase-3-fixtures` (needs `pnpm db:seed` first, for
 * periods, the contribution limits B2 depends on, and the party CFO user
 * this script issues "Already Issued Ivy"'s receipt as).
 */

const prisma = new PrismaClient();

const ANNUAL_2026 = 67; // '2026 Annual', from prisma/seed.ts
const ANNUAL_2025 = 63; // '2025 Annual', from prisma/seed.ts
const BY_ELECTION_PERIOD_ID = 9001; // shared with seed-phase-2-fixtures.ts
const RIDING_A = 84; // shared with seed-phase-2-fixtures.ts
const RIDING_B = 90; // phase-3-only: a second active riding, for space D

/**
 * Space A needs to actually BE clean (no open work items anywhere in it) to
 * demonstrate a straight-through issuance run. The real 2026 Annual period
 * (67) can't guarantee that: it's the same PARTY-level space every other
 * PARTY-level fixture and any real Qomon-mirrored contribution also lands
 * in (seed-phase-2-fixtures.ts's messy-on-purpose fixtures included), so on
 * a dev database that has seen any real use it will already have open work
 * items. A dedicated fixture-only period, dated in 2028 (outside every real
 * or fixture period's window, so it can never collide with intake
 * derivation's period-overlap check either), sidesteps that entirely.
 */
const SPACE_A_PERIOD_ID = 9002;

const STORAGE_DIR = process.env.ARTIFACT_STORAGE_DIR ?? './storage/artifacts';

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
  /** which space (period, riding, entity kind) this lands in, and why —
   *  printed to the console and cross-referenced by name in
   *  PHASE-3-MANUAL-TEST-PLAN.md. */
  space: string;
  /** what this donor/contribution specifically illustrates within that space. */
  demonstrates: string;
  qomonContactId: bigint;
  contactName: string;
  address?: RawAddress | null;
  qomonTransactionId: bigint;
  amountCents: number;
  nonDeductibleCents?: number;
  acceptedAt: string;
  periodId: number;
  ridingNumber: number | null;
  entityKind: 'PARTY' | 'CA' | 'CAMPAIGN';
  receivedBy: 'GPO' | 'ENTITY';
  /** upserts a DonorCyclePreference for the contribution's year — shows up
   *  in the preview's delivery split and the generated receipt's delivery. */
  deliveryPreference?: 'EMAIL';
  /** issues the receipt immediately after seeding, as the party CFO — this
   *  donor's contribution is fully receipted by the time you open the
   *  space, so the preview should exclude it (nothing left eligible). */
  preIssue?: boolean;
}

const SPACE_A = 'Space A — PARTY / phase-3 fixture period 9002 (clean, ready to issue)';
const SPACE_B = 'Space B — CA / riding 84 / 2026 Annual (blocked)';
const SPACE_C = 'Space C — CAMPAIGN / riding 84 / York-Simcoe by-election (clean)';
const SPACE_D = 'Space D — CA / riding 90 / 2026 Annual (partial failure on generate)';
const SPACE_F = 'Space F — PARTY / 2025 Annual (clean, a second period)';

const FIXTURES: ContributionFixture[] = [
  {
    space: SPACE_A,
    demonstrates: 'clean, full remaining amount, default (mail) delivery',
    qomonContactId: 900_001n,
    contactName: 'Ready Rita',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_001n,
    amountCents: 5_000,
    acceptedAt: '2028-03-01T12:00:00Z',
    periodId: SPACE_A_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    space: SPACE_A,
    demonstrates: 'clean, confirmed email delivery preference — shows up in the preview totals',
    qomonContactId: 900_002n,
    contactName: 'Ready Raj',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_002n,
    amountCents: 7_500,
    acceptedAt: '2028-03-01T12:00:00Z',
    periodId: SPACE_A_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
    deliveryPreference: 'EMAIL',
  },
  {
    space: SPACE_A,
    demonstrates: 'goods & services non-deductible portion — remaining eligible ($80) is less than the full amount ($100)',
    qomonContactId: 900_003n,
    contactName: 'Partial Credit Priya',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_003n,
    amountCents: 10_000,
    nonDeductibleCents: 2_000,
    acceptedAt: '2028-03-01T12:00:00Z',
    periodId: SPACE_A_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    space: SPACE_A,
    demonstrates: 'already fully receipted at seed time — the preview must exclude this row entirely',
    qomonContactId: 900_004n,
    contactName: 'Already Issued Ivy',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_004n,
    amountCents: 6_000,
    acceptedAt: '2028-03-01T12:00:00Z',
    periodId: SPACE_A_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
    preIssue: true,
  },
  {
    space: SPACE_A,
    demonstrates: 'leg 1/3 of a donor giving into three different spaces (see Space C and Space F below)',
    qomonContactId: 900_010n,
    contactName: 'Rambling Randy',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_010n,
    amountCents: 4_000,
    acceptedAt: '2028-03-01T12:00:00Z',
    periodId: SPACE_A_PERIOD_ID,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    space: SPACE_B,
    demonstrates:
      'B2 — a single contribution over the $3,425 CA limit; the resulting open work item blocks the WHOLE space, not just this row',
    qomonContactId: 900_005n,
    contactName: 'Blocked Blake',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_005n,
    amountCents: 350_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_2026,
    ridingNumber: RIDING_A,
    entityKind: 'CA',
    receivedBy: 'ENTITY',
  },
  {
    space: SPACE_B,
    demonstrates: "otherwise clean, but blocked anyway — the gate is space-wide, not per-contribution (this is the point of Blake's row)",
    qomonContactId: 900_006n,
    contactName: 'Clean Casey',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_006n,
    amountCents: 5_500,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_2026,
    ridingNumber: RIDING_A,
    entityKind: 'CA',
    receivedBy: 'ENTITY',
  },
  {
    space: SPACE_C,
    demonstrates: 'clean campaign-space baseline',
    qomonContactId: 900_007n,
    contactName: 'Campaign Cam',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_007n,
    amountCents: 3_500,
    acceptedAt: '2026-07-01T12:00:00Z',
    periodId: BY_ELECTION_PERIOD_ID,
    ridingNumber: RIDING_A,
    entityKind: 'CAMPAIGN',
    receivedBy: 'ENTITY',
  },
  {
    space: SPACE_C,
    demonstrates: 'leg 3/3 of the multi-space donor (see Space A and Space F)',
    qomonContactId: 900_010n,
    contactName: 'Rambling Randy',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_102n,
    amountCents: 3_000,
    acceptedAt: '2026-07-01T12:00:00Z',
    periodId: BY_ELECTION_PERIOD_ID,
    ridingNumber: RIDING_A,
    entityKind: 'CAMPAIGN',
    receivedBy: 'ENTITY',
  },
  {
    space: SPACE_D,
    demonstrates:
      'no address on file — trips C1, then the seed script EXCEPTS that item so the gate clears; generate must still fail this row (MissingAddressError), showing an exception clears the queue without fixing the underlying data',
    qomonContactId: 900_008n,
    contactName: 'No Address Ned',
    address: null,
    qomonTransactionId: 900_008n,
    amountCents: 7_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_2026,
    ridingNumber: RIDING_B,
    entityKind: 'CA',
    receivedBy: 'ENTITY',
  },
  {
    space: SPACE_D,
    demonstrates: "clean — should succeed on generate even though Ned's row (same space) fails",
    qomonContactId: 900_009n,
    contactName: 'Address Andy',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_009n,
    amountCents: 6_500,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_2026,
    ridingNumber: RIDING_B,
    entityKind: 'CA',
    receivedBy: 'ENTITY',
  },
  {
    space: SPACE_F,
    demonstrates: 'leg 2/3 of the multi-space donor — same person, a different (prior) period, otherwise clean',
    qomonContactId: 900_010n,
    contactName: 'Rambling Randy',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 900_101n,
    amountCents: 6_000,
    acceptedAt: '2025-06-01T12:00:00Z',
    periodId: ANNUAL_2025,
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

async function ensureSpaceAPeriod(): Promise<void> {
  const existing = await prisma.period.findUnique({ where: { id: SPACE_A_PERIOD_ID } });
  if (existing) {
    console.log(`  period ${SPACE_A_PERIOD_ID}: already exists — left as-is`);
    return;
  }
  await prisma.period.create({
    data: {
      id: SPACE_A_PERIOD_ID,
      name: 'Phase 3 fixture — clean space (not a real EO period)',
      kind: 'ANNUAL',
      startsAt: new Date('2028-01-01T05:00:00Z'),
      endsAt: new Date('2029-01-01T05:00:00Z'),
    },
  });
  console.log(`  period ${SPACE_A_PERIOD_ID}: created (ANNUAL, fixture-only, 2028)`);
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
      ridingNumbers: [RIDING_A],
      startsAt: new Date('2026-06-01T05:00:00Z'),
      endsAt: new Date('2026-09-01T04:00:00Z'),
    },
  });
  console.log(`  period ${BY_ELECTION_PERIOD_ID}: created (BY_ELECTION, riding ${RIDING_A})`);
}

async function ensureFixture(f: ContributionFixture, cfoUserId: string): Promise<void> {
  const existingContribution = await prisma.contribution.findUnique({
    where: { qomonTransactionId: f.qomonTransactionId },
  });
  if (existingContribution) {
    console.log(`  skip (already seeded): ${f.contactName} — ${f.demonstrates}`);
    return;
  }

  let contact = await prisma.contact.findUnique({ where: { qomonContactId: f.qomonContactId } });
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        qomonContactId: f.qomonContactId,
        name: f.contactName,
        addresses: f.address ? [f.address] : [],
      },
    });
  }

  const acceptedAt = new Date(f.acceptedAt);
  const contribution = await prisma.contribution.create({
    data: {
      contactId: contact.id,
      qomonTransactionId: f.qomonTransactionId,
      amountCents: f.amountCents,
      acceptedAt,
      paymentMethodKind: 'card',
    },
  });

  await withChangeLog(prisma, { userId: null, reason: `phase-3 fixture: ${f.demonstrates}` }, async (ctx) => {
    const after = await ctx.tx.contributionMetadata.create({
      data: {
        contributionId: contribution.id,
        periodId: f.periodId,
        ridingNumber: f.ridingNumber,
        entityKind: f.entityKind,
        receivedBy: f.receivedBy,
        nonDeductibleCents: f.nonDeductibleCents ?? 0,
        goodsServices: (f.nonDeductibleCents ?? 0) > 0,
      },
    });
    await ctx.log({ subjectType: 'ContributionMetadata', subjectId: contribution.id, after });
  });

  if (f.deliveryPreference) {
    await prisma.donorCyclePreference.upsert({
      where: { contactId_year: { contactId: contact.id, year: contributionYear(acceptedAt) } },
      create: { contactId: contact.id, year: contributionYear(acceptedAt), delivery: f.deliveryPreference },
      update: { delivery: f.deliveryPreference },
    });
  }

  if (f.preIssue) {
    const receipt = await issueReceipt(
      { prisma, storageDir: STORAGE_DIR },
      {
        contributionId: contribution.id,
        actorUserId: cfoUserId,
        reason: `phase-3 fixture: pre-issued so this space's preview excludes it (${f.demonstrates})`,
        politicalEntityLabel: 'Green Party of Ontario',
      },
    );
    console.log(`  created + pre-issued ${receipt.receiptNumber}: ${f.contactName} — ${f.demonstrates}`);
    return;
  }

  console.log(`  created: ${f.contactName} — ${f.demonstrates}`);
}

async function main(): Promise<void> {
  const cfo = await prisma.user.findUnique({ where: { email: 'cfo@gpo.test' } });
  if (!cfo) {
    throw new Error('cfo@gpo.test not found — run `pnpm db:seed` first (it creates the party CFO user).');
  }

  console.log('Ridings + periods:');
  await ensureRiding(RIDING_A, 'York-Simcoe (fixture)', true);
  await ensureRiding(RIDING_B, 'Simcoe North (fixture)', true);
  await ensureSpaceAPeriod();
  await ensureByElectionPeriod();

  console.log('Contributions:');
  let currentSpace = '';
  for (const fixture of FIXTURES) {
    if (fixture.space !== currentSpace) {
      currentSpace = fixture.space;
      console.log(`  -- ${currentSpace}`);
    }
    await ensureFixture(fixture, cfo.id);
  }

  console.log('Running the validation registry over everything just seeded...');
  const result = await runValidationForAllContributions(prisma);
  console.log(
    `  checked ${result.contributionsChecked}, opened ${result.opened}, reopened ${result.reopened}, resolved ${result.resolved}`,
  );

  // Space D's whole point is a generate-time failure the gate can't see —
  // but C1 (no address) is itself a gate-blocking finding, so without this
  // step Ned's row would block Space D outright, same as Space B, which
  // isn't the scenario this space is for. Excepting it (not resolving —
  // nothing about the missing address actually changed) clears the gate the
  // same way a rules authority granting a real exception would, while
  // leaving the underlying data gap exactly as missing as before.
  const nedContribution = await prisma.contribution.findUnique({ where: { qomonTransactionId: 900_008n } });
  if (nedContribution) {
    const c1Item = await prisma.workItem.findFirst({
      where: { subjectType: 'Contribution', subjectId: nedContribution.id, ruleRef: 'C1', status: 'OPEN' },
    });
    if (c1Item) {
      await resolveWorkItem(prisma, {
        workItemId: c1Item.id,
        actorUserId: cfo.id,
        reason: 'phase-3 fixture: excepted on purpose so Space D demonstrates a generate-time failure, not a blocked space',
        outcome: 'EXCEPTION',
      });
      console.log('  excepted No Address Ned’s C1 work item so Space D is issuable (but his generate will still fail)');
    }
  }

  console.log('Done — see PHASE-3-MANUAL-TEST-PLAN.md for what to check against each space.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
