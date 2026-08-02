import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  DOCUMENT_KINDS,
  POLICY_TYPES,
  SERVICE_AREA_KINDS,
  TRADE_SLUGS,
  US_STATES,
} from '@vendorlink/core';
import { enumColumn, jsonbColumn } from './helpers';
import { tenants } from './tenants';

export const vendorTrades = pgTable(
  'vendor_trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tradeSlug: enumColumn('trade_slug', TRADE_SLUGS).notNull(),
    naicsCode: text('naics_code'),
    csiCode: text('csi_code'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [index('vendor_trades_tenant_idx').on(t.tenantId, t.tradeSlug)],
);

export const vendorServiceAreas = pgTable(
  'vendor_service_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: enumColumn('kind', SERVICE_AREA_KINDS).notNull(),
    centerLat: doublePrecision('center_lat'),
    centerLng: doublePrecision('center_lng'),
    radiusMiles: integer('radius_miles'),
    zips: text('zips').array().notNull().default([]),
    counties: text('counties').array().notNull().default([]),
    states: text('states').array().notNull().default([]),
  },
  (t) => [index('vendor_service_areas_tenant_idx').on(t.tenantId)],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: enumColumn('kind', DOCUMENT_KINDS).notNull(),
    label: text('label').notNull(),
    /** Object-store key. Named for R2 per §4.1; the store is pluggable. */
    r2Key: text('r2_key').notNull(),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    pageCount: integer('page_count'),
    expiresOn: text('expires_on'),
    isCurrent: boolean('is_current').notNull().default(true),
    supersededById: uuid('superseded_by_id'),
    uploadedBy: uuid('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_tenant_kind_idx').on(t.tenantId, t.kind, t.isCurrent),
    index('documents_tenant_expiry_idx').on(t.tenantId, t.expiresOn),
  ],
);

export const vendorLicenses = pgTable(
  'vendor_licenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    licenseType: text('license_type').notNull(),
    licenseNumber: text('license_number').notNull(),
    issuingState: enumColumn('issuing_state', US_STATES).notNull(),
    issuingAuthority: text('issuing_authority'),
    issuedOn: text('issued_on'),
    expiresOn: text('expires_on'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  },
  (t) => [index('vendor_licenses_tenant_expiry_idx').on(t.tenantId, t.expiresOn)],
);

/**
 * Insurance limits are integers so §7.1's fit banner can machine-compare them
 * against each PM's stated minimums and warn *before* a submission is wasted.
 */
export const vendorInsurance = pgTable(
  'vendor_insurance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    policyType: enumColumn('policy_type', POLICY_TYPES).notNull(),
    carrier: text('carrier').notNull(),
    naicCode: text('naic_code'),
    policyNumber: text('policy_number').notNull(),
    eachOccurrenceCents: bigint('each_occurrence_cents', { mode: 'number' }),
    aggregateCents: bigint('aggregate_cents', { mode: 'number' }),
    effectiveOn: text('effective_on'),
    expiresOn: text('expires_on'),
    additionalInsuredText: text('additional_insured_text'),
    waiverOfSubrogation: boolean('waiver_of_subrogation').notNull().default(false),
    primaryAndNoncontributory: boolean('primary_and_noncontributory').notNull().default(false),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    agentName: text('agent_name'),
    agentEmail: text('agent_email'),
    agentPhone: text('agent_phone'),
  },
  (t) => [
    index('vendor_insurance_tenant_type_idx').on(t.tenantId, t.policyType),
    index('vendor_insurance_tenant_expiry_idx').on(t.tenantId, t.expiresOn),
  ],
);

/**
 * Claude's reading of an uploaded COI/W-9. Never written straight to the
 * profile: §4.1 requires human confirmation, so `confirmedAt` gates promotion.
 */
export const documentExtractions = pgTable(
  'document_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    extracted: jsonbColumn<Record<string, unknown>>('extracted').notNull(),
    model: text('model').notNull(),
    confidence: doublePrecision('confidence'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('document_extractions_tenant_doc_idx').on(t.tenantId, t.documentId)],
);

export type VendorTradeRow = typeof vendorTrades.$inferSelect;
export type VendorServiceAreaRow = typeof vendorServiceAreas.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type VendorLicenseRow = typeof vendorLicenses.$inferSelect;
export type VendorInsuranceRow = typeof vendorInsurance.$inferSelect;
export type DocumentExtractionRow = typeof documentExtractions.$inferSelect;
