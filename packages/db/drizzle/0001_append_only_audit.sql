-- Append-only enforcement for the audit tables (§10).
--
-- `task_events` and `portal_field_writes` are the record of what the
-- automation actually did. An operator has to be able to trust that the trace
-- they are reading was not edited after the fact, so UPDATE and DELETE are
-- blocked at the database rather than by convention in the repository layer.
--
-- The trigger is the enforcement that always holds: it fires for every role,
-- including superusers and the `postgres` role a managed Postgres connects as,
-- where a REVOKE would simply be ignored.
--
-- An earlier version of this migration also created a `vendorlink_app` role
-- and granted it rights on ALL TABLES IN SCHEMA public. That is actively
-- dangerous on a shared database — it hands our role every other application's
-- data — and it is unnecessary now that VendorLink owns its own schema. Grants
-- are the deploying operator's decision and are scoped to `vendorlink`.

CREATE OR REPLACE FUNCTION vendorlink.deny_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'table %.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER task_events_append_only
  BEFORE UPDATE OR DELETE ON vendorlink.task_events
  FOR EACH ROW EXECUTE FUNCTION vendorlink.deny_mutation();
--> statement-breakpoint

CREATE TRIGGER portal_field_writes_append_only
  BEFORE UPDATE OR DELETE ON vendorlink.portal_field_writes
  FOR EACH ROW EXECUTE FUNCTION vendorlink.deny_mutation();
