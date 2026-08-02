import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  url?: string;
  /** Migrations and one-shot scripts want a single connection, not a pool. */
  max?: number;
}

export function databaseUrl(explicit?: string): string {
  const url = explicit ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Start the local cluster with `scripts/dev-db.sh start` ' +
        'and export the URL it prints.',
    );
  }
  return url;
}

export function createDatabase(opts: CreateDatabaseOptions = {}): {
  db: Database;
  sql: postgres.Sql;
  close: () => Promise<void>;
} {
  const client = postgres(databaseUrl(opts.url), {
    max: opts.max ?? 10,
    // Dates and numerics come back as strings otherwise, which quietly breaks
    // integer cents comparisons.
    transform: { undefined: null },
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  return { db, sql: client, close: () => client.end({ timeout: 5 }) };
}

export { schema };
