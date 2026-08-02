# Decisions

Ambiguities resolved during the build, each toward keeping a human able to
intervene. One line of rationale per entry.

| # | Decision | Rationale |
|---|---|---|
| 1 | Auth uses `tenants`/`tenant_members` behind an `AuthProvider` interface rather than Clerk | No Clerk credentials in this environment; the interface keeps the org+role model identical and makes Clerk or Supabase Auth a drop-in adapter. |
| 2 | Object storage is an S3-compatible interface with a local filesystem implementation | No R2 credentials; the S3 API is identical across R2 and Supabase Storage, so the provider is an env-var change rather than a code change. |
| 3 | The LLM interface exposes only schema-constrained JSON, never free-text completion | §5 and §6 both require the model to *choose* among supplied options; removing the free-text method makes "never let the model invent a value" a type-level guarantee. |
| 4 | Completeness score is capped at 79 while any blocking item is missing | A weighted sum reports a vendor with no W-9 as 88% complete, which is arithmetically true and operationally useless — they cannot submit anywhere. |
| 5 | Local Postgres cluster runs as an unprivileged OS user via `scripts/dev-db.sh` | Postgres refuses to run as root and this container has no Docker daemon; the repo needs a real Postgres for migrations and the tenant-isolation suite. |
| 6 | `LocalMailer` reports its sending domain as verified | Keeps the P2 send path exercisable without a provider; the Resend implementation performs the real SPF/DKIM/DMARC check and the send gate reads whichever mailer is configured. |
