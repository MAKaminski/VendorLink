import { z } from 'zod';

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
] as const;

export type UsState = (typeof US_STATES)[number];
export const usStateSchema = z.enum(US_STATES);

/** Full names, needed because forms ask for either the code or the name. */
export const US_STATE_NAMES: Readonly<Record<UsState, string>> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

export const ENTITY_TYPES = [
  'llc',
  's_corp',
  'c_corp',
  'partnership',
  'sole_proprietor',
  'nonprofit',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export const entityTypeSchema = z.enum(ENTITY_TYPES);

export const ENTITY_TYPE_LABELS: Readonly<Record<EntityType, string>> = {
  llc: 'LLC',
  s_corp: 'S Corporation',
  c_corp: 'C Corporation',
  partnership: 'Partnership',
  sole_proprietor: 'Sole Proprietorship',
  nonprofit: 'Non-Profit',
};

export const POLICY_TYPES = ['GL', 'AUTO', 'UMBRELLA', 'WC', 'PROF', 'POLLUTION'] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];
export const policyTypeSchema = z.enum(POLICY_TYPES);

export const POLICY_TYPE_LABELS: Readonly<Record<PolicyType, string>> = {
  GL: 'General Liability',
  AUTO: 'Commercial Auto',
  UMBRELLA: 'Umbrella / Excess',
  WC: "Workers' Compensation",
  PROF: 'Professional Liability',
  POLLUTION: 'Pollution Liability',
};

export const DOCUMENT_KINDS = [
  'W9',
  'COI',
  'LICENSE',
  'PRICEBOOK',
  'CAPABILITY_STATEMENT',
  'SAFETY_MANUAL',
  'BANK_LETTER',
  'VOIDED_CHECK',
  'REFERENCES',
  'OTHER',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const documentKindSchema = z.enum(DOCUMENT_KINDS);

export const DOCUMENT_KIND_LABELS: Readonly<Record<DocumentKind, string>> = {
  W9: 'W-9',
  COI: 'Certificate of Insurance',
  LICENSE: 'License',
  PRICEBOOK: 'Pricebook',
  CAPABILITY_STATEMENT: 'Capability Statement',
  SAFETY_MANUAL: 'Safety Manual',
  BANK_LETTER: 'Bank Letter',
  VOIDED_CHECK: 'Voided Check',
  REFERENCES: 'References',
  OTHER: 'Other',
};

export const SERVICE_AREA_KINDS = ['radius', 'zip', 'county', 'state', 'msa'] as const;
export type ServiceAreaKind = (typeof SERVICE_AREA_KINDS)[number];
export const serviceAreaKindSchema = z.enum(SERVICE_AREA_KINDS);

export const CONTACT_KINDS = [
  'vendor_onboarding',
  'procurement',
  'ap',
  'maintenance',
  'regional',
  'general',
  'unknown',
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const contactKindSchema = z.enum(CONTACT_KINDS);

export const CHANNEL_KINDS = [
  'EMAIL',
  'WEB_FORM',
  'PORTAL',
  'CONTACT_FORM',
  'PDF_PACKET',
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const channelKindSchema = z.enum(CHANNEL_KINDS);

export const PLATFORM_SLUGS = [
  'realpage',
  'netvendor',
  'yardi_vendorcafe',
  'yardi_vendorshield',
  'entrata',
  'appfolio',
  'buildium',
  'propertyware',
  'mri',
  'gravity_forms',
  'wpforms',
  'jotform',
  'typeform',
  'hubspot_form',
  'formstack',
  'wufoo',
  'cognito_forms',
  'custom',
] as const;
export type PlatformSlug = (typeof PLATFORM_SLUGS)[number];
export const platformSlugSchema = z.enum(PLATFORM_SLUGS);

export const CAPTCHA_KINDS = [
  'none',
  'recaptcha_v2',
  'recaptcha_v3',
  'hcaptcha',
  'turnstile',
  'unknown',
] as const;
export type CaptchaKind = (typeof CAPTCHA_KINDS)[number];
export const captchaKindSchema = z.enum(CAPTCHA_KINDS);

export const AUTH_KINDS = ['none', 'email_link', 'password', 'sso'] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];
export const authKindSchema = z.enum(AUTH_KINDS);

export const RUN_STATUSES = [
  'queued',
  'running',
  'partial',
  'succeeded',
  'needs_attention',
  'failed',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const runStatusSchema = z.enum(RUN_STATUSES);

export const TASK_KINDS = ['EMAIL', 'PORTAL'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const taskKindSchema = z.enum(TASK_KINDS);

export const TASK_STATUSES = [
  'queued',
  'running',
  'submitted_unconfirmed',
  'succeeded',
  'needs_attention',
  'failed',
  'cancelled',
  'skipped',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = z.enum(TASK_STATUSES);

/**
 * Why a task ended where it did. Kept as a closed set because the
 * Needs-Attention queue groups by it and the admin health view charts it.
 */
export const FAILURE_CLASSES = [
  'no_contact_found',
  'captcha_required',
  'account_required',
  'payment_required',
  'tos_restricted',
  'low_confidence_mapping',
  'unmapped_required_field',
  'form_not_found',
  'navigation_failed',
  'upload_failed',
  'submission_rejected',
  'send_blocked_unverified_domain',
  'send_blocked_rate_limit',
  'send_blocked_suppressed',
  'hard_bounce',
  'timeout',
  'internal_error',
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];
export const failureClassSchema = z.enum(FAILURE_CLASSES);

export const REPLY_CLASSIFICATIONS = [
  'approved',
  'more_info_needed',
  'rejected',
  'auto_reply',
  'wrong_department',
  'unsubscribe',
  'other',
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];
export const replyClassificationSchema = z.enum(REPLY_CLASSIFICATIONS);

export const TENANT_ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export const tenantRoleSchema = z.enum(TENANT_ROLES);
