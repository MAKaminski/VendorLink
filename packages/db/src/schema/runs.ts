import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  FAILURE_CLASSES,
  REPLY_CLASSIFICATIONS,
  RUN_STATUSES,
  TASK_KINDS,
  TASK_STATUSES,
} from '@vendorlink/core';
import { vendorlink } from './schema';
import { enumColumn, jsonbColumn } from './helpers';
import { tenants } from './tenants';
import { pmChannels, pmCompanies, pmContacts, formSchemas } from './directory';

export const connectionRuns = vendorlink.table(
  'connection_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pmCompanyId: uuid('pm_company_id')
      .notNull()
      .references(() => pmCompanies.id, { onDelete: 'cascade' }),
    initiatedBy: uuid('initiated_by'),
    status: enumColumn('status', RUN_STATUSES).notNull().default('queued'),
    /**
     * sha256(tenant_id|pm_company_id|profile_version). The unique index is
     * what makes five concurrent Connect clicks collapse to one run.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('connection_runs_idempotency_idx').on(t.idempotencyKey),
    index('connection_runs_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('connection_runs_tenant_status_idx').on(t.tenantId, t.status),
  ],
);

export const connectionTasks = vendorlink.table(
  'connection_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => connectionRuns.id, { onDelete: 'cascade' }),
    /** Denormalized so task queries never need a join to scope by tenant. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: enumColumn('kind', TASK_KINDS).notNull(),
    status: enumColumn('status', TASK_STATUSES).notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    failureClass: enumColumn('failure_class', FAILURE_CLASSES),
    resolvedContactId: uuid('resolved_contact_id').references(() => pmContacts.id, {
      onDelete: 'set null',
    }),
    pmChannelId: uuid('pm_channel_id').references(() => pmChannels.id, { onDelete: 'set null' }),
    formSchemaId: uuid('form_schema_id').references(() => formSchemas.id, { onDelete: 'set null' }),
    /** Confidence computed by the §6.3 gate; null for email tasks. */
    runConfidence: doublePrecision('run_confidence'),
    artifactBundleKey: text('artifact_bundle_key'),
    confirmationNumber: text('confirmation_number'),
  },
  (t) => [
    index('connection_tasks_run_idx').on(t.runId),
    index('connection_tasks_tenant_status_idx').on(t.tenantId, t.status),
    index('connection_tasks_retry_idx').on(t.status, t.nextRetryAt),
    /**
     * §6.5: never submit the same form twice for the same tenant. Partial
     * unique index, so only *successful* portal submissions collide — a failed
     * attempt must stay retryable.
     */
    uniqueIndex('connection_tasks_unique_success_idx')
      .on(t.tenantId, t.pmChannelId)
      .where(sql`${t.kind} = 'PORTAL' AND ${t.status} = 'succeeded'`),
  ],
);

/**
 * Append-only. §10 revokes UPDATE and DELETE on this table from the app role
 * and a trigger enforces it, because this is the trace an operator relies on
 * to understand what the automation did.
 */
export const taskEvents = vendorlink.table(
  'task_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => connectionTasks.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    level: text('level').$type<'debug' | 'info' | 'warn' | 'error'>().notNull().default('info'),
    eventType: text('event_type').notNull(),
    message: text('message').notNull(),
    data: jsonbColumn<Record<string, unknown>>('data'),
  },
  (t) => [index('task_events_task_ts_idx').on(t.taskId, t.ts)],
);

/**
 * THE explainability table: exactly what was typed into which field and why.
 * Also append-only. Secret values (EIN, bank details) are stored as a redacted
 * marker plus a reference — never the literal, per §10.
 */
export const portalFieldWrites = vendorlink.table(
  'portal_field_writes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => connectionTasks.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    selector: text('selector').notNull(),
    label: text('label'),
    valueWritten: text('value_written').notNull(),
    /** Path into the canonical profile, e.g. `profile.legal_name`. */
    sourceField: text('source_field'),
    confidence: doublePrecision('confidence').notNull(),
    wasLlmMapped: boolean('was_llm_mapped').notNull().default(false),
    /** True when `valueWritten` is a redaction marker rather than the value. */
    isRedacted: boolean('is_redacted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('portal_field_writes_task_idx').on(t.taskId)],
);

export const emailMessages = vendorlink.table(
  'email_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => connectionTasks.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    providerMessageId: text('provider_message_id'),
    toEmail: text('to_email').notNull(),
    cc: text('cc').array().notNull().default([]),
    subject: text('subject').notNull(),
    bodyHtml: text('body_html').notNull(),
    attachments: jsonbColumn<Array<{ filename: string; bytes: number; documentId?: string }>>(
      'attachments',
    ),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    bounceType: text('bounce_type'),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
  },
  (t) => [
    index('email_messages_tenant_idx').on(t.tenantId),
    index('email_messages_provider_idx').on(t.providerMessageId),
    index('email_messages_task_idx').on(t.taskId),
  ],
);

export const pmReplies = vendorlink.table(
  'pm_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pmCompanyId: uuid('pm_company_id')
      .notNull()
      .references(() => pmCompanies.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => connectionRuns.id, { onDelete: 'set null' }),
    fromEmail: text('from_email').notNull(),
    subject: text('subject'),
    bodyText: text('body_text').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    classification: enumColumn('classification', REPLY_CLASSIFICATIONS).notNull().default('other'),
    extracted: jsonbColumn<Record<string, unknown>>('extracted'),
  },
  (t) => [
    index('pm_replies_tenant_idx').on(t.tenantId, t.receivedAt),
    index('pm_replies_company_idx').on(t.pmCompanyId),
  ],
);

/**
 * Per-tenant daily send counter backing the §5.5 warm-up governor. Kept in the
 * database rather than in memory so the cap holds across worker processes.
 */
export const sendCounters = vendorlink.table(
  'send_counters',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    sent: integer('sent').notNull().default(0),
  },
  (t) => [uniqueIndex('send_counters_tenant_day_idx').on(t.tenantId, t.day)],
);

/**
 * Global politeness ledger: one row per PM domain recording the last run start,
 * enforcing §6.1's "1 run per PM domain per 90 seconds across all tenants".
 */
export const domainThrottle = vendorlink.table('domain_throttle', {
  domain: text('domain').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull(),
  runCount: bigint('run_count', { mode: 'number' }).notNull().default(0),
});

export type ConnectionRunRow = typeof connectionRuns.$inferSelect;
export type NewConnectionRunRow = typeof connectionRuns.$inferInsert;
export type ConnectionTaskRow = typeof connectionTasks.$inferSelect;
export type NewConnectionTaskRow = typeof connectionTasks.$inferInsert;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type NewTaskEventRow = typeof taskEvents.$inferInsert;
export type PortalFieldWriteRow = typeof portalFieldWrites.$inferSelect;
export type NewPortalFieldWriteRow = typeof portalFieldWrites.$inferInsert;
export type EmailMessageRow = typeof emailMessages.$inferSelect;
export type PmReplyRow = typeof pmReplies.$inferSelect;
