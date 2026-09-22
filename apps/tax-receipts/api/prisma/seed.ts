import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standardOntarioEsaHolidays } from '@gpo/tax-receipts-core';
import { PrismaClient } from '../src/generated/prisma/index.js';
import { hashPassword } from '../src/auth/password.js';

/**
 * Development / evaluation seed. Idempotent. NOT production data: the real
 * period boundaries, limit figures, and user roster are entered through the
 * admin screens (ticket 1.12). The figures here match the specs (period 63/64
 * for 2025, 67 for 2026 annual; O15 limit buckets) so the tool is
 * demonstrable out of the box.
 *
 * The riding directory (below) is the one exception to "not production
 * data": `ontario-ridings.json` is the real 124-riding Elections Ontario
 * provincial roster (2018 redistribution), in exactly the shape
 * `POST /admin/ridings/import` (`routes/admin.ts`) expects — this is what
 * that route's own comment means by "a file like ontario-ridings.json".
 * Loading it here means every dev/test database has the real riding
 * directory from the start, which matters for `prisma/seed-fixtures.ts`:
 * before this, its fixtures invented riding numbers (84, 90, 12) that
 * happen to be *real* ridings (Parry Sound—Muskoka, St. Catharines, Brampton
 * West) under fake fixture names — harmless only because nothing had ever
 * loaded the real directory into the same database. `qomonApiKey` ships
 * blank for all 124: real per-riding keys are entered by an administrator
 * (ticket 1.12's admin screen), never committed here.
 */
const prisma = new PrismaClient();

const RIDINGS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ontario-ridings.json');

interface RidingImportRow {
  ridingNumber: number;
  name: string;
  qomonApiKey: string;
  qomonApiBase: string | null;
  active: boolean;
  /** the schema has no such field; read and intentionally discarded, same
   *  rule `routes/admin.ts`'s import endpoint documents for this file. */
  effectiveFrom?: string;
}

async function seedRidings(): Promise<void> {
  const raw = await readFile(RIDINGS_FILE, 'utf-8');
  const rows = JSON.parse(raw) as RidingImportRow[];
  for (const row of rows) {
    await prisma.riding.upsert({
      where: { ridingNumber: row.ridingNumber },
      create: {
        ridingNumber: row.ridingNumber,
        name: row.name,
        qomonApiKey: row.qomonApiKey,
        qomonApiBase: row.qomonApiBase,
        active: row.active,
      },
      // same rule as the admin import route: a blank key on an existing
      // riding leaves its real key in place rather than clobbering it.
      update: {
        name: row.name,
        ...(row.qomonApiKey.length > 0 ? { qomonApiKey: row.qomonApiKey } : {}),
        qomonApiBase: row.qomonApiBase,
        active: row.active,
      },
    });
  }
  console.log(`  ridings: upserted ${rows.length} from ontario-ridings.json`);
}

async function main(): Promise<void> {
  // --- Periods (data-model §2; boundaries are ET wall-clock, stored UTC) ---
  await prisma.period.upsert({
    where: { id: 63 },
    create: {
      id: 63,
      name: '2025 Annual',
      kind: 'ANNUAL',
      startsAt: new Date('2025-01-01T05:00:00Z'),
      endsAt: new Date('2026-01-01T05:00:00Z'),
    },
    update: {},
  });
  await prisma.period.upsert({
    where: { id: 64 },
    create: {
      id: 64,
      name: '2025 General Election',
      kind: 'GENERAL_ELECTION',
      startsAt: new Date('2025-01-27T05:00:00Z'),
      endsAt: new Date('2025-05-28T04:00:00Z'),
    },
    update: {},
  });
  await prisma.period.upsert({
    where: { id: 67 },
    create: {
      id: 67,
      name: '2026 Annual',
      kind: 'ANNUAL',
      startsAt: new Date('2026-01-01T05:00:00Z'),
      endsAt: new Date('2027-01-01T05:00:00Z'),
    },
    update: {},
  });

  // --- Contribution limits (O15; figures are DATA, never hardcoded in code) ---
  const limits2026: Array<[
    'PARTY' | 'CA' | 'CAMPAIGN' | 'CANDIDATE_SELF',
    number,
    string,
  ]> = [
    ['PARTY', 500_000, '$5,000 to the party, combined annual + campaign'],
    ['CA', 342_500, '~$3,425 to a CA'],
    ['CAMPAIGN', 342_500, '~$3,425 to a campaign'],
    ['CANDIDATE_SELF', 1_000_000, 'candidate to own campaign, separate bucket'],
  ];
  for (const [bucket, amountCents, notes] of limits2026) {
    await prisma.contributionLimit.upsert({
      where: { year_bucket: { year: 2026, bucket } },
      create: { year: 2026, bucket, amountCents, notes },
      update: { amountCents, notes },
    });
  }

  // --- Riding directory (real Elections Ontario roster; see header comment) ---
  await seedRidings();

  // --- RTD business-day calendars (ticket 0.10; editable annual config) ---
  for (const year of [2025, 2026, 2027]) {
    await prisma.businessDayCalendar.upsert({
      where: { year },
      create: { year, holidays: standardOntarioEsaHolidays(year) },
      update: {},
    });
  }

  // --- Receipt sequence (seeded at the legacy global maximum, data-model §7) ---
  await prisma.receiptSequence.upsert({
    where: { prefix: 'GPO-' },
    create: { prefix: 'GPO-', counter: 402_509 },
    update: {},
  });

  // --- Kill switch singleton (disengaged) ---
  await prisma.issuanceKillSwitch.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });

  // --- Users (dev password; change on first real deploy) ---
  const devHash = await hashPassword('change-me-please-12345');
  const users: Array<{
    email: string;
    name: string;
    role:
      | 'sysadmin'
      | 'party_cfo'
      | 'administrator'
      | 'rules_authority'
      | 'bookkeeper'
      | 'filer';
    isCfoDesignate?: boolean;
    allRidings?: boolean;
  }> = [
    { email: 'sysadmin@gpo.test', name: 'Sys Admin', role: 'sysadmin', allRidings: true },
    { email: 'cfo@gpo.test', name: 'Party CFO', role: 'party_cfo', allRidings: true },
    { email: 'admin@gpo.test', name: 'Receipt Administrator', role: 'administrator', allRidings: true },
    { email: 'rules@gpo.test', name: 'Rules Authority', role: 'rules_authority', allRidings: true },
    { email: 'books@gpo.test', name: 'Bookkeeper', role: 'bookkeeper', allRidings: true },
    { email: 'filer@gpo.test', name: 'RTD Filer', role: 'filer', isCfoDesignate: true, allRidings: true },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: devHash,
        isCfoDesignate: u.isCfoDesignate ?? false,
        allRidings: u.allRidings ?? false,
      },
      update: { role: u.role },
    });
  }

  console.log('seed complete');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
