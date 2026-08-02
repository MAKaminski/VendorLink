import { z } from 'zod';
import {
  entityTypeSchema,
  documentKindSchema,
  policyTypeSchema,
  serviceAreaKindSchema,
  usStateSchema,
} from './enums';
import { tradeSlugSchema } from './trades';

/**
 * The canonical Vendor Profile.
 *
 * This is the mapping target for Engine #2: every rule in the deterministic
 * mapping table and every `maps_to` the LLM is allowed to return resolves to a
 * path in this shape. Adding a field here is what makes it fillable.
 *
 * Money is always integer cents; a form wanting "$85.00" or "85" is the
 * transform layer's problem, not the model's.
 */

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9().\-\s]{7,20}$/, 'not a usable phone number');

const dayHoursSchema = z.object({
  open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  closed: z.boolean().default(false),
});

export const hoursOfOperationSchema = z.object({
  mon: dayHoursSchema.optional(),
  tue: dayHoursSchema.optional(),
  wed: dayHoursSchema.optional(),
  thu: dayHoursSchema.optional(),
  fri: dayHoursSchema.optional(),
  sat: dayHoursSchema.optional(),
  sun: dayHoursSchema.optional(),
});
export type HoursOfOperation = z.infer<typeof hoursOfOperationSchema>;

export const remitToSchema = z.object({
  payee_name: z.string().min(1),
  address_line1: z.string().min(1),
  address_line2: z.string().optional(),
  city: z.string().min(1),
  state: usStateSchema,
  postal: z.string().min(5),
});
export type RemitTo = z.infer<typeof remitToSchema>;

export const vendorTradeSchema = z.object({
  id: z.string().uuid().optional(),
  trade_slug: tradeSlugSchema,
  naics_code: z.string().optional(),
  csi_code: z.string().optional(),
  is_primary: z.boolean().default(false),
});
export type VendorTrade = z.infer<typeof vendorTradeSchema>;

export const vendorServiceAreaSchema = z.object({
  id: z.string().uuid().optional(),
  kind: serviceAreaKindSchema,
  center_lat: z.number().min(-90).max(90).nullable().optional(),
  center_lng: z.number().min(-180).max(180).nullable().optional(),
  radius_miles: z.number().int().positive().nullable().optional(),
  zips: z.array(z.string()).default([]),
  counties: z.array(z.string()).default([]),
  states: z.array(usStateSchema).default([]),
});
export type VendorServiceArea = z.infer<typeof vendorServiceAreaSchema>;

export const vendorLicenseSchema = z.object({
  id: z.string().uuid().optional(),
  license_type: z.string().min(1),
  license_number: z.string().min(1),
  issuing_state: usStateSchema,
  issuing_authority: z.string().optional(),
  issued_on: z.string().date().nullable().optional(),
  expires_on: z.string().date().nullable().optional(),
  document_id: z.string().uuid().nullable().optional(),
});
export type VendorLicense = z.infer<typeof vendorLicenseSchema>;

export const vendorInsuranceSchema = z.object({
  id: z.string().uuid().optional(),
  policy_type: policyTypeSchema,
  carrier: z.string().min(1),
  naic_code: z.string().optional(),
  policy_number: z.string().min(1),
  each_occurrence_cents: z.number().int().nonnegative().nullable().optional(),
  aggregate_cents: z.number().int().nonnegative().nullable().optional(),
  effective_on: z.string().date().nullable().optional(),
  expires_on: z.string().date().nullable().optional(),
  additional_insured_text: z.string().nullable().optional(),
  waiver_of_subrogation: z.boolean().default(false),
  primary_and_noncontributory: z.boolean().default(false),
  document_id: z.string().uuid().nullable().optional(),
  agent_name: z.string().nullable().optional(),
  agent_email: z.string().email().nullable().optional(),
  agent_phone: phoneSchema.nullable().optional(),
});
export type VendorInsurance = z.infer<typeof vendorInsuranceSchema>;

export const vendorDocumentSchema = z.object({
  id: z.string().uuid(),
  kind: documentKindSchema,
  label: z.string(),
  r2_key: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  page_count: z.number().int().positive().nullable().optional(),
  expires_on: z.string().date().nullable().optional(),
  is_current: z.boolean(),
});
export type VendorDocument = z.infer<typeof vendorDocumentSchema>;

/**
 * Core company fields. `ein` is deliberately absent from anything that gets
 * serialized toward the LLM — see `redactedProfileForLlm`.
 */
export const vendorProfileCoreSchema = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid().optional(),

  legal_name: z.string().min(1),
  dba: z.string().nullable().optional(),
  entity_type: entityTypeSchema.nullable().optional(),
  ein: z
    .string()
    .regex(/^\d{2}-?\d{7}$/, 'EIN must be 9 digits')
    .nullable()
    .optional(),
  ein_last4: z.string().length(4).nullable().optional(),
  duns: z.string().nullable().optional(),
  website: z.string().url().nullable().optional(),
  year_founded: z.number().int().min(1800).max(2100).nullable().optional(),
  employee_count: z.number().int().nonnegative().nullable().optional(),

  primary_contact_name: z.string().min(1).nullable().optional(),
  primary_contact_title: z.string().nullable().optional(),
  primary_contact_email: z.string().email().nullable().optional(),
  primary_contact_phone: phoneSchema.nullable().optional(),
  after_hours_phone: phoneSchema.nullable().optional(),
  dispatch_email: z.string().email().nullable().optional(),

  address_line1: z.string().nullable().optional(),
  address_line2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: usStateSchema.nullable().optional(),
  postal: z.string().nullable().optional(),
  county: z.string().nullable().optional(),

  hours_of_operation: hoursOfOperationSchema.nullable().optional(),
  offers_after_hours: z.boolean().default(false),
  after_hours_fee_cents: z.number().int().nonnegative().nullable().optional(),

  hourly_rate_cents: z.number().int().nonnegative().nullable().optional(),
  dispatch_fee_cents: z.number().int().nonnegative().nullable().optional(),
  trip_fee_cents: z.number().int().nonnegative().nullable().optional(),
  minimum_invoice_cents: z.number().int().nonnegative().nullable().optional(),

  warranty_terms: z.string().nullable().optional(),
  payment_terms: z.string().nullable().optional(),
  accepts_ach: z.boolean().default(false),
  remit_to: remitToSchema.nullable().optional(),

  w9_signed_date: z.string().date().nullable().optional(),
  background_check_consent: z.boolean().default(false),

  /** Response-time commitment in hours, quoted in the packet email. */
  response_time_hours: z.number().int().positive().nullable().optional(),
  /** Free-text used to seed generated essay answers on portal forms. */
  capability_statement: z.string().nullable().optional(),

  completeness_score: z.number().int().min(0).max(100).default(0),
});

/** The assembled profile as both engines consume it. */
export const vendorProfileSchema = vendorProfileCoreSchema.extend({
  trades: z.array(vendorTradeSchema).default([]),
  service_areas: z.array(vendorServiceAreaSchema).default([]),
  licenses: z.array(vendorLicenseSchema).default([]),
  insurance: z.array(vendorInsuranceSchema).default([]),
  documents: z.array(vendorDocumentSchema).default([]),
});

export type VendorProfileCore = z.infer<typeof vendorProfileCoreSchema>;
export type VendorProfile = z.infer<typeof vendorProfileSchema>;

/** Partial update accepted by the onboarding wizard. */
export const vendorProfileUpdateSchema = vendorProfileCoreSchema
  .omit({ id: true, tenant_id: true, completeness_score: true, ein_last4: true })
  .partial();
export type VendorProfileUpdate = z.infer<typeof vendorProfileUpdateSchema>;

export function primaryTrade(profile: VendorProfile): VendorTrade | undefined {
  return profile.trades.find((t) => t.is_primary) ?? profile.trades[0];
}

export function currentDocuments(profile: VendorProfile): VendorDocument[] {
  return profile.documents.filter((d) => d.is_current);
}

/**
 * Plain-English summary of where the vendor works, for email subjects/bodies.
 */
export function serviceAreaSummary(profile: VendorProfile): string {
  const areas = profile.service_areas;
  if (areas.length === 0) {
    return profile.city && profile.state ? `${profile.city}, ${profile.state}` : 'service area on request';
  }
  const parts: string[] = [];
  for (const area of areas) {
    switch (area.kind) {
      case 'radius':
        if (area.radius_miles && profile.city) {
          parts.push(`${area.radius_miles} miles around ${profile.city}`);
        } else if (area.radius_miles) {
          parts.push(`${area.radius_miles}-mile radius`);
        }
        break;
      case 'state':
        parts.push(area.states.join(', '));
        break;
      case 'county':
        parts.push(area.counties.map((c) => `${c} County`).join(', '));
        break;
      case 'zip':
        parts.push(
          area.zips.length > 6
            ? `${area.zips.slice(0, 6).join(', ')} +${area.zips.length - 6} more ZIPs`
            : area.zips.join(', '),
        );
        break;
      case 'msa':
        parts.push(area.counties.concat(area.states).join(', '));
        break;
    }
  }
  const summary = parts.filter(Boolean).join('; ');
  return summary.length > 0 ? summary : 'service area on request';
}
