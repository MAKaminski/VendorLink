-- Append-only enforcement for the audit tables (§10).
--
-- `task_events` and `portal_field_writes` are the record of what the
-- automation actually did. An operator has to be able to trust that the trace
-- they are reading was not edited after the fact, so UPDATE and DELETE are
-- blocked at the database rather than by convention in the repository layer.
--
-- Two mechanisms, deliberately:
--
--   1. A trigger, which fires for every role including superusers. This is the
--      one that actually holds in development, where the app connects as
--      `postgres` and a REVOKE would be ignored.
--   2. A REVOKE on the `vendorlink_app` role, which is how production runs.
--      Defence in depth: if the trigger were ever dropped, the grant still
--      denies the write.

CREATE OR REPLACE FUNCTION vendorlink_deny_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'table %.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER task_events_append_only
  BEFORE UPDATE OR DELETE ON task_events
  FOR EACH ROW EXECUTE FUNCTION vendorlink_deny_mutation();
--> statement-breakpoint

CREATE TRIGGER portal_field_writes_append_only
  BEFORE UPDATE OR DELETE ON portal_field_writes
  FOR EACH ROW EXECUTE FUNCTION vendorlink_deny_mutation();
--> statement-breakpoint

-- The application role. Created here so a fresh database is deployable without
-- an out-of-band setup step; NOLOGIN because credentials are granted per
-- environment rather than baked into a migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vendorlink_app') THEN
    CREATE ROLE vendorlink_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO vendorlink_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vendorlink_app;
--> statement-breakpoint

-- ...except the audit tables, which are insert-and-read only.
REVOKE UPDATE, DELETE ON task_events FROM vendorlink_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON portal_field_writes FROM vendorlink_app;
