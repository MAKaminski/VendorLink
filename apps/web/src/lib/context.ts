import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthSession, ObjectStore } from '@vendorlink/core';
import { LocalObjectStore } from '@vendorlink/core';
import { createDatabase, repositoriesFor, type Database, type TenantRepositories } from '@vendorlink/db';
import { LocalAuthProvider, SESSION_COOKIE } from './auth';

/**
 * Per-process singletons.
 *
 * Next re-evaluates modules across dev reloads, so the connection pool is
 * pinned to `globalThis` to avoid leaking a pool per reload.
 */
const globalForDb = globalThis as unknown as {
  __vendorlinkDb?: { db: Database; close: () => Promise<void> };
};

export function db(): Database {
  globalForDb.__vendorlinkDb ??= createDatabase();
  return globalForDb.__vendorlinkDb.db;
}

export function objectStore(): ObjectStore {
  // An S3 implementation slots in here when R2/Supabase credentials exist;
  // callers only ever see the ObjectStore interface.
  return new LocalObjectStore();
}

export function authProvider(): LocalAuthProvider {
  return new LocalAuthProvider(db());
}

/** The session for the current request, or null when signed out. */
export async function currentSession(): Promise<AuthSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return authProvider().verifySession(token);
}

export interface RequestContext {
  session: AuthSession;
  repos: TenantRepositories;
}

/**
 * Resolve the session and bind repositories to its tenant.
 *
 * Everything downstream takes `repos` rather than a database handle, so the
 * tenant predicate is already applied and cannot be omitted by a page or a
 * route handler.
 */
export async function requireContext(): Promise<RequestContext> {
  const session = await currentSession();
  if (!session) redirect('/login');
  return { session, repos: repositoriesFor(db(), session.membership.tenantId) };
}

/** API-route variant: returns null instead of redirecting. */
export async function apiContext(): Promise<RequestContext | null> {
  const session = await currentSession();
  if (!session) return null;
  return { session, repos: repositoriesFor(db(), session.membership.tenantId) };
}
