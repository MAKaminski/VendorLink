import type { VendorProfile } from './profile.js';

/**
 * Profile completeness.
 *
 * §4.1 makes this a first-class product surface, not a vanity metric: an
 * incomplete profile is the #1 cause of a failed portal submission, so the
 * score has to name the *specific* missing items and link to the fix. The
 * weights are chosen so a vendor missing a W-9 or a COI cannot cross 80 —
 * those two documents are what most PM applications hard-require.
 */

export interface CompletenessCheck {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  /** Where the operator goes to fix it. */
  readonly href: string;
  /** True when this item blocks most portal submissions outright. */
  readonly blocking: boolean;
}

export interface CompletenessResult {
  readonly score: number;
  readonly missing: readonly CompletenessCheck[];
  readonly satisfied: readonly CompletenessCheck[];
  /** Missing items that will very likely cause a submission to fail. */
  readonly blockers: readonly CompletenessCheck[];
}

interface CheckDefinition extends CompletenessCheck {
  readonly satisfiedBy: (p: VendorProfile) => boolean;
}

const hasText = (v: string | null | undefined): boolean =>
  typeof v === 'string' && v.trim().length > 0;

const CHECKS: readonly CheckDefinition[] = [
  {
    key: 'legal_name',
    label: 'Legal business name',
    weight: 6,
    href: '/onboarding/company',
    blocking: true,
    satisfiedBy: (p) => hasText(p.legal_name),
  },
  {
    key: 'entity_type',
    label: 'Entity type',
    weight: 3,
    href: '/onboarding/company',
    blocking: false,
    satisfiedBy: (p) => hasText(p.entity_type),
  },
  {
    key: 'ein',
    label: 'EIN / federal tax ID',
    weight: 7,
    href: '/onboarding/company',
    blocking: true,
    satisfiedBy: (p) => hasText(p.ein) || hasText(p.ein_last4),
  },
  {
    key: 'address',
    label: 'Business address',
    weight: 6,
    href: '/onboarding/company',
    blocking: true,
    satisfiedBy: (p) =>
      hasText(p.address_line1) && hasText(p.city) && hasText(p.state) && hasText(p.postal),
  },
  {
    key: 'primary_contact',
    label: 'Primary contact name, email and phone',
    weight: 8,
    href: '/onboarding/contact',
    blocking: true,
    satisfiedBy: (p) =>
      hasText(p.primary_contact_name) &&
      hasText(p.primary_contact_email) &&
      hasText(p.primary_contact_phone),
  },
  {
    key: 'website',
    label: 'Company website',
    weight: 2,
    href: '/onboarding/company',
    blocking: false,
    satisfiedBy: (p) => hasText(p.website),
  },
  {
    key: 'trades',
    label: 'At least one trade, with a primary selected',
    weight: 8,
    href: '/onboarding/trades',
    blocking: true,
    satisfiedBy: (p) => p.trades.length > 0 && p.trades.some((t) => t.is_primary),
  },
  {
    key: 'service_area',
    label: 'Service area',
    weight: 7,
    href: '/onboarding/service-area',
    blocking: true,
    satisfiedBy: (p) => p.service_areas.length > 0,
  },
  {
    key: 'hours',
    label: 'Hours of operation',
    weight: 3,
    href: '/onboarding/contact',
    blocking: false,
    satisfiedBy: (p) => p.hours_of_operation != null && Object.keys(p.hours_of_operation).length > 0,
  },
  {
    key: 'after_hours',
    label: 'After-hours availability and phone',
    weight: 3,
    href: '/onboarding/contact',
    blocking: false,
    satisfiedBy: (p) => !p.offers_after_hours || hasText(p.after_hours_phone),
  },
  {
    key: 'doc_w9',
    label: 'Signed W-9',
    weight: 12,
    href: '/onboarding/documents',
    blocking: true,
    satisfiedBy: (p) => p.documents.some((d) => d.kind === 'W9' && d.is_current),
  },
  {
    key: 'doc_coi',
    label: 'Current certificate of insurance',
    weight: 12,
    href: '/onboarding/documents',
    blocking: true,
    satisfiedBy: (p) => p.documents.some((d) => d.kind === 'COI' && d.is_current),
  },
  {
    key: 'insurance_gl',
    label: 'General liability policy details with limits',
    weight: 8,
    href: '/onboarding/insurance',
    blocking: true,
    satisfiedBy: (p) =>
      p.insurance.some(
        (i) =>
          i.policy_type === 'GL' &&
          (i.each_occurrence_cents ?? 0) > 0 &&
          (i.aggregate_cents ?? 0) > 0,
      ),
  },
  {
    key: 'insurance_wc',
    label: "Workers' compensation policy",
    weight: 4,
    href: '/onboarding/insurance',
    blocking: false,
    satisfiedBy: (p) => p.insurance.some((i) => i.policy_type === 'WC'),
  },
  {
    key: 'licenses',
    label: 'Trade license numbers',
    weight: 5,
    href: '/onboarding/licenses',
    blocking: false,
    satisfiedBy: (p) => p.licenses.length > 0,
  },
  {
    key: 'pricing',
    label: 'Hourly rate and trip/dispatch fees',
    weight: 3,
    href: '/onboarding/pricing',
    blocking: false,
    satisfiedBy: (p) => (p.hourly_rate_cents ?? 0) > 0,
  },
  {
    key: 'payment_terms',
    label: 'Payment terms and remittance details',
    weight: 2,
    href: '/onboarding/pricing',
    blocking: false,
    satisfiedBy: (p) => hasText(p.payment_terms),
  },
  {
    key: 'capability_statement',
    label: 'Capability statement',
    weight: 1,
    href: '/onboarding/documents',
    blocking: false,
    satisfiedBy: (p) =>
      hasText(p.capability_statement) ||
      p.documents.some((d) => d.kind === 'CAPABILITY_STATEMENT' && d.is_current),
  },
];

const TOTAL_WEIGHT = CHECKS.reduce((sum, c) => sum + c.weight, 0);

/**
 * Ceiling applied while any blocking item is missing.
 *
 * A weighted sum alone reports a profile with no W-9 as ~88% complete, which
 * is true arithmetically and useless in practice: that vendor cannot complete
 * a single PM application. Capping below the nag threshold keeps the number
 * honest about readiness rather than about form-fill progress.
 */
const BLOCKED_SCORE_CAP = 79;

export function computeCompleteness(profile: VendorProfile): CompletenessResult {
  const missing: CompletenessCheck[] = [];
  const satisfied: CompletenessCheck[] = [];
  let earned = 0;

  for (const check of CHECKS) {
    // A check that throws on a half-built profile counts as unsatisfied
    // rather than taking down the dashboard.
    let ok: boolean;
    try {
      ok = check.satisfiedBy(profile);
    } catch {
      ok = false;
    }
    const { satisfiedBy: _omit, ...publicCheck } = check;
    if (ok) {
      earned += check.weight;
      satisfied.push(publicCheck);
    } else {
      missing.push(publicCheck);
    }
  }

  const blockers = missing.filter((m) => m.blocking);
  const weighted = Math.round((earned / TOTAL_WEIGHT) * 100);

  return {
    score: blockers.length > 0 ? Math.min(weighted, BLOCKED_SCORE_CAP) : weighted,
    missing,
    satisfied,
    blockers,
  };
}

/** The threshold below which §4.1 says we should actively nag. */
export const COMPLETENESS_NAG_THRESHOLD = 80;

export function shouldNag(score: number): boolean {
  return score < COMPLETENESS_NAG_THRESHOLD;
}
