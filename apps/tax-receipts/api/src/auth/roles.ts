import type { Prisma, PrismaClient } from '../generated/prisma/index.js';
import { BUILT_IN_ROLES } from './permissions.js';

/**
 * Create any built-in role that is missing (BUILT_IN_ROLES). An existing
 * row is left as an administrator last saved it. The `role_table` migration
 * seeds these on an existing database; this covers a freshly truncated one
 * (the dev seed and the test reset).
 */
export async function ensureBuiltInRoles(prisma: PrismaClient | Prisma.TransactionClient): Promise<void> {
  for (const role of BUILT_IN_ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        builtIn: true,
        permissions: { create: role.permissions.map((permission) => ({ permission })) },
      },
      update: {},
    });
  }
}

/** The immutable key for a new role: "Riding Auditor" -> "riding_auditor". */
export function roleKeyFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** `include` for a user row that needs its role's permissions. */
export const withRolePermissions = {
  role: { include: { permissions: { select: { permission: true } } } },
} as const satisfies Prisma.UserInclude;
