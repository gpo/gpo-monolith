import { contributionYear, paymentMethodFromQomon } from '@gpo/tax-receipts-core';
import { PrismaClient, type EntityKind, type ReceivedBy } from '../src/generated/prisma/index.js';
import { allocateToReceipt } from '../src/receipts/allocate.js';
import { issueReceipt } from '../src/receipts/issue.js';
import { withChangeLog } from '../src/changelog/write.js';
import { runValidationForAllContributions } from '../src/validation/run.js';
import { resolveWorkItem } from '../src/work-items/resolve.js';

/**
 * Consolidated manual-test fixture set. One script, one command
 * (`pnpm db:seed:fixtures`), covering every use case the old
 * `seed-phase-2-fixtures.ts` and `seed-phase-3-fixtures.ts` covered
 * separately, plus new fixtures for what's shipped since (RTD flow,
 * tickets 2.2-2.8; allocation consolidation, ticket 3.2). Needs `pnpm
 * db:seed` run first — periods, contribution limits, the real riding
 * directory, and the party CFO user this script issues receipts as.
 *
 * Idempotent by construction, same pattern the two predecessor scripts
 * used: every contact/contribution is keyed by a reserved id range (below),
 * every `Period` this script needs is create-if-absent, and re-running only
 * fills in whatever's missing. Ridings are handled differently — see "Why
 * this replaces two scripts instead of adding a third" below — but are
 * still idempotent: `forceRidingActive` is a no-op once the target state is
 * already reached. **Local/dev database only** — do not point this at a
 * shared environment with real riding config or real donor data.
 *
 * ## Why this replaces two scripts instead of adding a third
 *
 * `seed-phase-2-fixtures.ts` and `seed-phase-3-fixtures.ts` each invented
 * their own "fixture" riding numbers (12, 84, 90) picked without checking
 * against anything real, because no real riding data had ever been loaded
 * into a dev database at the time. Once `prisma/seed.ts` started loading
 * the real 124-riding Elections Ontario directory (`ontario-ridings.json`),
 * those numbers turned out to collide with real ridings under fake names —
 * 84 is really Parry Sound—Muskoka, not "York-Simcoe (fixture)"; 90 is
 * really St. Catharines, not "Simcoe North (fixture)"; 12 is really
 * Brampton West, not "Testville."
 *
 * **A genuinely fixture-only riding number turned out not to be an option.**
 * The first pass of this consolidation tried moving every fixture riding to
 * 9001-9003, outside the real 1-124 range — but rule A2
 * (`checkA2RidingEntityConsistency`, `tax-receipts-core/src/validation/
 * rules.ts`) hard-validates `ridingNumber` against 1-124 as a *shape* check,
 * independent of whether a `Riding` row exists at that number. An
 * out-of-range riding number doesn't dodge collision with real data; it
 * just trips A2's "riding number is out of range" finding instead of
 * whatever the fixture meant to demonstrate (confirmed by actually running
 * this script and diffing the result against
 * `PHASE-2-MANUAL-TEST-PLAN.md`'s expected-findings table — three donors
 * that should have been clean or shown A3 showed A2 instead). Ontario has
 * 124 ridings and the tool models exactly that; there is no room to reserve
 * a fixture-only block the way `Period.id` has room for 9001+.
 *
 * The actual fix: fixtures **borrow real riding numbers**, chosen to match
 * what the original fixture names were already trying to say. 121 (York—
 * Simcoe) and 100 (Simcoe North) are used as ordinary active ridings — no
 * different from any real CA operating there, so they need no special
 * handling and nothing here mutates them. Riding 12 (Brampton West) is
 * borrowed for the one fixture that genuinely needs an *inactive* riding
 * (the A3 "defunct CA" case) — this really does mean this script sets a
 * real riding's `active` flag to `false` on your dev database. That's
 * restored to the real import's `true` the next time you run `pnpm
 * db:seed` (idempotent, always safe to rerun) — see `forceRidingActive`
 * below for the one place this script touches riding state that isn't
 * purely additive.
 *
 * ## Reserved id ranges
 *
 * | Range | What |
 * |---|---|
 * | Riding 12 (real: Brampton West) | Forced `active: false` by this script — the "defunct riding" case (A3). Restored by re-running `pnpm db:seed`. |
 * | Riding 121 (real: York—Simcoe) | Used as-is, active — "riding A" everywhere a CA/campaign fixture needs *an* active riding. |
 * | Riding 100 (real: Simcoe North) | Used as-is, active — "riding B," kept distinct from 121 so a fixture needing two different ridings (Space D) still demonstrates that. |
 * | Period 9501 | Fixture-only by-election period (`BY_ELECTION`), scoped to riding 121 — periods have no such 1-124 constraint, so a reserved block works fine here. |
 * | Period 9502 | Fixture-only annual period ("Space A"), dated 2028 so it can never collide with a real period's date range or with real Qomon-mirrored data landing in the real 2026 Annual party space. |
 * | Contacts/contributions 800001-800017 | Group 1: one contribution per validation rule (ticket 2.1), plus a three-deposit RTD row-inclusion case reused by Group 2 below. |
 * | Contacts/contributions 900001-900012, 900101-900102 | Group 2: five issuance spaces (ticket 3.12) - clean, blocked, partial-failure, multi-space donor. |
 * | Contacts/contributions 910001-910002 | Group 3 (new): one donor, two contributions, consolidated onto one receipt (ticket 3.2). |
 *
 * Run: `pnpm db:seed:fixtures` (needs `pnpm db:seed` run first — it must run
 * first, not just "first the first time," since this script depends on the
 * real riding directory already existing to borrow riding numbers from).
 */

const prisma = new PrismaClient();

const ANNUAL_2026 = 67; // '2026 Annual', from prisma/seed.ts
const ANNUAL_2025 = 63; // '2025 Annual', from prisma/seed.ts
const BY_ELECTION_PERIOD_ID = 9501;
const SPACE_A_PERIOD_ID = 9502; // see header comment: why this can't be the real 2026 Annual period

// Real riding numbers, borrowed for fixture use — see header comment for
// why there's no such thing as a "fixture-only" riding number here.
const FIXTURE_DEFUNCT_RIDING = 12; // real: Brampton West — forced inactive below
const FIXTURE_ACTIVE_RIDING_A = 121; // real: York—Simcoe
const FIXTURE_ACTIVE_RIDING_B = 100; // real: Simcoe North

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

// ===========================================================================
// Group 1 — validation rule coverage (ticket 2.1) + RTD row-inclusion prep
// (tickets 2.2-2.8's raw material; see "RTD flow" section at the bottom of
// this file for how to actually exercise draft/stamp/archive/DC-1A/screen
// against the "Threshold Crossing Donor" rows below).
// ===========================================================================

interface Group1Fixture {
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

const GROUP_1_FIXTURES: Group1Fixture[] = [
  {
    demonstrates: 'clean baseline — expect zero new findings',
    qomonContactId: 800_001n,
    contactName: 'Baseline Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_001n,
    amountCents: 5_000,
    acceptedAt: '2026-03-01T12:00:00Z',
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
    ridingNumber: FIXTURE_ACTIVE_RIDING_A,
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
    periodId: ANNUAL_2026,
    ridingNumber: FIXTURE_DEFUNCT_RIDING,
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
    periodId: ANNUAL_2026,
    ridingNumber: FIXTURE_ACTIVE_RIDING_A,
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
    ridingNumber: FIXTURE_ACTIVE_RIDING_A,
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
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
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
    periodId: ANNUAL_2026,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  // --- RTD fixtures: one contact, three deposits, crossing the $200 RTD
  //     threshold on the second. Raw material for the RTD-flow walkthrough
  //     (tickets 2.2-2.8) below, in addition to their original 2.1 purpose
  //     (this row set predates 2.2 and was seeded ready for it). ---
  {
    demonstrates: 'RTD row-inclusion — deposit 1/3, $150, stays under $200',
    qomonContactId: 800_015n,
    contactName: 'Threshold Crossing Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_015n,
    amountCents: 15_000,
    acceptedAt: '2026-02-01T12:00:00Z',
    periodId: ANNUAL_2026,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'RTD row-inclusion — deposit 2/3, $100, crosses $200 (year-to-date $250)',
    qomonContactId: 800_015n,
    contactName: 'Threshold Crossing Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_016n,
    amountCents: 10_000,
    acceptedAt: '2026-04-01T12:00:00Z',
    periodId: ANNUAL_2026,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
  {
    demonstrates: 'RTD row-inclusion — deposit 3/3, $75, its own row (year-to-date $325)',
    qomonContactId: 800_015n,
    contactName: 'Threshold Crossing Donor',
    address: ONTARIO_ADDRESS,
    qomonTransactionId: 800_017n,
    amountCents: 7_500,
    acceptedAt: '2026-06-01T12:00:00Z',
    periodId: ANNUAL_2026,
    ridingNumber: null,
    entityKind: 'PARTY',
    receivedBy: 'GPO',
  },
];

// ===========================================================================
// Group 2 — per-space issuance (ticket 3.12): five spaces (period, riding,
// entity kind) shaped to show a clean batch, a blocked batch, a partial
// generate-time failure, and one donor spanning three spaces.
// ===========================================================================

interface Group2Fixture {
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

const SPACE_A = 'Space A — PARTY / fixture period 9502 (clean, ready to issue)';
const SPACE_B = 'Space B — CA / riding 121 York—Simcoe / 2026 Annual (blocked)';
const SPACE_C = 'Space C — CAMPAIGN / riding 121 York—Simcoe / by-election (period 9501) (clean)';
const SPACE_D = 'Space D — CA / riding 100 Simcoe North / 2026 Annual (partial failure on generate)';
const SPACE_F = 'Space F — PARTY / 2025 Annual (clean, a second period)';

const GROUP_2_FIXTURES: Group2Fixture[] = [
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
    ridingNumber: FIXTURE_ACTIVE_RIDING_A,
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
    ridingNumber: FIXTURE_ACTIVE_RIDING_A,
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
    ridingNumber: FIXTURE_ACTIVE_RIDING_A,
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
    ridingNumber: FIXTURE_ACTIVE_RIDING_A,
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
    ridingNumber: FIXTURE_ACTIVE_RIDING_B,
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
    ridingNumber: FIXTURE_ACTIVE_RIDING_B,
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

// ===========================================================================
// Group 3 (new) — allocation consolidation (ticket 3.2): one donor, two
// contributions in the same space, consolidated onto a single receipt via
// `allocateToReceipt` rather than one receipt each. Lands in Space A so the
// per-space wizard's preview correctly excludes both (fully allocated), same
// as Already Issued Ivy above.
// ===========================================================================

const GROUP_3_CONTACT = { qomonContactId: 910_001n, name: 'Consolidating Chris' };
/** A seeded contribution is found through its Qomon link (D12): the
 *  fixtures are keyed by a reserved Qomon transaction id, the same way an
 *  import would key them. */
async function findSeededContribution(qomonTransactionId: bigint) {
  const link = await prisma.qomonTransactionLink.findUnique({
    where: { qomonTransactionId },
    include: { payment: { include: { contributions: true } } },
  });
  return link?.payment.contributions[0] ?? null;
}

/** Payment + Qomon link + initial contribution (with its descriptive fields,
 *  when given) in one change-logged write, as an import would create them.
 *  `contribution` is a guarded table (invariant 5), so it goes through
 *  `withChangeLog`. */
async function createSeedContribution(args: {
  contactId: string;
  qomonTransactionId: bigint;
  amountCents: number;
  acceptedAt: Date;
  paymentMethodKind: string;
  externalRef?: string | null;
  reason: string;
  descriptive?: {
    periodId: number;
    ridingNumber?: number | null;
    entityKind: EntityKind;
    receivedBy: ReceivedBy;
    nonDeductibleCents?: number;
    goodsServices?: boolean;
  };
}) {
  return withChangeLog(prisma, { userId: null, reason: args.reason }, async (ctx) => {
    const payment = await ctx.tx.payment.create({
      data: {
        source: 'QOMON_IMPORT',
        contactId: args.contactId,
        amountCents: args.amountCents,
        receivedAt: args.acceptedAt,
        method: paymentMethodFromQomon(args.paymentMethodKind),
        externalRef: args.externalRef ?? null,
        qomonLink: {
          create: {
            qomonTransactionId: args.qomonTransactionId,
            qomonPaymentMethodKind: args.paymentMethodKind,
            lastSyncedAt: new Date(),
          },
        },
        contributions: {
          create: {
            contactId: args.contactId,
            amountCents: args.amountCents,
            acceptedAt: args.acceptedAt,
            ...(args.descriptive ?? {}),
          },
        },
      },
      include: { contributions: true },
    });
    const contribution = payment.contributions[0]!;
    await ctx.log({ subjectType: 'Contribution', subjectId: contribution.id, after: contribution });
    return contribution;
  });
}

const GROUP_3_CONTRIBUTIONS = [
  { qomonTransactionId: 910_001n, amountCents: 4_000, acceptedAt: '2028-03-05T12:00:00Z' },
  { qomonTransactionId: 910_002n, amountCents: 2_500, acceptedAt: '2028-03-10T12:00:00Z' },
];

async function ensureGroup3(cfoUserId: string): Promise<void> {
  const existing = await findSeededContribution(GROUP_3_CONTRIBUTIONS[0]!.qomonTransactionId);
  if (existing) {
    console.log('  skip (already seeded): Consolidating Chris — allocation consolidation (ticket 3.2)');
    return;
  }

  let contact = await prisma.contact.findUnique({ where: { qomonContactId: GROUP_3_CONTACT.qomonContactId } });
  contact ??= await prisma.contact.create({
    data: { qomonContactId: GROUP_3_CONTACT.qomonContactId, name: GROUP_3_CONTACT.name, addresses: [ONTARIO_ADDRESS] },
  });

  const contributionIds: string[] = [];
  for (const c of GROUP_3_CONTRIBUTIONS) {
    const contribution = await createSeedContribution({
      contactId: contact.id,
      qomonTransactionId: c.qomonTransactionId,
      amountCents: c.amountCents,
      acceptedAt: new Date(c.acceptedAt),
      paymentMethodKind: 'card',
      reason: 'phase-3 fixture: allocation consolidation (ticket 3.2)',
      descriptive: {
        periodId: SPACE_A_PERIOD_ID,
        entityKind: 'PARTY',
        receivedBy: 'GPO',
      },
    });
    contributionIds.push(contribution.id);
  }

  const receipt = await issueReceipt(
    { prisma, storageDir: STORAGE_DIR },
    {
      contributionId: contributionIds[0]!,
      actorUserId: cfoUserId,
      reason: 'phase-3 fixture: first leg of a consolidated receipt (ticket 3.2)',
      politicalEntityLabel: 'Green Party of Ontario',
    },
  );
  await allocateToReceipt(
    { prisma },
    {
      receiptId: receipt.id,
      contributionId: contributionIds[1]!,
      actorUserId: cfoUserId,
      reason: 'phase-3 fixture: second leg consolidated onto the same receipt (ticket 3.2)',
    },
  );

  console.log(
    `  created + consolidated ${receipt.receiptNumber}: Consolidating Chris — two contributions ($40.00 + $25.00), one receipt ($65.00 total)`,
  );
  console.log(
    '    NOTE: generating an ALL/S2P2 entity report for period 9502 will now throw MultiAllocationReceiptError',
  );
  console.log('    (reports/load-receipts.ts) — that is expected, see open-questions.md O44. Try it deliberately.');
}

// ===========================================================================
// Setup helpers (ridings, periods) + the per-fixture writers
// ===========================================================================

/** Forces a real riding's `active` flag for fixture purposes — the one
 *  place this script mutates riding state rather than only adding to it.
 *  Never touches `name`/`qomonApiKey`, so the real import's data survives;
 *  `pnpm db:seed` (idempotent) restores `active: true` for every real
 *  riding, including this one, whenever you want the real state back. */
async function forceRidingActive(ridingNumber: number, active: boolean, why: string): Promise<void> {
  const riding = await prisma.riding.findUnique({ where: { ridingNumber } });
  if (!riding) {
    throw new Error(
      `riding ${ridingNumber} not found — run \`pnpm db:seed\` first (it loads the real riding directory this fixture set borrows numbers from)`,
    );
  }
  if (riding.active === active) {
    console.log(`  riding ${ridingNumber} ("${riding.name}"): already active=${active} — left as-is`);
    return;
  }
  await prisma.riding.update({ where: { ridingNumber }, data: { active } });
  console.log(`  riding ${ridingNumber} ("${riding.name}"): set active=${active} (${why})`);
}

async function ensurePeriod(id: number, name: string, kind: 'ANNUAL' | 'BY_ELECTION', ridingNumbers: number[], startsAt: string, endsAt: string): Promise<void> {
  const existing = await prisma.period.findUnique({ where: { id } });
  if (existing) {
    console.log(`  period ${id}: already exists — left as-is`);
    return;
  }
  await prisma.period.create({
    data: { id, name, kind, ridingNumbers, startsAt: new Date(startsAt), endsAt: new Date(endsAt) },
  });
  console.log(`  period ${id}: created (${kind})`);
}

async function ensureGroup1Fixture(f: Group1Fixture): Promise<void> {
  const existingContribution = await findSeededContribution(f.qomonTransactionId);
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

  const contribution = await createSeedContribution({
    contactId: contact.id,
    qomonTransactionId: f.qomonTransactionId,
    amountCents: f.amountCents,
    acceptedAt: new Date(f.acceptedAt),
    paymentMethodKind: f.paymentMethodKind ?? 'card',
    externalRef: f.externalRef ?? null,
    reason: `fixture: ${f.demonstrates}`,
    descriptive: {
      periodId: f.periodId,
      ridingNumber: f.ridingNumber,
      entityKind: f.entityKind,
      receivedBy: f.receivedBy,
    },
  });

  console.log(`  created: ${f.demonstrates}`);
}

async function ensureGroup2Fixture(f: Group2Fixture, cfoUserId: string): Promise<void> {
  const existingContribution = await findSeededContribution(f.qomonTransactionId);
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
  const contribution = await createSeedContribution({
    contactId: contact.id,
    qomonTransactionId: f.qomonTransactionId,
    amountCents: f.amountCents,
    acceptedAt,
    paymentMethodKind: 'card',
    reason: `fixture: ${f.demonstrates}`,
    descriptive: {
      periodId: f.periodId,
      ridingNumber: f.ridingNumber,
      entityKind: f.entityKind,
      receivedBy: f.receivedBy,
      nonDeductibleCents: f.nonDeductibleCents ?? 0,
      goodsServices: (f.nonDeductibleCents ?? 0) > 0,
    },
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
        reason: `fixture: pre-issued so this space's preview excludes it (${f.demonstrates})`,
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
    throw new Error('cfo@gpo.test not found — run `pnpm db:seed` first (it creates the party CFO user and the real riding directory).');
  }

  console.log('Riding state + fixture-only periods (see header comment for the id-range table):');
  await forceRidingActive(FIXTURE_DEFUNCT_RIDING, false, 'demonstrates A3 — real ridings 121/100 below are left at their real active:true');
  await ensurePeriod(BY_ELECTION_PERIOD_ID, 'Fixture by-election (not a real EO period)', 'BY_ELECTION', [FIXTURE_ACTIVE_RIDING_A], '2026-06-01T05:00:00Z', '2026-09-01T04:00:00Z');
  await ensurePeriod(SPACE_A_PERIOD_ID, 'Fixture — clean space (not a real EO period)', 'ANNUAL', [], '2028-01-01T05:00:00Z', '2029-01-01T05:00:00Z');

  console.log('Group 1 — validation rule coverage + RTD row-inclusion prep:');
  for (const fixture of GROUP_1_FIXTURES) {
    await ensureGroup1Fixture(fixture);
  }

  console.log('Group 2 — per-space issuance:');
  let currentSpace = '';
  for (const fixture of GROUP_2_FIXTURES) {
    if (fixture.space !== currentSpace) {
      currentSpace = fixture.space;
      console.log(`  -- ${currentSpace}`);
    }
    await ensureGroup2Fixture(fixture, cfo.id);
  }

  console.log('Group 3 — allocation consolidation (ticket 3.2):');
  await ensureGroup3(cfo.id);

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
  const nedContribution = await findSeededContribution(900_008n);
  if (nedContribution) {
    const c1Item = await prisma.workItem.findFirst({
      where: { subjectType: 'Contribution', subjectId: nedContribution.id, ruleRef: 'C1', status: 'OPEN' },
    });
    if (c1Item) {
      await resolveWorkItem(prisma, {
        workItemId: c1Item.id,
        actorUserId: cfo.id,
        reason: 'fixture: excepted on purpose so Space D demonstrates a generate-time failure, not a blocked space',
        outcome: 'EXCEPTION',
      });
      console.log('  excepted No Address Ned’s C1 work item so Space D is issuable (but his generate will still fail)');
    }
  }

  console.log('Done — see PHASE-2-MANUAL-TEST-PLAN.md and PHASE-3-MANUAL-TEST-PLAN.md for what to check.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
