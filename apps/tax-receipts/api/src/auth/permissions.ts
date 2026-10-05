import type { AbilityBuilder } from '@casl/ability';
import type { AppAbility } from './abilities.js';

/**
 * The permission catalogue (EO evaluation rows 7 and 8): the system
 * functions an administrator can assign to a role. Roles and their
 * permission lists are data (`role`, `role_permission`); the catalogue is
 * code, because each permission stands for the CASL rules the routes
 * actually check (`request.ability.can(...)`), and a new function needs a
 * new route check anyway.
 *
 * A permission key unknown to this catalogue (one removed after a role was
 * saved) grants nothing; see `defineAbilitiesFor`.
 */

type Can = AbilityBuilder<AppAbility>['can'];

export interface PermissionDef {
  group: string;
  label: string;
  description: string;
  grant: (can: Can) => void;
}

export const PERMISSION_KEYS = [
  'system.manage',
  'users.administer',
  'settings.administer',
  'records.readAll',
  'payment.enter',
  'contribution.edit',
  'contribution.correct',
  'workItem.create',
  'workItem.resolve',
  'receipt.issue',
  'receipt.correct',
  'killSwitch.administer',
  'reconciliation.manage',
  'entityReport.generate',
  'entityReport.share',
  'filing.prepare',
  'filing.submit',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSIONS: Record<PermissionKey, PermissionDef> = {
  'system.manage': {
    group: 'System',
    label: 'Full system access',
    description: 'Every function in the tool, including any added later. Reserved for system administrators.',
    grant: (can) => {
      can('manage', 'all');
    },
  },
  'users.administer': {
    group: 'System',
    label: 'Manage users and roles',
    description: 'Create and edit user accounts, assign roles, and define roles and their permissions.',
    grant: (can) => {
      can('administer', 'User');
    },
  },
  'settings.administer': {
    group: 'System',
    label: 'Manage annual settings',
    description: 'Edit periods, contribution limits, the RTD holiday calendar, and ridings, and use the email log and outbox tools.',
    grant: (can) => {
      can('administer', ['Period', 'ContributionLimit', 'Riding']);
    },
  },
  'records.readAll': {
    group: 'Records',
    label: 'Read all records',
    description:
      'Read every record, including payments, reconciliation, and EO forms. Every signed-in user can already read contributions, receipts, the work queue, filings, reports, periods, and limits.',
    grant: (can) => {
      can('read', 'all');
    },
  },
  'payment.enter': {
    group: 'Contributions',
    label: 'Enter payments',
    description: 'Record manual payments (cheque, cash, e-transfer) and the contributions they fund.',
    grant: (can) => {
      can('create', ['Payment', 'Contribution']);
    },
  },
  'contribution.edit': {
    group: 'Contributions',
    label: 'Edit contribution details',
    description: 'Edit source code, entity, and other contribution details, and send donor pre-check emails.',
    grant: (can) => {
      can('update', ['Contribution', 'ContributionMetadata']);
    },
  },
  'contribution.correct': {
    group: 'Contributions',
    label: 'Correct contributions',
    description: 'Run correction actions on contributions: correct amount, move, split, refund, and merge contacts.',
    grant: (can) => {
      can('correct', 'Contribution');
    },
  },
  'workItem.create': {
    group: 'Work queue',
    label: 'Create work items',
    description: 'Raise new items on the work queue by hand.',
    grant: (can) => {
      can('create', 'WorkItem');
    },
  },
  'workItem.resolve': {
    group: 'Work queue',
    label: 'Resolve work items',
    description: 'Assign, resolve, and record exceptions against work-queue items.',
    grant: (can) => {
      can('update', 'WorkItem');
    },
  },
  'receipt.issue': {
    group: 'Receipts',
    label: 'Issue receipts',
    description:
      'Issue and reissue tax receipts and send them to donors. By law (EFA s. 25.1(6)) only the party CFO or an authorized designate may do this.',
    grant: (can) => {
      can('issue', 'Receipt');
    },
  },
  'receipt.correct': {
    group: 'Receipts',
    label: 'Correct receipts',
    description: 'Cancel receipts, mark them lost, reprint copies, and run corrections that cancel or replace a receipt.',
    grant: (can) => {
      can('correct', 'Receipt');
    },
  },
  'killSwitch.administer': {
    group: 'Receipts',
    label: 'Operate the issuance kill switch',
    description: 'Stop and restart all receipt issuance (EFA s. 25.1(7)).',
    grant: (can) => {
      can('administer', 'IssuanceKillSwitch');
    },
  },
  'reconciliation.manage': {
    group: 'Reconciliation',
    label: 'Reconcile deposits',
    description: 'Create and match reconciliation marks against deposits.',
    grant: (can) => {
      can(['create', 'update', 'reconcile'], 'ReconciliationMark');
    },
  },
  'entityReport.generate': {
    group: 'Reporting',
    label: 'Generate entity reports',
    description: 'Generate the ALL and S2P2 reports for a period and entity.',
    grant: (can) => {
      can('create', 'EntityReport');
    },
  },
  'entityReport.share': {
    group: 'Reporting',
    label: 'Share entity reports',
    description: 'Send a generated report to a riding association or campaign CFO.',
    grant: (can) => {
      can('share', 'EntityReport');
    },
  },
  'filing.prepare': {
    group: 'Reporting',
    label: 'Prepare EO filings',
    description: 'Prepare RTD filings and EO forms for submission.',
    grant: (can) => {
      can('create', ['RtdFiling', 'EOForm']);
    },
  },
  'filing.submit': {
    group: 'Reporting',
    label: 'Submit EO filings',
    description: 'Submit RTD filings and EO forms to Elections Ontario, and approve reallocations that need an EO form.',
    grant: (can) => {
      can('file', ['RtdFiling', 'EOForm']);
    },
  },
};

export function isPermissionKey(key: string): key is PermissionKey {
  return Object.hasOwn(PERMISSIONS, key);
}

export interface BuiltInRole {
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
}

/**
 * The roles the tool ships with (stakeholders.md "What this implies for the
 * tool"). Until the role table existed these were a fixed enum and a
 * `switch` in `defineAbilitiesFor`; the lists below grant exactly what that
 * switch did (`abilities.test.ts` holds the old switch and checks it).
 *
 * Seeded by the `role_table` migration on existing databases and by
 * `ensureBuiltInRoles` on fresh ones. After that they are ordinary rows an
 * administrator can edit, except `sysadmin` (see `LOCKED_ROLE_KEYS`).
 */
export const BUILT_IN_ROLES: BuiltInRole[] = [
  {
    key: 'sysadmin',
    name: 'System administrator',
    description: 'Full configuration and user administration.',
    permissions: ['system.manage'],
  },
  {
    key: 'party_cfo',
    name: 'Party CFO',
    description: 'The only role that may issue receipts (EFA s. 25.1(6)); files with EO.',
    permissions: [
      'records.readAll',
      'payment.enter',
      'contribution.edit',
      'contribution.correct',
      'receipt.issue',
      'receipt.correct',
      'killSwitch.administer',
      'entityReport.generate',
      'entityReport.share',
      'filing.submit',
    ],
  },
  {
    key: 'administrator',
    name: 'Receipt administrator',
    description: 'Day-to-day contribution and receipt work.',
    permissions: [
      'payment.enter',
      'contribution.edit',
      'contribution.correct',
      'workItem.create',
      'workItem.resolve',
      'receipt.correct',
    ],
  },
  {
    key: 'rules_authority',
    name: 'Rules authority',
    description: 'Eligibility calls, moves between entities, and non-deductible amounts.',
    permissions: ['contribution.edit', 'contribution.correct', 'workItem.resolve'],
  },
  {
    key: 'bookkeeper',
    name: 'Bookkeeper',
    description: 'Reconciliation, S2P2, and auditor liaison.',
    permissions: ['records.readAll', 'reconciliation.manage', 'entityReport.generate', 'workItem.resolve'],
  },
  {
    key: 'filer',
    name: 'Filer',
    description: 'Prepares and submits reports and forms to EO.',
    permissions: [
      'records.readAll',
      'filing.prepare',
      'filing.submit',
      'entityReport.generate',
      'entityReport.share',
      'workItem.resolve',
    ],
  },
  {
    key: 'process_owner',
    name: 'Process owner',
    description: 'Oversight: reads everything, including who has done what.',
    permissions: ['records.readAll'],
  },
  {
    key: 'organizer',
    name: 'Organizer',
    description: 'Liaison with riding association and campaign CFOs.',
    permissions: ['entityReport.share'],
  },
  {
    key: 'cfo',
    name: 'Riding or campaign CFO',
    description: 'External CFO: reads only their granted riding(s).',
    permissions: [],
  },
  {
    key: 'readonly',
    name: 'Read only',
    description: 'Reads the operational screens; changes nothing.',
    permissions: [],
  },
];

/** Roles whose permissions cannot be edited and which cannot be deleted:
 *  removing `system.manage` from the system administrator would leave no
 *  one able to repair the role table from inside the tool. */
export const LOCKED_ROLE_KEYS: ReadonlySet<string> = new Set(['sysadmin']);

/** The role a new user gets when none is given (`app_user.role_key`
 *  default). */
export const DEFAULT_ROLE_KEY = 'readonly';
