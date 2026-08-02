import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * VendorLink lives in its own Postgres schema, not `public`.
 *
 * Two reasons, both discovered deploying into a shared Supabase project:
 *
 *  1. **Isolation.** A hosted Postgres is frequently shared with other
 *     applications. Owning a schema means our 26 tables can never collide with
 *     theirs, our grants can never reach their data, and uninstalling us is one
 *     `DROP SCHEMA`.
 *
 *  2. **Exposure.** Supabase publishes the `public` schema through PostgREST.
 *     Tables placed there are reachable with the project's anon key unless
 *     every one of them carries RLS. `sessions`, `users` and `vendor_profiles`
 *     must never be reachable that way, and a schema the Data API does not
 *     publish is a stronger guarantee than remembering to add a policy to
 *     every future table.
 *
 * `SCHEMA_NAME` is fixed rather than configurable: the migrations that create
 * it are checked in, so it has to match.
 */
export const SCHEMA_NAME = 'vendorlink';

export const vendorlink = pgSchema(SCHEMA_NAME);
