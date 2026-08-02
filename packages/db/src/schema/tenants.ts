import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ENTITY_TYPES, TENANT_ROLES, US_STATES } from '@vendorlink/core';
import { enumColumn, jsonbColumn } from './helpers';
import type { HoursOfOperation, RemitTo } from '@vendorlink/core';

/**
 * Tenant = one service company. Every tenant-owned table below carries
 * `tenant_id` and is only ever reached through the repository layer, which
 * makes the scoping predicate impossible to forget.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Reserved for a Clerk/Supabase org id once an external IdP is wired. */
    externalOrgId: text('external_org_id'),
    plan: text('plan').notNull().default('free'),
    status: text('status').notNull().default('active'),

    /** Verified sending domain; §5.5 blocks sending until this is verified. */
    sendingDomain: text('sending_domain'),
    sendingDomainVerifiedAt: timestamp('sending_domain_verified_at', { withTimezone: true }),
    /** Set when a spam complaint freezes the tenant pending review. */
    sendingFrozenAt: timestamp('sending_frozen_at', { withTimezone: true }),
    sendingFrozenReason: text('sending_frozen_reason'),
    /** Anchors the §5.5 warm-up ramp (25/day, then 75, then 200). */
    sendingWarmupStartedOn: text('sending_warmup_started_on'),

    /** §10 consent record for automated submission on the tenant's behalf. */
    automationConsentAt: timestamp('automation_consent_at', { withTimezone: true }),
    automationConsentIp: text('automation_consent_ip'),
    automationConsentVersion: text('automation_consent_version'),

    /** §6.3 dry-run gate: require approval before a first-ever submission. */
    requireFirstSubmissionApproval: boolean('require_first_submission_approval')
      .notNull()
      .default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenants_external_org_id_idx').on(t.externalOrgId)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    /** Argon2id; null when the user authenticates through an external IdP. */
    passwordHash: text('password_hash'),
    externalUserId: text('external_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

/** Membership carries the role; this is the model Clerk orgs would provide. */
export const tenantMembers = pgTable(
  'tenant_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: enumColumn('role', TENANT_ROLES).notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenant_members_tenant_user_idx').on(t.tenantId, t.userId),
    index('tenant_members_user_idx').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the cookie value; the raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const vendorProfiles = pgTable(
  'vendor_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    legalName: text('legal_name').notNull(),
    dba: text('dba'),
    entityType: enumColumn('entity_type', ENTITY_TYPES),
    /** §10: encrypted at the column level; only the last four sit in clear. */
    einLast4: text('ein_last4'),
    einEncrypted: text('ein_encrypted'),
    duns: text('duns'),
    website: text('website'),
    yearFounded: integer('year_founded'),
    employeeCount: integer('employee_count'),

    primaryContactName: text('primary_contact_name'),
    primaryContactTitle: text('primary_contact_title'),
    primaryContactEmail: text('primary_contact_email'),
    primaryContactPhone: text('primary_contact_phone'),
    afterHoursPhone: text('after_hours_phone'),
    dispatchEmail: text('dispatch_email'),

    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: enumColumn('state', US_STATES),
    postal: text('postal'),
    county: text('county'),

    hoursOfOperation: jsonbColumn<HoursOfOperation>('hours_of_operation'),
    offersAfterHours: boolean('offers_after_hours').notNull().default(false),
    afterHoursFeeCents: integer('after_hours_fee_cents'),

    hourlyRateCents: integer('hourly_rate_cents'),
    dispatchFeeCents: integer('dispatch_fee_cents'),
    tripFeeCents: integer('trip_fee_cents'),
    minimumInvoiceCents: integer('minimum_invoice_cents'),

    warrantyTerms: text('warranty_terms'),
    paymentTerms: text('payment_terms'),
    acceptsAch: boolean('accepts_ach').notNull().default(false),
    /** Encrypted alongside the EIN — bank details are §10 secrets. */
    remitToEncrypted: text('remit_to_encrypted'),
    remitTo: jsonbColumn<Omit<RemitTo, 'payee_name'> & { payee_name: string }>('remit_to'),

    w9SignedDate: text('w9_signed_date'),
    backgroundCheckConsent: boolean('background_check_consent').notNull().default(false),

    responseTimeHours: integer('response_time_hours'),
    capabilityStatement: text('capability_statement'),

    completenessScore: integer('completeness_score').notNull().default(0),

    /** Bumped on every profile write; feeds the run idempotency key. */
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vendor_profiles_tenant_idx').on(t.tenantId)],
);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type TenantMember = typeof tenantMembers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type VendorProfileRow = typeof vendorProfiles.$inferSelect;
export type NewVendorProfileRow = typeof vendorProfiles.$inferInsert;
