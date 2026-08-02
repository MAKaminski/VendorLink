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
 * Each suite gets its own database cloned from a migrated template, so suites
 * are isolated and none of them pay the migration cost. The template is
 * created once per process.
 *
 * This runs against the local cluster from `scripts/dev-db.sh`; hosted
 * Postgres is unreachable from the build container (raw :5432 is blocked), and
 * a real database is non-negotiable here because the isolation guarantees
 * being tested are enforced by Postgres, not by application code.
 */

const TEMPLATE_DB = 'vendorlink_test_template';
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

let templateReady: Promise<void> | null = null;

async function ensureTemplate(): Promise<void> {
  templateReady ??= (async () => {
    try {
      psql('postgres', `DROP DATABASE IF EXISTS ${TEMPLATE_DB}`);
    } catch {
      // A concurrent worker may hold it; the CREATE below will tell us.
    }
    psql('postgres', `CREATE DATABASE ${TEMPLATE_DB}`);
    await runMigrations(adminUrl(TEMPLATE_DB));
  })();
  return templateReady;
}

export interface TestDatabase {
  db: Database;
  url: string;
  name: string;
  close: () => Promise<void>;
}

/** Create a fresh database for one suite. */
export async function createTestDatabase(): Promise<TestDatabase> {
  await ensureTemplate();
  const name = `vl_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  psql('postgres', `CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);

  const url = adminUrl(name);
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
