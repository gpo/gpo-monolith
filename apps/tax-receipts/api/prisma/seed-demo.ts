import { contributionYear } from '@gpo/tax-receipts-core';
import bcrypt from 'bcryptjs';
import { PrismaClient, type EntityKind } from '../src/generated/prisma/index.js';
import { withChangeLog } from '../src/changelog/write.js';
import { enterManualPayment } from '../src/payments/manual-entry.js';
import { issueReceipt } from '../src/receipts/issue.js';
import { getReceiptSettings, setReceiptLayout } from '../src/receipts/settings.js';
import { runValidationForAllContributions } from '../src/validation/run.js';

/**
 * EO evaluation demo data. Everything the live demo of the Elections Ontario
 * Evaluation Tool needs beyond `prisma/seed-fixtures.ts`, so nobody has to
 * type setup data before the meeting: an unissued space to issue live,
 * issued receipts to correct live, and one open problem per validation
 * resolution to resolve live. The fixtures stay the read-only examples; these
 * records are the ones the demo changes.
 *
 * It also sets every seeded login's password to `gpo` (easy to type on a
 * shared screen) and switches the receipt layout to "With contributor type"
 * (row 56) before issuing, so the demo receipts print it. Both are why this
 * refuses a non-local database unless run with `--allow-remote`.
 *
 * Idempotent: every payment is keyed by its note (`demo-*`), every contact by
 * its `@demo.test` email, and the periods are create-if-absent. A record the
 * demo already used (issued, cancelled, refunded, merged) is left as it is;
 * for a fresh set, reset the database and seed again.
 *
 * | What | EO rows |
 * |---|---|
 * | Period 9601 "Demo — issue live": Iris Issue (3 gifts, one goods and services) and Devon Issue, unissued, EMAIL preference | 41, 46, 47, 64 |
 * | Period 9602 "Demo — corrections": Printed Paula, Snapshot Sid, Lost Liam, Cancel Cara, Reissue Rhys issued; Oscar Combine unissued (two gifts) | 42 to 45, 48 to 63 |
 * | Period 64 (2025 General Election): Ineligible Refund and Ineligible Except (BC), Dupone and Duptwo Merge (shared email), Repeat Rowan (same $50 a day apart) | 33, 35, 37, 40 |
 * | Period 67 (2026 Annual): Overlimit Olive, $6,000 to the party (limit $5,000) | 39 |
 *
 * Run: `pnpm db:seed:demo`, after `pnpm db:seed` and `pnpm db:seed:fixtures`.
 * The presenter's script for this data is `apps/tax-receipts/demo/eo-demo-guide.html`.
 */

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'gpo';
const SEEDED_LOGINS = ['sysadmin', 'cfo', 'admin', 'rules', 'books', 'filer', 'readonly'].map((u) => `${u}@gpo.test`);

const STORAGE_DIR = process.env.ARTIFACT_STORAGE_DIR ?? './storage/artifacts';

const ISSUE_LIVE_PERIOD_ID = 9601;
const CORRECTIONS_PERIOD_ID = 9602;
const GENERAL_ELECTION_2025 = 64; // from prisma/seed.ts
const ANNUAL_2026 = 67; // from prisma/seed.ts; the only year with contribution limits

const DEMO_RIDING = 121; // real: York—Simcoe, as in seed-fixtures.ts

interface DemoAddress {
  [key: string]: string;
  housenumber: string;
  street: string;
  city: string;
  state: string;
  postalcode: string;
  country: string;
}

const ONTARIO = (housenumber: string, street: string, city = 'Toronto', postalcode = 'M5V 2T6'): DemoAddress => ({
  housenumber,
  street,
  city,
  state: 'ON',
  postalcode,
  country: 'CA',
});
const BRITISH_COLUMBIA: DemoAddress = {
  housenumber: '456',
  street: 'Robson St',
  city: 'Vancouver',
  state: 'BC',
  postalcode: 'V6B 1A1',
  country: 'CA',
};

interface DemoGift {
  /** keys the payment (idempotency), as its note */
  key: string;
  amountCents: number;
  receivedAt: string;
  /** when the contribution was accepted on a different day than received */
  acceptedAt?: string;
  periodId: number;
  entityKind?: EntityKind;
  ridingNumber?: number;
  nonDeductibleCents?: number;
  /** issued as the party CFO right after entry */
  issue?: boolean;
}

interface DemoDonor {
  /** EO evaluation row(s) and what this shows; printed to the console */
  demonstrates: string;
  firstName: string;
  lastName: string;
  /** defaults to first.last@demo.test; two donors share one for B4 */
  email?: string;
  address: DemoAddress;
  /** EMAIL preference for the year of the first gift */
  emailDelivery?: boolean;
  gifts: DemoGift[];
}

const DEMO_DONORS: DemoDonor[] = [
  // --- Period 9601: issued live in the meeting ---
  {
    demonstrates: 'rows 41, 46, 47, 64: two cash gifts that combine onto one receipt, and a goods-and-services gift that stays separate',
    firstName: 'Iris',
    lastName: 'Issue',
    address: ONTARIO('77', 'Maple Ave', 'Ottawa', 'K1A 0B1'),
    emailDelivery: true,
    gifts: [
      { key: 'demo-iris-1', amountCents: 5_000, receivedAt: '2031-01-10', periodId: ISSUE_LIVE_PERIOD_ID },
      { key: 'demo-iris-2', amountCents: 3_000, receivedAt: '2031-01-20', periodId: ISSUE_LIVE_PERIOD_ID },
      { key: 'demo-iris-3', amountCents: 10_000, nonDeductibleCents: 2_000, receivedAt: '2031-01-25', periodId: ISSUE_LIVE_PERIOD_ID },
    ],
  },
  {
    demonstrates: 'rows 41, 47, 64: a second donor in the same run',
    firstName: 'Devon',
    lastName: 'Issue',
    address: ONTARIO('12', 'Queen St'),
    emailDelivery: true,
    gifts: [{ key: 'demo-devon-1', amountCents: 4_500, receivedAt: '2031-01-12', periodId: ISSUE_LIVE_PERIOD_ID }],
  },
  // --- Period 9602: issued here, corrected live in the meeting ---
  {
    demonstrates: 'rows 44, 45, 48 to 58: a receipt to read line by line; accepted three days after it was received (row 50)',
    firstName: 'Printed',
    lastName: 'Paula',
    address: ONTARIO('20', 'Bay St', 'Toronto', 'M5J 2N8'),
    gifts: [
      {
        key: 'demo-paula-1',
        amountCents: 4_500,
        receivedAt: '2032-01-12',
        acceptedAt: '2032-01-15',
        periodId: CORRECTIONS_PERIOD_ID,
        issue: true,
      },
    ],
  },
  {
    demonstrates: 'row 42: edit the contributor after issue, the stored receipt does not change; reissue prints the new details',
    firstName: 'Snapshot',
    lastName: 'Sid',
    address: ONTARIO('77', 'Maple Ave', 'Ottawa', 'K1A 0B1'),
    gifts: [{ key: 'demo-sid-1', amountCents: 5_000, receivedAt: '2032-01-10', periodId: CORRECTIONS_PERIOD_ID, issue: true }],
  },
  {
    demonstrates: 'rows 59, 60: mark lost and reprint as a COPY',
    firstName: 'Lost',
    lastName: 'Liam',
    address: ONTARIO('8', 'Front St W'),
    gifts: [{ key: 'demo-liam-1', amountCents: 3_000, receivedAt: '2032-01-14', periodId: CORRECTIONS_PERIOD_ID, issue: true }],
  },
  {
    demonstrates: 'rows 61, 62: cancel, open the cancellation notice, and email it to the donor',
    firstName: 'Cancel',
    lastName: 'Cara',
    address: ONTARIO('30', 'King St E'),
    gifts: [{ key: 'demo-cara-1', amountCents: 5_000, receivedAt: '2032-01-16', periodId: CORRECTIONS_PERIOD_ID, issue: true }],
  },
  {
    demonstrates: 'row 63: reissue, the replacement says which receipt it replaces',
    firstName: 'Reissue',
    lastName: 'Rhys',
    address: ONTARIO('44', 'Yonge St'),
    gifts: [{ key: 'demo-rhys-1', amountCents: 6_000, receivedAt: '2032-01-18', periodId: CORRECTIONS_PERIOD_ID, issue: true }],
  },
  {
    demonstrates: 'row 43: two unissued gifts to combine onto one receipt from the contributor page',
    firstName: 'Oscar',
    lastName: 'Combine',
    address: ONTARIO('5', 'King St W', 'Toronto', 'M5H 1A1'),
    gifts: [
      { key: 'demo-oscar-1', amountCents: 4_000, receivedAt: '2032-02-05', periodId: CORRECTIONS_PERIOD_ID },
      { key: 'demo-oscar-2', amountCents: 2_500, receivedAt: '2032-02-10', periodId: CORRECTIONS_PERIOD_ID },
    ],
  },
  // --- Validation problems to resolve live (period 64 has no fixtures) ---
  {
    demonstrates: 'rows 33, 40: out of province (B1, C3), resolve by refund',
    firstName: 'Ineligible',
    lastName: 'Refund',
    address: BRITISH_COLUMBIA,
    gifts: [{ key: 'demo-ineligible-refund', amountCents: 5_000, receivedAt: '2025-03-15', periodId: GENERAL_ELECTION_2025 }],
  },
  {
    demonstrates: 'row 33: out of province (B1, C3), resolve by exception',
    firstName: 'Ineligible',
    lastName: 'Except',
    address: BRITISH_COLUMBIA,
    gifts: [{ key: 'demo-ineligible-except', amountCents: 5_000, receivedAt: '2025-03-15', periodId: GENERAL_ELECTION_2025 }],
  },
  {
    demonstrates: 'row 35: duplicate contributor (B4) 1/2, the record to keep',
    firstName: 'Dupone',
    lastName: 'Merge',
    email: 'merge@demo.test',
    address: ONTARIO('10', 'Queen St'),
    gifts: [{ key: 'demo-dupone', amountCents: 3_000, receivedAt: '2025-03-15', periodId: GENERAL_ELECTION_2025 }],
  },
  {
    demonstrates: 'row 35: duplicate contributor (B4) 2/2, merge this one into Dupone Merge',
    firstName: 'Duptwo',
    lastName: 'Merge',
    email: 'merge@demo.test',
    address: ONTARIO('11', 'Queen St'),
    gifts: [{ key: 'demo-duptwo', amountCents: 4_500, receivedAt: '2025-03-16', periodId: GENERAL_ELECTION_2025 }],
  },
  {
    demonstrates: 'row 37: the same $50 a day apart (A6), refund the second',
    firstName: 'Repeat',
    lastName: 'Rowan',
    address: ONTARIO('12', 'Queen St'),
    gifts: [
      { key: 'demo-rowan-1', amountCents: 5_000, receivedAt: '2025-03-10', periodId: GENERAL_ELECTION_2025 },
      { key: 'demo-rowan-2', amountCents: 5_000, receivedAt: '2025-03-11', periodId: GENERAL_ELECTION_2025 },
    ],
  },
  {
    demonstrates: 'row 39: $6,000 to the party against a $5,000 limit (B2), reallocate the excess',
    firstName: 'Overlimit',
    lastName: 'Olive',
    address: ONTARIO('13', 'Queen St'),
    gifts: [{ key: 'demo-olive', amountCents: 600_000, receivedAt: '2026-06-01', periodId: ANNUAL_2026 }],
  },
];

function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function ensurePeriod(id: number, name: string, startsAt: string, endsAt: string): Promise<void> {
  if (await prisma.period.findUnique({ where: { id } })) {
    console.log(`  period ${id}: already exists — left as-is`);
    return;
  }
  await prisma.period.create({
    data: { id, name, kind: 'ANNUAL', ridingNumbers: [], startsAt: new Date(startsAt), endsAt: new Date(endsAt) },
  });
  console.log(`  period ${id}: created`);
}

async function ensureDemoContact(d: DemoDonor) {
  const email = d.email ?? `${d.firstName}.${d.lastName}@demo.test`.toLowerCase();
  const name = `${d.firstName} ${d.lastName}`;
  const existing = await prisma.contact.findFirst({ where: { email, name } });
  if (existing) return existing;
  return withChangeLog(prisma, { userId: null, reason: 'demo: seeded contact' }, async (ctx) => {
    const contact = await ctx.tx.contact.create({
      data: { name, firstName: d.firstName, lastName: d.lastName, email, addresses: [d.address] },
    });
    await ctx.log({ subjectType: 'Contact', subjectId: contact.id, after: contact });
    return contact;
  });
}

async function ensureDemoDonor(d: DemoDonor, cfoUserId: string): Promise<void> {
  const contact = await ensureDemoContact(d);

  if (d.emailDelivery) {
    const year = contributionYear(new Date(`${d.gifts[0]!.receivedAt}T17:00:00Z`));
    await prisma.donorCyclePreference.upsert({
      where: { contactId_year: { contactId: contact.id, year } },
      create: { contactId: contact.id, year, delivery: 'EMAIL' },
      update: { delivery: 'EMAIL' },
    });
  }

  const done: string[] = [];
  for (const g of d.gifts) {
    if (await prisma.payment.findFirst({ where: { note: g.key } })) {
      done.push(`${g.key} already seeded`);
      continue;
    }
    // noon Eastern, so the stored date reads as the intended day
    const receivedAt = new Date(`${g.receivedAt}T17:00:00Z`);
    const { contributions } = await enterManualPayment(prisma, {
      actorUserId: cfoUserId,
      reason: `demo: ${d.demonstrates}`,
      contactId: contact.id,
      amountCents: g.amountCents,
      receivedAt,
      method: 'CHEQUE',
      note: g.key,
      contributions: [
        {
          amountCents: g.amountCents,
          acceptedAt: g.acceptedAt ? new Date(`${g.acceptedAt}T17:00:00Z`) : undefined,
          descriptive: {
            period_id: g.periodId,
            entity_kind: g.entityKind ?? 'PARTY',
            riding_number: g.ridingNumber ?? null,
            received_by: 'GPO',
            goods_services: (g.nonDeductibleCents ?? 0) > 0,
            non_deductible_cents: g.nonDeductibleCents ?? 0,
          },
        },
      ],
    });
    if (g.issue) {
      const receipt = await issueReceipt(
        { prisma, storageDir: STORAGE_DIR },
        {
          contributionId: contributions[0]!.id,
          actorUserId: cfoUserId,
          reason: `demo: issued ahead of the meeting (${d.demonstrates})`,
          politicalEntityLabel: 'Green Party of Ontario',
        },
      );
      done.push(`${g.key} + ${receipt.receiptNumber}`);
    } else {
      done.push(`${g.key} created`);
    }
  }
  console.log(`  ${d.firstName} ${d.lastName} (${done.join(', ')}): ${d.demonstrates}`);
}

async function main(): Promise<void> {
  if (!isLocalDatabase(process.env.DATABASE_URL) && !process.argv.includes('--allow-remote')) {
    throw new Error(
      'DATABASE_URL is not a local database. This script sets every seeded login to a trivial password; ' +
        'rerun with --allow-remote only if that is what you want on this database.',
    );
  }

  const cfo = await prisma.user.findUnique({ where: { email: 'cfo@gpo.test' } });
  const sysadmin = await prisma.user.findUnique({ where: { email: 'sysadmin@gpo.test' } });
  if (!cfo || !sysadmin) {
    throw new Error('seeded users not found — run `pnpm db:seed` first (and `pnpm db:seed:fixtures` for the examples the demo reads).');
  }
  if (!(await prisma.riding.findUnique({ where: { ridingNumber: DEMO_RIDING } }))) {
    throw new Error(`riding ${DEMO_RIDING} not found — run \`pnpm db:seed\` first.`);
  }

  console.log(`Seeded logins: password set to "${DEMO_PASSWORD}"`);
  // bcrypt directly, at hashPassword's cost: hashPassword enforces the
  // 12-character minimum, which a demo login deliberately skips
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const { count } = await prisma.user.updateMany({ where: { email: { in: SEEDED_LOGINS } }, data: { passwordHash } });
  console.log(`  ${count} logins updated`);

  console.log('Receipt layout (row 56):');
  if ((await getReceiptSettings(prisma)).receiptLayout === 'CONTRIBUTOR_TYPE') {
    console.log('  already "With contributor type" — left as-is');
  } else {
    await setReceiptLayout(
      prisma,
      { userId: sysadmin.id, reason: 'demo: show contributor type on receipts for the EO evaluation' },
      'CONTRIBUTOR_TYPE',
    );
    console.log('  switched to "With contributor type"');
  }

  console.log('Demo periods:');
  await ensurePeriod(ISSUE_LIVE_PERIOD_ID, 'Demo — issue live (not a real EO period)', '2031-01-01T05:00:00Z', '2032-01-01T05:00:00Z');
  await ensurePeriod(CORRECTIONS_PERIOD_ID, 'Demo — corrections (not a real EO period)', '2032-01-01T05:00:00Z', '2033-01-01T05:00:00Z');

  console.log('Demo donors:');
  for (const donor of DEMO_DONORS) {
    await ensureDemoDonor(donor, cfo.id);
  }

  // B4 is raised on both duplicates only once the second exists
  console.log('Running the validation registry...');
  const result = await runValidationForAllContributions(prisma);
  console.log(`  checked ${result.contributionsChecked}, opened ${result.opened}, reopened ${result.reopened}, resolved ${result.resolved}`);

  console.log(`Done. Sign in as sysadmin@gpo.test, cfo@gpo.test, or admin@gpo.test with password "${DEMO_PASSWORD}".`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
