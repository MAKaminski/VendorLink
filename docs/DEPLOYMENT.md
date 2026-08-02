# Deploying VendorLink

## Required environment variables

Set these on the Vercel project (`vendor-link-web`), for **Production** and
**Preview**. The app reads no defaults for any of them — a missing value is a
loud failure at boot rather than a silent fallback.

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres.gmqarvuurgpqchetmups:<DB-PASSWORD>@aws-0-us-east-1.pooler.supabase.com:6543/postgres` | Use the **pooler** (port 6543), not the direct host. Serverless functions open a connection per invocation and will exhaust a direct Postgres connection limit. |
| `VENDORLINK_ENCRYPTION_KEY` | `UeUYkig6gjdRBO/WKHsKS9P51KuWTrv6KG4VofY60Dk=` | AES-256-GCM key for the EIN and bank columns. Generated for this deployment. **Changing it makes every already-encrypted EIN unreadable**, so store it somewhere durable. |
| `SUPABASE_URL` | `https://gmqarvuurgpqchetmups.supabase.co` | Document storage. |
| `SUPABASE_SERVICE_ROLE_KEY` | *(Supabase dashboard → Project Settings → API)* | Server-side only. Never expose it to the browser; it bypasses row-level security. |
| `SUPABASE_STORAGE_BUCKET` | `vendorlink-documents` | Optional; this is the default. |
| `APP_BASE_URL` | `https://vendor-link-web-sepia.vercel.app` | Used to build opt-out links in outbound email. |

The two values marked as coming from the dashboard are the only ones this
build could not produce: Supabase does not expose a project's database password
or service role key through its API.

## Database

Already provisioned in the existing `supabase-emerald-island` project:

- 26 tables in a dedicated **`vendorlink` schema** — not `public`.
- 50 seeded PM companies (synthetic; see `replace-seed-directory.md`).
- Append-only triggers on `task_events` and `portal_field_writes`.
- A private `vendorlink-documents` storage bucket, 25 MB per object.

### Why a separate schema

That project also hosts several other applications with roughly 29,000 rows of
live data. Installing into `public` would have been wrong twice over:

1. Supabase publishes `public` through PostgREST, so `sessions`, `users` and
   `vendor_profiles` would have become readable with the project's anon key
   unless every table carried its own RLS policy.
2. The original `0001` migration granted a role rights on *all tables in
   `public`*, which would have handed VendorLink's role every other
   application's data.

A schema the Data API does not publish is a stronger guarantee than remembering
to add a policy to every future table. Uninstalling is `DROP SCHEMA vendorlink
CASCADE`.

## What still does not work in production

**The email track.** `Connect` will fail on its email task. The `Mailer`
interface has only a local implementation, which writes `.eml` files to disk —
that cannot work on a read-only serverless filesystem. A Resend implementation
is the remaining work; the `modularequity.com` domain is already verified for
sending.

**The portal track.** Engine #2 needs the Playwright worker, which is not
deployed — see `apps/worker/fly.toml`.

Everything else — signup, login, onboarding, document upload, the PM directory,
PM cards, the resolver trace and the Needs-Attention queue — works once the
variables above are set.
