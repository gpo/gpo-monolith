import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from '@casl/ability';
import { isPermissionKey, PERMISSIONS } from './permissions.js';

/**
 * CASL policies keyed on the user's role permissions + per-riding grants
 * (data-model §2 User, ticket 0.5). A role is a row in `role` with a list of
 * permission keys (`role_permission`); each key's CASL rules live in the
 * catalogue in `auth/permissions.ts`. Authorization lives at the query layer: the same ability that
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
  | 'Contact'
  | 'Payment'
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
  | 'IssuanceKillSwitch'
  | 'Riding';

export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

export interface AbilityUser {
  id: string;
  /** permission keys held through the user's role */
  permissions: readonly string[];
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

  for (const key of user.permissions) {
    // a key the catalogue no longer has grants nothing
    if (isPermissionKey(key)) PERMISSIONS[key].grant(can);
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
