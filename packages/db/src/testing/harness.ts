import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDatabase, type Database } from '../client';
import { runMigrations } from '../migrate';
import { tenants, users, tenantMembers, vendorProfiles } from '../schema/index';

/**
 * Test database harness.
 *
 * Each suite gets its own freshly-migrated database, so suites are isolated
 * and can run in any order.
 *
 * This runs against the local cluster from `scripts/dev-db.sh`; hosted
 * Postgres is unreachable from the build container (raw :5432 is blocked), and
 * a real database is non-negotiable here because the isolation guarantees
 * being tested are enforced by Postgres, not by application code.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function adminUrl(database: string): string {
  const base = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55432/vendorlink';
  return base.replace(/\/[^/]*$/, `/${database}`);
}

function psql(database: string, statement: string): void {
  const url = new URL(adminUrl(database));
  execFileSync(
    process.env.PGBIN ? join(process.env.PGBIN, 'psql') : 'psql',
    [
      '-h', url.hostname,
      '-p', url.port || '5432',
      '-U', url.username || 'postgres',
      '-d', database,
      '-v', 'ON_ERROR_STOP=1',
      '-q',
      '-c', statement,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

export interface TestDatabase {
  db: Database;
  url: string;
  name: string;
  close: () => Promise<void>;
}

/**
 * Create a fresh database for one suite and migrate it.
 *
 * An earlier version cloned a shared migrated template, which is faster but
 * needs cross-process coordination: Vitest runs projects in parallel, and two
 * workers racing to build the same template collide on `CREATE DATABASE`.
 * Migrating each database directly costs a few hundred milliseconds and needs
 * no coordination at all, which is the better trade for a suite this size.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `vl_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  psql('postgres', `CREATE DATABASE ${name}`);

  const url = adminUrl(name);
  await runMigrations(url);
  const { db, close } = createDatabase({ url, max: 4 });

  return {
    db,
    url,
    name,
    close: async () => {
      await close();
      try {
        psql('postgres', `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } catch {
        // Leaving a stray test database behind is not worth failing a run.
      }
    },
  };
}

export interface SeededTenant {
  tenantId: string;
  userId: string;
  profileId: string;
}

/** Create a tenant with an owner and an empty profile. */
export async function seedTenant(
  db: Database,
  opts: { name?: string; email?: string; legalName?: string } = {},
): Promise<SeededTenant> {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await db
    .insert(tenants)
    .values({ name: opts.name ?? `Test Tenant ${suffix}` })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ email: opts.email ?? `owner-${suffix}@example.test`, name: 'Test Owner' })
    .returning();
  await db
    .insert(tenantMembers)
    .values({ tenantId: tenant!.id, userId: user!.id, role: 'owner' });
  const [profile] = await db
    .insert(vendorProfiles)
    .values({ tenantId: tenant!.id, legalName: opts.legalName ?? `Test Vendor ${suffix} LLC` })
    .returning();

  return { tenantId: tenant!.id, userId: user!.id, profileId: profile!.id };
}

export { repoRoot };
