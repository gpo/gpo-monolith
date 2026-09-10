import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from '@casl/ability';
import type { UserRole } from '@gpo/tax-receipts-core';

/**
 * CASL policies keyed on role + per-riding grants (data-model §2 User,
 * ticket 0.5). Authorization lives at the query layer: the same ability that
 * answers `can(...)` also produces Prisma `where` fragments (see
 * `ridingScopeWhere`).
 *
 * Two rules are load-bearing for the EO evaluation:
 *  - only the party CFO (or an authorized designate) can `issue` a Receipt
 *    (compliance.md, s. 25.1(6));
 *  - the statutory kill switch is checked separately at every issuance path
 *    (see auth/kill-switch.ts) because it is live DB state, not a policy.
 */

export type AppAction =
  | 'manage'
  | 'read'
  | 'create'
  | 'update'
  | 'issue' // issue or reissue a receipt
  | 'correct' // run a correction action
  | 'file' // submit an RTD filing / EO form
  | 'reconcile'
  | 'share' // send an entity report to a CFO
  | 'administer'; // users, periods, limits, kill switch

export type AppSubject =
  | 'all'
  | 'Contribution'
  | 'ContributionMetadata'
  | 'Receipt'
  | 'WorkItem'
  | 'RtdFiling'
  | 'EntityReport'
  | 'EOForm'
  | 'ReconciliationMark'
  | 'Period'
  | 'ContributionLimit'
  | 'User'
  | 'IssuanceKillSwitch';

export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

export interface AbilityUser {
  id: string;
  role: UserRole;
  isCfoDesignate: boolean;
  allRidings: boolean;
  ridingGrants: number[];
}

export function defineAbilitiesFor(user: AbilityUser): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // Everyone authenticated can read the operational surface.
  can('read', [
    'Contribution',
    'ContributionMetadata',
    'Receipt',
    'WorkItem',
    'RtdFiling',
    'EntityReport',
    'Period',
    'ContributionLimit',
  ]);

  switch (user.role) {
    case 'sysadmin':
      can('manage', 'all');
      break;

    case 'party_cfo':
      can('read', 'all');
      can('issue', 'Receipt');
      can('correct', 'Receipt');
      can('correct', 'Contribution');
      can('update', 'ContributionMetadata');
      can('file', ['RtdFiling', 'EOForm']);
      can('administer', 'IssuanceKillSwitch');
      break;

    case 'administrator':
      can('update', ['Contribution', 'ContributionMetadata']);
      can(['create', 'update'], 'WorkItem');
      can('correct', ['Receipt', 'Contribution']);
      break;

    case 'rules_authority':
      can('update', ['Contribution', 'ContributionMetadata']);
      can('update', 'WorkItem');
      can('correct', 'Contribution');
      break;

    case 'bookkeeper':
      can('read', 'all');
      can(['create', 'update', 'reconcile'], 'ReconciliationMark');
      can('update', 'WorkItem');
      break;

    case 'filer':
      can('read', 'all');
      can(['create', 'file'], ['RtdFiling', 'EOForm']);
      can('update', 'WorkItem');
      break;

    case 'process_owner':
      can('read', 'all');
      break;

    case 'organizer':
      can('share', 'EntityReport');
      break;

    case 'cfo':
      // external CFO: read only, scoped to their granted riding(s)
      break;

    case 'readonly':
      break;
  }

  // A DC-1 designate may issue and correct receipts on the CFO's authority
  // (compliance.md: "issuance is an act of the CFO or their authorized
  // designates").
  if (user.isCfoDesignate) {
    can('issue', 'Receipt');
    can('correct', 'Receipt');
    can('file', ['RtdFiling', 'EOForm']);
  }

  return build();
}

/**
 * The Prisma `where` fragment that scopes riding-bearing rows to what a user
 * may see. `{}` means unrestricted (central staff / sysadmin); otherwise the
 * row's `ridingNumber` must be in the grant list (nulls, i.e. party-level,
 * are visible to everyone).
 */
export function ridingScopeWhere(
  user: Pick<AbilityUser, 'allRidings' | 'ridingGrants'>,
): { ridingNumber?: { in: number[] } | null } | Record<string, never> {
  if (user.allRidings) return {};
  return {
    ridingNumber: { in: user.ridingGrants },
  };
}

export function canSeeRiding(
  user: Pick<AbilityUser, 'allRidings' | 'ridingGrants'>,
  ridingNumber: number | null,
): boolean {
  if (user.allRidings) return true;
  if (ridingNumber === null) return true;
  return user.ridingGrants.includes(ridingNumber);
}
