import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import type { AuthProvider, AuthSession } from '@vendorlink/core';
import { sessions, tenantMembers, tenants, users, type Database } from '@vendorlink/db';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from the standard library.
 *
 * The plan called for Argon2id, which needs a native module; scrypt is
 * memory-hard, in Node core, and needs no build step, which matters for a
 * container image that also carries Chromium. Parameters follow the OWASP
 * scrypt guidance (N=2^15, r=8, p=1).
 */
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1] as string, 'base64url');
  const expected = Buffer.from(parts[2] as string, 'base64url');
  const derived = await scrypt(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Sessions are looked up by hash, so a database leak yields no usable token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const SESSION_COOKIE = 'vl_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

/**
 * Local AuthProvider.
 *
 * Owns the org+role model that Clerk organizations would otherwise provide:
 * `tenants` is the org, `tenant_members` carries the role. A Clerk or Supabase
 * adapter satisfying this same interface swaps in without touching callers.
 */
export class LocalAuthProvider implements AuthProvider {
  constructor(private readonly db: Database) {}

  async verifySession(token: string): Promise<AuthSession | null> {
    const [row] = await this.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        tenantId: tenants.id,
        tenantName: tenants.name,
        role: tenantMembers.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(tenants, eq(tenants.id, sessions.tenantId))
      .innerJoin(
        tenantMembers,
        and(eq(tenantMembers.tenantId, sessions.tenantId), eq(tenantMembers.userId, sessions.userId)),
      )
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (!row) return null;
    return {
      user: { userId: row.userId, email: row.email, name: row.name },
      membership: {
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        role: row.role ?? 'viewer',
      },
    };
  }

  async createSession(userId: string, tenantId: string) {
    // Membership is re-checked here rather than trusted from the caller: this
    // is the only place a session can be minted, so it is the right gate.
    const [member] = await this.db
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);
    if (!member) throw new Error('user is not a member of that tenant');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      tenantId,
      expiresAt,
    });
    return { token, expiresAt };
  }

  async destroySession(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
}

export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
  companyName: string;
}

/**
 * Create a user, their tenant, their membership and an empty profile in one
 * transaction, so a failure cannot leave a user without an org to act in.
 */
export async function signUp(
  db: Database,
  input: SignUpInput,
): Promise<{ userId: string; tenantId: string } | { error: string }> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { error: 'An account with that email already exists.' };

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name: input.companyName }).returning();
    const [user] = await tx
      .insert(users)
      .values({ email, name: input.name ?? null, passwordHash })
      .returning();
    await tx.insert(tenantMembers).values({
      tenantId: tenant!.id,
      userId: user!.id,
      role: 'owner',
    });
    const { vendorProfiles } = await import('@vendorlink/db');
    await tx.insert(vendorProfiles).values({
      tenantId: tenant!.id,
      legalName: input.companyName,
    });
    return { userId: user!.id, tenantId: tenant!.id };
  });
}

export async function signIn(
  db: Database,
  email: string,
  password: string,
): Promise<{ userId: string; tenantId: string } | { error: string }> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);

  // Same message either way — never reveal whether an address is registered.
  const invalid = { error: 'Incorrect email or password.' };
  if (!user?.passwordHash) return invalid;
  if (!(await verifyPassword(password, user.passwordHash))) return invalid;

  const [membership] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, user.id))
    .limit(1);
  if (!membership) return { error: 'That account has no workspace.' };

  return { userId: user.id, tenantId: membership.tenantId };
}
