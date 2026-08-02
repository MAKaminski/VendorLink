import {
  bestOptionMatch,
  centsToWholeDollars,
  ENTITY_TYPE_LABELS,
  formatBoolean,
  formatDate,
  formatPhone,
  serviceAreaSummary,
  stateToFullName,
  TRADES,
  truncateToLength,
  type VendorProfile,
} from '@vendorlink/core/domain';
import { isSecretPath, type MappingRule } from './mapping-rules';
import type { FieldOption, FormField } from './types';

/**
 * Turn a canonical profile path into the string this particular form wants.
 *
 * §6.3 step 4. The profile stores one representation; forms want a dozen. This
 * is where cents become "$85.00" or "85", "GA" becomes "Georgia", and a trade
 * gets matched against the form's own option vocabulary. Currency is written as
 * a plain decimal, since form validators commonly reject symbols and commas.
 *
 * Returning `null` is a legitimate outcome and means "we have nothing for
 * this" — the gate then decides whether that is survivable.
 */

export interface ResolveContext {
  readonly profile: VendorProfile;
  /** Cached generated answers, keyed by question hash. */
  readonly generated?: ReadonlyMap<string, string>;
}

export interface ResolvedValue {
  /** What to type, or which option to select. */
  readonly value: string;
  /** True when the value is a secret and must be redacted in the audit row. */
  readonly secret: boolean;
}

function firstInsurance(profile: VendorProfile, type: string) {
  return profile.insurance.find((i) => i.policy_type === type);
}

function primaryLicense(profile: VendorProfile) {
  return profile.licenses[0];
}

/** Raw value for a path, before any form-specific transform. */
// eslint-disable-next-line complexity
function rawValue(path: string, context: ResolveContext): string | number | boolean | null {
  const p = context.profile;

  switch (path) {
    case 'profile.legal_name': return p.legal_name;
    case 'profile.dba': return p.dba ?? null;
    case 'profile.ein': return p.ein ?? null;
    case 'profile.duns': return p.duns ?? null;
    case 'profile.entity_type': return p.entity_type ? ENTITY_TYPE_LABELS[p.entity_type] : null;
    case 'profile.website': return p.website ?? null;
    case 'profile.year_founded': return p.year_founded ?? null;
    case 'profile.employee_count': return p.employee_count ?? null;

    case 'profile.primary_contact_name': return p.primary_contact_name ?? null;
    case 'profile.primary_contact_first_name':
      return p.primary_contact_name?.split(' ')[0] ?? null;
    case 'profile.primary_contact_last_name':
      return p.primary_contact_name?.split(' ').slice(1).join(' ') || null;
    case 'profile.primary_contact_title': return p.primary_contact_title ?? null;
    case 'profile.primary_contact_email': return p.primary_contact_email ?? null;
    case 'profile.primary_contact_phone': return p.primary_contact_phone ?? null;
    case 'profile.after_hours_phone': return p.after_hours_phone ?? null;
    case 'profile.dispatch_email': return p.dispatch_email ?? null;

    case 'profile.address_line1': return p.address_line1 ?? null;
    case 'profile.address_line2': return p.address_line2 ?? null;
    case 'profile.city': return p.city ?? null;
    case 'profile.state': return p.state ?? null;
    case 'profile.postal': return p.postal ?? null;
    case 'profile.county': return p.county ?? null;

    case 'profile.service_area_summary': return serviceAreaSummary(p);
    case 'profile.naics_code':
      return p.trades.find((t) => t.is_primary)?.naics_code ?? null;
    case 'profile.csi_code': return p.trades.find((t) => t.is_primary)?.csi_code ?? null;

    case 'profile.license_number': return primaryLicense(p)?.license_number ?? null;
    case 'profile.license_type': return primaryLicense(p)?.license_type ?? null;
    case 'profile.license_state': return primaryLicense(p)?.issuing_state ?? null;
    case 'profile.license_expires_on': return primaryLicense(p)?.expires_on ?? null;

    case 'profile.gl_each_occurrence':
      return firstInsurance(p, 'GL')?.each_occurrence_cents ?? null;
    case 'profile.gl_aggregate': return firstInsurance(p, 'GL')?.aggregate_cents ?? null;
    case 'profile.auto_limit': return firstInsurance(p, 'AUTO')?.each_occurrence_cents ?? null;
    case 'profile.umbrella_limit':
      return firstInsurance(p, 'UMBRELLA')?.each_occurrence_cents ?? null;
    case 'profile.has_workers_comp': return Boolean(firstInsurance(p, 'WC'));
    case 'profile.insurance_carrier': return firstInsurance(p, 'GL')?.carrier ?? null;
    case 'profile.insurance_policy_number': return firstInsurance(p, 'GL')?.policy_number ?? null;
    case 'profile.insurance_expires_on': return firstInsurance(p, 'GL')?.expires_on ?? null;
    case 'profile.agent_name': return firstInsurance(p, 'GL')?.agent_name ?? null;
    case 'profile.agent_email': return firstInsurance(p, 'GL')?.agent_email ?? null;
    case 'profile.agent_phone': return firstInsurance(p, 'GL')?.agent_phone ?? null;
    case 'profile.additional_insured_text':
      return firstInsurance(p, 'GL')?.additional_insured_text ?? null;
    case 'profile.waiver_of_subrogation':
      return firstInsurance(p, 'GL')?.waiver_of_subrogation ?? false;
    case 'profile.primary_and_noncontributory':
      return firstInsurance(p, 'GL')?.primary_and_noncontributory ?? false;

    case 'profile.hourly_rate': return p.hourly_rate_cents ?? null;
    case 'profile.trip_fee': return p.trip_fee_cents ?? null;
    case 'profile.dispatch_fee': return p.dispatch_fee_cents ?? null;
    case 'profile.after_hours_fee': return p.after_hours_fee_cents ?? null;
    case 'profile.minimum_invoice': return p.minimum_invoice_cents ?? null;
    case 'profile.payment_terms': return p.payment_terms ?? null;
    case 'profile.warranty_terms': return p.warranty_terms ?? null;
    case 'profile.accepts_ach': return p.accepts_ach;

    case 'profile.offers_after_hours': return p.offers_after_hours;
    case 'profile.response_time_hours': return p.response_time_hours ?? null;
    case 'profile.hours_summary': return summarizeHours(p);
    case 'profile.background_check_consent': return p.background_check_consent;

    // Secrets are never resolved to a literal here; the caller writes a
    // redaction marker and the browser types the real value from a separate
    // path that never touches the audit row.
    case 'profile.remit_to_address':
    case 'profile.bank_details':
      return null;

    default:
      return null;
  }
}

function summarizeHours(profile: VendorProfile): string | null {
  const hours = profile.hours_of_operation;
  if (!hours) return null;
  const days = Object.entries(hours).filter(([, v]) => v && !v.closed);
  if (days.length === 0) return null;
  const first = days[0]?.[1];
  return first ? `${days.length} days/week, ${first.open}–${first.close}` : null;
}

/**
 * Resolve a field's value, applying the transform the form implies.
 *
 * The field's own `type` and `options` drive the choice: a select gets fuzzy
 * matched against its own vocabulary, a checkbox gets a boolean, and a text
 * input gets whatever the mapping rule's transform says.
 */
export function resolveFieldValue(
  field: FormField,
  rule: Pick<MappingRule, 'transform'> | null,
  context: ResolveContext,
): ResolvedValue | null {
  const path = field.mapsTo;
  if (!path) return null;

  if (isSecretPath(path)) {
    const raw = path === 'profile.ein' ? context.profile.ein : null;
    return raw ? { value: raw, secret: true } : null;
  }

  if (path.startsWith('generated.')) {
    const answer = context.generated?.get(path.slice('generated.'.length));
    if (!answer) return null;
    const capped = field.maxLength ? truncateToLength(answer, field.maxLength) : answer;
    return { value: capped, secret: false };
  }

  // Trades map against the form's own option vocabulary rather than our slugs.
  if (path === 'profile.trades') {
    return resolveTrade(field, context);
  }

  const raw = rawValue(path, context);
  if (raw === null || raw === '') return null;

  // A select or radio must yield one of its own options, whatever the
  // transform would otherwise produce.
  if ((field.type === 'select' || field.type === 'radio') && field.options.length > 0) {
    const matched = matchOption(field.options, raw);
    return matched ? { value: matched, secret: false } : null;
  }

  if (field.type === 'checkbox') {
    return { value: raw === true || raw === 'true' ? 'true' : 'false', secret: false };
  }

  const transformed = applyTransform(raw, rule?.transform, field);
  return transformed === null ? null : { value: transformed, secret: false };
}

function matchOption(options: readonly FieldOption[], raw: string | number | boolean): string | null {
  if (typeof raw === 'boolean') {
    const wanted = raw ? /^(yes|true|y|1)$/i : /^(no|false|n|0)$/i;
    return options.find((o) => wanted.test(o.label) || wanted.test(o.value))?.value ?? null;
  }
  const text = String(raw);
  const exact = options.find(
    (o) => o.value.toLowerCase() === text.toLowerCase() || o.label.toLowerCase() === text.toLowerCase(),
  );
  if (exact) return exact.value;
  const fuzzy = bestOptionMatch(options, (o) => o.label, [text]);
  return fuzzy?.option.value ?? null;
}

function resolveTrade(field: FormField, context: ResolveContext): ResolvedValue | null {
  const primary =
    context.profile.trades.find((t) => t.is_primary) ?? context.profile.trades[0];
  if (!primary) return null;

  const trade = TRADES[primary.trade_slug];

  if (field.options.length > 0) {
    const match = bestOptionMatch(field.options, (o) => o.label, [trade.label, ...trade.aliases]);
    return match ? { value: match.option.value, secret: false } : null;
  }
  return { value: trade.label, secret: false };
}

function applyTransform(
  raw: string | number | boolean,
  transform: MappingRule['transform'],
  field: FormField,
): string | null {
  switch (transform) {
    case 'phone':
      return formatPhone(String(raw), field.maxLength === 10 ? 'plain' : 'dashes');
    case 'currency_dollars':
      // A plain decimal, with no currency symbol and no thousands separators.
      // Form validators commonly reject both, and "1000000.00" is accepted
      // everywhere "$1,000,000.00" is. The symbol form lives in the email
      // template, where a human reads it.
      return typeof raw === 'number' ? (raw / 100).toFixed(2) : String(raw);
    case 'currency_whole':
      return typeof raw === 'number' ? centsToWholeDollars(raw) : String(raw);
    case 'date_us':
      return field.type === 'date' ? formatDate(String(raw), 'iso') : formatDate(String(raw), 'us');
    case 'date_iso':
      return formatDate(String(raw), 'iso');
    case 'state_code':
      return String(raw);
    case 'state_name':
      return stateToFullName(String(raw) as never);
    case 'boolean_yes_no':
      return formatBoolean(Boolean(raw));
    default:
      break;
  }

  if (typeof raw === 'boolean') return formatBoolean(raw);
  const text = String(raw);
  return field.maxLength ? truncateToLength(text, field.maxLength) : text;
}

/** Redaction marker written to `portal_field_writes` in place of a secret. */
export function redactionMarkerFor(path: string): string {
  return `*** redacted (${path}) ***`;
}
