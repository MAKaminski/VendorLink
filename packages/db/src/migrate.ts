import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

export async function runMigrations(url?: string): Promise<void> {
  const { db, close } = createDatabase({ url, max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

// `tsx src/migrate.ts` from the package script.
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations()
    .then(() => {
      // eslint-disable-next-line no-console
      console.warn('migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('migration failed:', err);
      process.exit(1);
    });
}
