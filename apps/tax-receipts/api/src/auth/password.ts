import bcrypt from 'bcryptjs';

/**
 * Password hashing (ticket 0.5). bcryptjs is the pure-JS implementation of
 * bcrypt (D1 names "bcrypt"); no native build, which keeps CI simple.
 */
const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 12) {
    throw new Error('password must be at least 12 characters');
  }
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
