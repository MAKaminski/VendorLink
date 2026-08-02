import { sql } from 'drizzle-orm';
import { createDatabase } from '../src/client';
import { pmCompanies } from '../src/schema/index';
import { SEED_PM_COMPANIES } from './pm-companies.seed';

/**
 * Load the seed directory.
 *
 * Idempotent: re-running updates the existing rows rather than duplicating
 * them, keyed on the unique domain.
 */
export async function seedDirectory(url?: string): Promise<{ inserted: number }> {
  const { db, close } = createDatabase({ url, max: 1 });
  const fixturesBase = process.env.FIXTURES_BASE_URL ?? null;

  try {
    const values = SEED_PM_COMPANIES.map((c) => ({
      name: c.name,
      domain: c.domain,
      // Point at the fixture server when one is configured, so the full
      // Connect flow is demonstrable without contacting a real site.
      website:
        fixturesBase && c.websitePath
          ? `${fixturesBase.replace(/\/$/, '')}/${c.websitePath}`
          : `https://${c.domain}`,
      hqCity: c.hqCity,
      hqState: c.hqState as never,
      portfolioUnits: c.portfolioUnits,
      portfolioType: c.portfolioType,
      markets: c.markets,
      source: 'seed',
      verified: false,
      crawlStatus: 'pending',
    }));

    await db
      .insert(pmCompanies)
      .values(values)
      .onConflictDoUpdate({
        target: pmCompanies.domain,
        set: {
          name: sql`excluded.name`,
          website: sql`excluded.website`,
          hqCity: sql`excluded.hq_city`,
          hqState: sql`excluded.hq_state`,
          portfolioUnits: sql`excluded.portfolio_units`,
          portfolioType: sql`excluded.portfolio_type`,
          markets: sql`excluded.markets`,
        },
      });

    return { inserted: values.length };
  } finally {
    await close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('run.ts')) {
  seedDirectory()
    .then(({ inserted }) => {
      // eslint-disable-next-line no-console
      console.warn(`seeded ${inserted} PM companies (source=seed, verified=false)`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('seed failed:', err);
      process.exit(1);
    });
}
