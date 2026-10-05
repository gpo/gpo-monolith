import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { describe, expect, it } from 'vitest';
import { defineAbilitiesFor, type AppAbility, type AppAction, type AppSubject } from './abilities.js';
import { BUILT_IN_ROLES, LOCKED_ROLE_KEYS, PERMISSION_KEYS } from './permissions.js';
import { roleKeyFromName } from './roles.js';

/**
 * The role switch `defineAbilitiesFor` used before roles became rows
 * (the `role_table` migration), kept verbatim apart from the shared
 * everyone-reads block and the designate block, which are unchanged in the
 * live code. BUILT_IN_ROLES must reproduce it so that no existing user
 * gains or loses access in the move.
 */
function legacyAbilities(role: string): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  switch (role) {
    case 'sysadmin':
      can('manage', 'all');
      break;
    case 'party_cfo':
      can('read', 'all');
      can('issue', 'Receipt');
      can('correct', 'Receipt');
      can('correct', 'Contribution');
      can('create', ['Payment', 'Contribution']);
      can('update', 'ContributionMetadata');
      can('file', ['RtdFiling', 'EOForm']);
      can(['create', 'share'], 'EntityReport');
      can('administer', 'IssuanceKillSwitch');
      break;
    case 'administrator':
      can('update', ['Contribution', 'ContributionMetadata']);
      can(['create', 'update'], 'WorkItem');
      can('correct', ['Receipt', 'Contribution']);
      can('create', ['Payment', 'Contribution']);
      break;
    case 'rules_authority':
      can('update', ['Contribution', 'ContributionMetadata']);
      can('update', 'WorkItem');
      can('correct', 'Contribution');
      break;
    case 'bookkeeper':
      can('read', 'all');
      can(['create', 'update', 'reconcile'], 'ReconciliationMark');
      can('create', 'EntityReport');
      can('update', 'WorkItem');
      break;
    case 'filer':
      can('read', 'all');
      can(['create', 'file'], ['RtdFiling', 'EOForm']);
      can(['create', 'share'], 'EntityReport');
      can('update', 'WorkItem');
      break;
    case 'process_owner':
      can('read', 'all');
      break;
    case 'organizer':
      can('share', 'EntityReport');
      break;
  }
  return build();
}

const ACTIONS: AppAction[] = [
  'manage', 'read', 'create', 'update', 'issue', 'correct', 'file', 'reconcile', 'share', 'administer',
];
const SUBJECTS: AppSubject[] = [
  'all', 'Contribution', 'Payment', 'ContributionMetadata', 'Receipt', 'WorkItem', 'RtdFiling',
  'EntityReport', 'EOForm', 'ReconciliationMark', 'Period', 'ContributionLimit', 'User',
  'IssuanceKillSwitch', 'Riding',
];

/**
 * Pairs the legacy switch never granted and no route checks, but which a
 * permission now grants alongside a pair that is checked:
 * `contribution.edit` grants update on both Contribution and
 * ContributionMetadata (as administrator and rules_authority had), so the
 * party CFO also gets the unchecked `update Contribution`.
 */
const ALLOWED_GAINS = new Set(['party_cfo:update:Contribution']);

const user = { id: 'u', isCfoDesignate: false, allRidings: true, ridingGrants: [] };

describe('built-in roles', () => {
  it.each(BUILT_IN_ROLES.map((r) => [r.key, r.permissions] as const))(
    '%s grants what the legacy role switch granted',
    (key, permissions) => {
      const now = defineAbilitiesFor({ ...user, permissions });
      // legacy abilities never included the shared reads; layer them on via
      // a permission-less user so the comparison covers only role rules
      const base = defineAbilitiesFor({ ...user, permissions: [] });
      const legacy = legacyAbilities(key);
      const diffs: string[] = [];
      for (const action of ACTIONS) {
        for (const subject of SUBJECTS) {
          const was = legacy.can(action, subject) || base.can(action, subject);
          const is = now.can(action, subject);
          if (was !== is && !ALLOWED_GAINS.has(`${key}:${action}:${subject}`)) {
            diffs.push(`${action} ${subject}: was ${was}, now ${is}`);
          }
        }
      }
      expect(diffs).toEqual([]);
    },
  );

  it('only reference catalogue permissions', () => {
    for (const role of BUILT_IN_ROLES) {
      for (const p of role.permissions) expect(PERMISSION_KEYS).toContain(p);
    }
  });

  it('lock the system administrator role, which holds full access', () => {
    expect(LOCKED_ROLE_KEYS.has('sysadmin')).toBe(true);
    expect(BUILT_IN_ROLES.find((r) => r.key === 'sysadmin')?.permissions).toEqual(['system.manage']);
  });
});

describe('defineAbilitiesFor', () => {
  it('grants nothing for a permission key the catalogue does not have', () => {
    const ability = defineAbilitiesFor({ ...user, permissions: ['receipt.teleport'] });
    expect(ability.can('issue', 'Receipt')).toBe(false);
  });

  it('a custom role with users.administer can manage users but not settings', () => {
    const ability = defineAbilitiesFor({ ...user, permissions: ['users.administer'] });
    expect(ability.can('administer', 'User')).toBe(true);
    expect(ability.can('administer', 'Period')).toBe(false);
  });
});

describe('roleKeyFromName', () => {
  it('slugs a display name', () => {
    expect(roleKeyFromName('Riding Auditor')).toBe('riding_auditor');
    expect(roleKeyFromName('  Trésorier / CFO (East) ')).toBe('tresorier_cfo_east');
    expect(roleKeyFromName('!!!')).toBe('');
  });
});
