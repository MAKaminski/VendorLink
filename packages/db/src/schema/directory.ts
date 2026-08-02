import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AUTH_KINDS,
  CAPTCHA_KINDS,
  CHANNEL_KINDS,
  CONTACT_KINDS,
  PLATFORM_SLUGS,
  US_STATES,
} from '@vendorlink/core';
import { enumColumn, jsonbColumn } from './helpers';
import { tenants } from './tenants';

/**
 * The PM directory is global rather than tenant-scoped, deliberately: §5.3's
 * cross-tenant learning is the compounding effect. One tenant's bounce
 * suppresses an address for everyone; one tenant's confirmed reply boosts it
 * for everyone.
 */
export const pmCompanies = pgTable(
  'pm_companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    website: text('website'),
    /** Apex domain, used for dedupe and for the +10 same-domain modifier. */
    domain: text('domain'),
    hqCity: text('hq_city'),
    hqState: enumColumn('hq_state', US_STATES),
    logoUrl: text('logo_url'),
    portfolioUnits: integer('portfolio_units'),
    portfolioType: text('portfolio_type').array().notNull().default([]),
    markets: text('markets').array().notNull().default([]),

    crawlStatus: text('crawl_status').notNull().default('pending'),
    lastCrawledAt: timestamp('last_crawled_at', { withTimezone: true }),
    source: text('source').notNull().default('seed'),
    /** User-submitted companies stay out of the global list until reviewed. */
    verified: boolean('verified').notNull().default(false),
    submittedByTenantId: uuid('submitted_by_tenant_id').references(() => tenants.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pm_companies_domain_idx').on(t.domain),
    index('pm_companies_state_idx').on(t.hqState),
    index('pm_companies_crawl_idx').on(t.crawlStatus, t.lastCrawledAt),
  ],
);

/**
 * The output table of Engine #1. Always multiple ranked candidates per
 * company, never a single address, so the UI can offer "not right? choose
 * another" without re-running discovery.
 */
export const pmContacts = pgTable(
  'pm_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pmCompanyId: uuid('pm_company_id')
      .notNull()
      .references(() => pmCompanies.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    kind: enumColumn('kind', CONTACT_KINDS).notNull().default('unknown'),
    personName: text('person_name'),
    title: text('title'),
    sourceUrl: text('source_url'),
    discoveryMethod: text('discovery_method'),
    /** 0.00–1.00, the clamped score over 100. */
    confidence: doublePrecision('confidence').notNull().default(0),
    score: integer('score').notNull().default(0),
    /** Why it scored what it scored — rendered in the trace drawer. */
    scoreBreakdown: jsonbColumn<Array<{ reason: string; delta: number }>>('score_breakdown'),

    mxValid: boolean('mx_valid'),
    smtpVerified: boolean('smtp_verified'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    hardBounced: boolean('hard_bounced').notNull().default(false),
    bounceCount: integer('bounce_count').notNull().default(0),
    isRoleAccount: boolean('is_role_account').notNull().default(false),
    rank: integer('rank').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pm_contacts_company_email_idx').on(t.pmCompanyId, t.email),
    index('pm_contacts_company_rank_idx').on(t.pmCompanyId, t.rank),
  ],
);

export const pmChannels = pgTable(
  'pm_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pmCompanyId: uuid('pm_company_id')
      .notNull()
      .references(() => pmCompanies.id, { onDelete: 'cascade' }),
    kind: enumColumn('kind', CHANNEL_KINDS).notNull(),
    url: text('url'),
    platformSlug: enumColumn('platform_slug', PLATFORM_SLUGS),
    requiresAccount: boolean('requires_account').notNull().default(false),
    requiresPayment: boolean('requires_payment').notNull().default(false),
    /** Shown to the vendor before they click — surprise fees churn users. */
    feeCents: bigint('fee_cents', { mode: 'number' }),
    captchaKind: enumColumn('captcha_kind', CAPTCHA_KINDS).notNull().default('unknown'),
    authKind: enumColumn('auth_kind', AUTH_KINDS).notNull().default('none'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pm_channels_company_idx').on(t.pmCompanyId, t.kind),
    uniqueIndex('pm_channels_company_url_idx').on(t.pmCompanyId, t.url),
  ],
);

/** Drives the §7.1 fit banner: the gap check that prevents a wasted send. */
export const pmRequirements = pgTable(
  'pm_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pmCompanyId: uuid('pm_company_id')
      .notNull()
      .references(() => pmCompanies.id, { onDelete: 'cascade' }),
    minGlEachOccurrenceCents: bigint('min_gl_each_occurrence_cents', { mode: 'number' }),
    minGlAggregateCents: bigint('min_gl_aggregate_cents', { mode: 'number' }),
    minAutoCents: bigint('min_auto_cents', { mode: 'number' }),
    minUmbrellaCents: bigint('min_umbrella_cents', { mode: 'number' }),
    requiresWc: boolean('requires_wc').notNull().default(false),
    requiresAdditionalInsured: boolean('requires_additional_insured').notNull().default(false),
    additionalInsuredWording: text('additional_insured_wording'),
    requiresW9: boolean('requires_w9').notNull().default(false),
    requiresBackgroundCheck: boolean('requires_background_check').notNull().default(false),
    requiresLicense: text('requires_license').array().notNull().default([]),
    sourceUrl: text('source_url'),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('pm_requirements_company_idx').on(t.pmCompanyId)],
);

/**
 * The data moat. The first tenant to hit a form pays the discovery cost; every
 * later tenant replays a known-good schema in seconds. Versioned, and
 * invalidated when the DOM hash stops matching.
 */
export const formSchemas = pgTable(
  'form_schemas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pmChannelId: uuid('pm_channel_id')
      .notNull()
      .references(() => pmChannels.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    fields: jsonbColumn<unknown[]>('fields').notNull(),
    /** Hash of the form's DOM shape; a mismatch retires this version. */
    hash: text('hash').notNull(),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('form_schemas_channel_version_idx').on(t.pmChannelId, t.version),
    index('form_schemas_channel_active_idx').on(t.pmChannelId, t.isActive),
  ],
);

/**
 * Cross-tenant signal ledger. Every terminal email event writes one of these,
 * and the resolver folds them back into scoring — this is where "every
 * tenant's activity improves the directory for all tenants" actually happens.
 */
export const globalContactSignals = pgTable(
  'global_contact_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    pmCompanyId: uuid('pm_company_id').references(() => pmCompanies.id, { onDelete: 'cascade' }),
    signal: text('signal')
      .$type<'hard_bounce' | 'complaint' | 'confirmed' | 'wrong_department' | 'unsubscribe'>()
      .notNull(),
    /** Which tenant produced it, for audit; scoring ignores the tenant. */
    sourceTenantId: uuid('source_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('global_contact_signals_email_idx').on(t.email, t.signal)],
);

/** Global suppression list. A hard bounce anywhere stops sending everywhere. */
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    email: text('email').primaryKey(),
    reason: text('reason').$type<'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual'>().notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type PmCompanyRow = typeof pmCompanies.$inferSelect;
export type NewPmCompanyRow = typeof pmCompanies.$inferInsert;
export type PmContactRow = typeof pmContacts.$inferSelect;
export type NewPmContactRow = typeof pmContacts.$inferInsert;
export type PmChannelRow = typeof pmChannels.$inferSelect;
export type NewPmChannelRow = typeof pmChannels.$inferInsert;
export type PmRequirementsRow = typeof pmRequirements.$inferSelect;
export type FormSchemaRow = typeof formSchemas.$inferSelect;
export type GlobalContactSignalRow = typeof globalContactSignals.$inferSelect;
export type EmailSuppressionRow = typeof emailSuppressions.$inferSelect;
