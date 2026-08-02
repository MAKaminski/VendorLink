CREATE SCHEMA "vendorlink";
--> statement-breakpoint
CREATE TABLE "vendorlink"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"external_org_id" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sending_domain" text,
	"sending_domain_verified_at" timestamp with time zone,
	"sending_frozen_at" timestamp with time zone,
	"sending_frozen_reason" text,
	"sending_warmup_started_on" text,
	"automation_consent_at" timestamp with time zone,
	"automation_consent_ip" text,
	"automation_consent_version" text,
	"require_first_submission_approval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text,
	"external_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."vendor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"dba" text,
	"entity_type" text,
	"ein_last4" text,
	"ein_encrypted" text,
	"duns" text,
	"website" text,
	"year_founded" integer,
	"employee_count" integer,
	"primary_contact_name" text,
	"primary_contact_title" text,
	"primary_contact_email" text,
	"primary_contact_phone" text,
	"after_hours_phone" text,
	"dispatch_email" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal" text,
	"county" text,
	"hours_of_operation" jsonb,
	"offers_after_hours" boolean DEFAULT false NOT NULL,
	"after_hours_fee_cents" integer,
	"hourly_rate_cents" integer,
	"dispatch_fee_cents" integer,
	"trip_fee_cents" integer,
	"minimum_invoice_cents" integer,
	"warranty_terms" text,
	"payment_terms" text,
	"accepts_ach" boolean DEFAULT false NOT NULL,
	"remit_to_encrypted" text,
	"remit_to" jsonb,
	"w9_signed_date" text,
	"background_check_consent" boolean DEFAULT false NOT NULL,
	"response_time_hours" integer,
	"capability_statement" text,
	"completeness_score" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."document_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"extracted" jsonb NOT NULL,
	"model" text NOT NULL,
	"confidence" double precision,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer,
	"expires_on" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"superseded_by_id" uuid,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."vendor_insurance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_type" text NOT NULL,
	"carrier" text NOT NULL,
	"naic_code" text,
	"policy_number" text NOT NULL,
	"each_occurrence_cents" bigint,
	"aggregate_cents" bigint,
	"effective_on" text,
	"expires_on" text,
	"additional_insured_text" text,
	"waiver_of_subrogation" boolean DEFAULT false NOT NULL,
	"primary_and_noncontributory" boolean DEFAULT false NOT NULL,
	"document_id" uuid,
	"agent_name" text,
	"agent_email" text,
	"agent_phone" text
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."vendor_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"license_type" text NOT NULL,
	"license_number" text NOT NULL,
	"issuing_state" text NOT NULL,
	"issuing_authority" text,
	"issued_on" text,
	"expires_on" text,
	"document_id" uuid
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."vendor_service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"center_lat" double precision,
	"center_lng" double precision,
	"radius_miles" integer,
	"zips" text[] DEFAULT '{}' NOT NULL,
	"counties" text[] DEFAULT '{}' NOT NULL,
	"states" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."vendor_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trade_slug" text NOT NULL,
	"naics_code" text,
	"csi_code" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."form_schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pm_channel_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"fields" jsonb NOT NULL,
	"hash" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."global_contact_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"pm_company_id" uuid,
	"signal" text NOT NULL,
	"source_tenant_id" uuid,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."pm_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pm_company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"platform_slug" text,
	"requires_account" boolean DEFAULT false NOT NULL,
	"requires_payment" boolean DEFAULT false NOT NULL,
	"fee_cents" bigint,
	"captcha_kind" text DEFAULT 'unknown' NOT NULL,
	"auth_kind" text DEFAULT 'none' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."pm_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"website" text,
	"domain" text,
	"hq_city" text,
	"hq_state" text,
	"logo_url" text,
	"portfolio_units" integer,
	"portfolio_type" text[] DEFAULT '{}' NOT NULL,
	"markets" text[] DEFAULT '{}' NOT NULL,
	"crawl_status" text DEFAULT 'pending' NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"source" text DEFAULT 'seed' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"submitted_by_tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."pm_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pm_company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"kind" text DEFAULT 'unknown' NOT NULL,
	"person_name" text,
	"title" text,
	"source_url" text,
	"discovery_method" text,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"score_breakdown" jsonb,
	"mx_valid" boolean,
	"smtp_verified" boolean,
	"last_verified_at" timestamp with time zone,
	"hard_bounced" boolean DEFAULT false NOT NULL,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"is_role_account" boolean DEFAULT false NOT NULL,
	"rank" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."pm_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pm_company_id" uuid NOT NULL,
	"min_gl_each_occurrence_cents" bigint,
	"min_gl_aggregate_cents" bigint,
	"min_auto_cents" bigint,
	"min_umbrella_cents" bigint,
	"requires_wc" boolean DEFAULT false NOT NULL,
	"requires_additional_insured" boolean DEFAULT false NOT NULL,
	"additional_insured_wording" text,
	"requires_w9" boolean DEFAULT false NOT NULL,
	"requires_background_check" boolean DEFAULT false NOT NULL,
	"requires_license" text[] DEFAULT '{}' NOT NULL,
	"source_url" text,
	"extracted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."connection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pm_company_id" uuid NOT NULL,
	"initiated_by" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."connection_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"failure_reason" text,
	"failure_class" text,
	"resolved_contact_id" uuid,
	"pm_channel_id" uuid,
	"form_schema_id" uuid,
	"run_confidence" double precision,
	"artifact_bundle_key" text,
	"confirmation_number" text
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."domain_throttle" (
	"domain" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"run_count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_message_id" text,
	"to_email" text NOT NULL,
	"cc" text[] DEFAULT '{}' NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"attachments" jsonb,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"bounce_type" text,
	"replied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."pm_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pm_company_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid,
	"from_email" text NOT NULL,
	"subject" text,
	"body_text" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"classification" text DEFAULT 'other' NOT NULL,
	"extracted" jsonb
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."portal_field_writes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"selector" text NOT NULL,
	"label" text,
	"value_written" text NOT NULL,
	"source_field" text,
	"confidence" double precision NOT NULL,
	"was_llm_mapped" boolean DEFAULT false NOT NULL,
	"is_redacted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."send_counters" (
	"tenant_id" uuid NOT NULL,
	"day" text NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendorlink"."task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
ALTER TABLE "vendorlink"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vendorlink"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "vendorlink"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."vendor_profiles" ADD CONSTRAINT "vendor_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."document_extractions" ADD CONSTRAINT "document_extractions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."document_extractions" ADD CONSTRAINT "document_extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "vendorlink"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."vendor_insurance" ADD CONSTRAINT "vendor_insurance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."vendor_insurance" ADD CONSTRAINT "vendor_insurance_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "vendorlink"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."vendor_licenses" ADD CONSTRAINT "vendor_licenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."vendor_licenses" ADD CONSTRAINT "vendor_licenses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "vendorlink"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."vendor_service_areas" ADD CONSTRAINT "vendor_service_areas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."vendor_trades" ADD CONSTRAINT "vendor_trades_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."form_schemas" ADD CONSTRAINT "form_schemas_pm_channel_id_pm_channels_id_fk" FOREIGN KEY ("pm_channel_id") REFERENCES "vendorlink"."pm_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."global_contact_signals" ADD CONSTRAINT "global_contact_signals_pm_company_id_pm_companies_id_fk" FOREIGN KEY ("pm_company_id") REFERENCES "vendorlink"."pm_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."global_contact_signals" ADD CONSTRAINT "global_contact_signals_source_tenant_id_tenants_id_fk" FOREIGN KEY ("source_tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."pm_channels" ADD CONSTRAINT "pm_channels_pm_company_id_pm_companies_id_fk" FOREIGN KEY ("pm_company_id") REFERENCES "vendorlink"."pm_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."pm_companies" ADD CONSTRAINT "pm_companies_submitted_by_tenant_id_tenants_id_fk" FOREIGN KEY ("submitted_by_tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."pm_contacts" ADD CONSTRAINT "pm_contacts_pm_company_id_pm_companies_id_fk" FOREIGN KEY ("pm_company_id") REFERENCES "vendorlink"."pm_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."pm_requirements" ADD CONSTRAINT "pm_requirements_pm_company_id_pm_companies_id_fk" FOREIGN KEY ("pm_company_id") REFERENCES "vendorlink"."pm_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."connection_runs" ADD CONSTRAINT "connection_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."connection_runs" ADD CONSTRAINT "connection_runs_pm_company_id_pm_companies_id_fk" FOREIGN KEY ("pm_company_id") REFERENCES "vendorlink"."pm_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."connection_tasks" ADD CONSTRAINT "connection_tasks_run_id_connection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "vendorlink"."connection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."connection_tasks" ADD CONSTRAINT "connection_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."connection_tasks" ADD CONSTRAINT "connection_tasks_resolved_contact_id_pm_contacts_id_fk" FOREIGN KEY ("resolved_contact_id") REFERENCES "vendorlink"."pm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."connection_tasks" ADD CONSTRAINT "connection_tasks_pm_channel_id_pm_channels_id_fk" FOREIGN KEY ("pm_channel_id") REFERENCES "vendorlink"."pm_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."connection_tasks" ADD CONSTRAINT "connection_tasks_form_schema_id_form_schemas_id_fk" FOREIGN KEY ("form_schema_id") REFERENCES "vendorlink"."form_schemas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."email_messages" ADD CONSTRAINT "email_messages_task_id_connection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "vendorlink"."connection_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."email_messages" ADD CONSTRAINT "email_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."pm_replies" ADD CONSTRAINT "pm_replies_pm_company_id_pm_companies_id_fk" FOREIGN KEY ("pm_company_id") REFERENCES "vendorlink"."pm_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."pm_replies" ADD CONSTRAINT "pm_replies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."pm_replies" ADD CONSTRAINT "pm_replies_run_id_connection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "vendorlink"."connection_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."portal_field_writes" ADD CONSTRAINT "portal_field_writes_task_id_connection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "vendorlink"."connection_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."portal_field_writes" ADD CONSTRAINT "portal_field_writes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."send_counters" ADD CONSTRAINT "send_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."task_events" ADD CONSTRAINT "task_events_task_id_connection_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "vendorlink"."connection_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendorlink"."task_events" ADD CONSTRAINT "task_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "vendorlink"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "vendorlink"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "vendorlink"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_members_tenant_user_idx" ON "vendorlink"."tenant_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_members_user_idx" ON "vendorlink"."tenant_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_external_org_id_idx" ON "vendorlink"."tenants" USING btree ("external_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "vendorlink"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_profiles_tenant_idx" ON "vendorlink"."vendor_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_extractions_tenant_doc_idx" ON "vendorlink"."document_extractions" USING btree ("tenant_id","document_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_kind_idx" ON "vendorlink"."documents" USING btree ("tenant_id","kind","is_current");--> statement-breakpoint
CREATE INDEX "documents_tenant_expiry_idx" ON "vendorlink"."documents" USING btree ("tenant_id","expires_on");--> statement-breakpoint
CREATE INDEX "vendor_insurance_tenant_type_idx" ON "vendorlink"."vendor_insurance" USING btree ("tenant_id","policy_type");--> statement-breakpoint
CREATE INDEX "vendor_insurance_tenant_expiry_idx" ON "vendorlink"."vendor_insurance" USING btree ("tenant_id","expires_on");--> statement-breakpoint
CREATE INDEX "vendor_licenses_tenant_expiry_idx" ON "vendorlink"."vendor_licenses" USING btree ("tenant_id","expires_on");--> statement-breakpoint
CREATE INDEX "vendor_service_areas_tenant_idx" ON "vendorlink"."vendor_service_areas" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vendor_trades_tenant_idx" ON "vendorlink"."vendor_trades" USING btree ("tenant_id","trade_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "form_schemas_channel_version_idx" ON "vendorlink"."form_schemas" USING btree ("pm_channel_id","version");--> statement-breakpoint
CREATE INDEX "form_schemas_channel_active_idx" ON "vendorlink"."form_schemas" USING btree ("pm_channel_id","is_active");--> statement-breakpoint
CREATE INDEX "global_contact_signals_email_idx" ON "vendorlink"."global_contact_signals" USING btree ("email","signal");--> statement-breakpoint
CREATE INDEX "pm_channels_company_idx" ON "vendorlink"."pm_channels" USING btree ("pm_company_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_channels_company_url_idx" ON "vendorlink"."pm_channels" USING btree ("pm_company_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_companies_domain_idx" ON "vendorlink"."pm_companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "pm_companies_state_idx" ON "vendorlink"."pm_companies" USING btree ("hq_state");--> statement-breakpoint
CREATE INDEX "pm_companies_crawl_idx" ON "vendorlink"."pm_companies" USING btree ("crawl_status","last_crawled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_contacts_company_email_idx" ON "vendorlink"."pm_contacts" USING btree ("pm_company_id","email");--> statement-breakpoint
CREATE INDEX "pm_contacts_company_rank_idx" ON "vendorlink"."pm_contacts" USING btree ("pm_company_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_requirements_company_idx" ON "vendorlink"."pm_requirements" USING btree ("pm_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_runs_idempotency_idx" ON "vendorlink"."connection_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "connection_runs_tenant_created_idx" ON "vendorlink"."connection_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "connection_runs_tenant_status_idx" ON "vendorlink"."connection_runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "connection_tasks_run_idx" ON "vendorlink"."connection_tasks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "connection_tasks_tenant_status_idx" ON "vendorlink"."connection_tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "connection_tasks_retry_idx" ON "vendorlink"."connection_tasks" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_tasks_unique_success_idx" ON "vendorlink"."connection_tasks" USING btree ("tenant_id","pm_channel_id") WHERE "vendorlink"."connection_tasks"."kind" = 'PORTAL' AND "vendorlink"."connection_tasks"."status" = 'succeeded';--> statement-breakpoint
CREATE INDEX "email_messages_tenant_idx" ON "vendorlink"."email_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_messages_provider_idx" ON "vendorlink"."email_messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "email_messages_task_idx" ON "vendorlink"."email_messages" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "pm_replies_tenant_idx" ON "vendorlink"."pm_replies" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "pm_replies_company_idx" ON "vendorlink"."pm_replies" USING btree ("pm_company_id");--> statement-breakpoint
CREATE INDEX "portal_field_writes_task_idx" ON "vendorlink"."portal_field_writes" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "send_counters_tenant_day_idx" ON "vendorlink"."send_counters" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE INDEX "task_events_task_ts_idx" ON "vendorlink"."task_events" USING btree ("task_id","ts");