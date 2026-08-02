import { centsToDisplayLimit } from './format';
import type { VendorProfile } from './profile';

/**
 * Requirement fit.
 *
 * §7.1 calls the fit banner the highest-value pixel on the PM card, and the
 * reason is economic rather than aesthetic: a submission that fails on a
 * stated insurance minimum costs the vendor a slot in the pool and costs us a
 * run. Comparing integer cents against the PM's published minimums lets us say
 * so *before* the click.
 *
 * Requirements are frequently unknown — most PM sites do not publish limits.
 * `unknown` is therefore a distinct outcome from `meets`; claiming a vendor
 * meets requirements we never read would be worse than saying nothing.
 */

export interface PmRequirementsInput {
  minGlEachOccurrenceCents?: number | null;
  minGlAggregateCents?: number | null;
  minAutoCents?: number | null;
  minUmbrellaCents?: number | null;
  requiresWc?: boolean | null;
  requiresAdditionalInsured?: boolean | null;
  additionalInsuredWording?: string | null;
  requiresW9?: boolean | null;
  requiresBackgroundCheck?: boolean | null;
  requiresLicense?: string[] | null;
  sourceUrl?: string | null;
}

export interface FitGap {
  readonly key: string;
  readonly label: string;
  /** What the vendor has, in the PM's own units. */
  readonly detail: string;
  readonly href: string;
  /** True when a corrected COI from the vendor's agent would resolve it. */
  readonly fixableByAgent: boolean;
}

export type FitStatus = 'meets' | 'gaps' | 'unknown';

export interface FitResult {
  readonly status: FitStatus;
  readonly gaps: readonly FitGap[];
  /** Requirements we actually checked, for the "based on" line in the UI. */
  readonly checked: number;
}

function limitFor(
  profile: VendorProfile,
  policyType: string,
  field: 'each_occurrence_cents' | 'aggregate_cents',
): number {
  return profile.insurance
    .filter((i) => i.policy_type === policyType)
    .reduce((max, i) => Math.max(max, i[field] ?? 0), 0);
}

export function computeFit(
  profile: VendorProfile,
  requirements: PmRequirementsInput | null,
): FitResult {
  if (!requirements) return { status: 'unknown', gaps: [], checked: 0 };

  const gaps: FitGap[] = [];
  let checked = 0;

  const insuranceChecks: Array<{
    required: number | null | undefined;
    have: number;
    key: string;
    label: string;
  }> = [
    {
      required: requirements.minGlEachOccurrenceCents,
      have: limitFor(profile, 'GL', 'each_occurrence_cents'),
      key: 'gl_each_occurrence',
      label: 'General liability, each occurrence',
    },
    {
      required: requirements.minGlAggregateCents,
      have: limitFor(profile, 'GL', 'aggregate_cents'),
      key: 'gl_aggregate',
      label: 'General liability aggregate',
    },
    {
      required: requirements.minAutoCents,
      have: limitFor(profile, 'AUTO', 'each_occurrence_cents'),
      key: 'auto',
      label: 'Commercial auto',
    },
    {
      required: requirements.minUmbrellaCents,
      have: limitFor(profile, 'UMBRELLA', 'each_occurrence_cents'),
      key: 'umbrella',
      label: 'Umbrella / excess',
    },
  ];

  for (const check of insuranceChecks) {
    if (!check.required) continue;
    checked++;
    if (check.have < check.required) {
      gaps.push({
        key: check.key,
        label: `${check.label} below ${centsToDisplayLimit(check.required)}`,
        detail:
          check.have > 0
            ? `Your policy is ${centsToDisplayLimit(check.have)}`
            : 'No policy on file',
        href: '/onboarding/insurance',
        fixableByAgent: true,
      });
    }
  }

  if (requirements.requiresWc) {
    checked++;
    if (!profile.insurance.some((i) => i.policy_type === 'WC')) {
      gaps.push({
        key: 'wc',
        label: "Workers' compensation certificate required",
        detail: 'No WC policy on file',
        href: '/onboarding/insurance',
        fixableByAgent: true,
      });
    }
  }

  if (requirements.requiresAdditionalInsured) {
    checked++;
    const wording = requirements.additionalInsuredWording?.trim();
    const hasAdditionalInsured = profile.insurance.some((i) =>
      (i.additional_insured_text ?? '').trim().length > 0,
    );
    if (!hasAdditionalInsured) {
      gaps.push({
        key: 'additional_insured',
        label: 'Additional-insured endorsement required',
        detail: wording ? `Required wording: “${wording}”` : 'No endorsement wording on file',
        href: '/onboarding/insurance',
        fixableByAgent: true,
      });
    }
  }

  if (requirements.requiresW9) {
    checked++;
    if (!profile.documents.some((d) => d.kind === 'W9' && d.is_current)) {
      gaps.push({
        key: 'w9',
        label: 'Signed W-9 required',
        detail: 'No current W-9 uploaded',
        href: '/onboarding/documents',
        fixableByAgent: false,
      });
    }
  }

  if (requirements.requiresBackgroundCheck) {
    checked++;
    if (!profile.background_check_consent) {
      gaps.push({
        key: 'background_check',
        label: 'Background check consent required',
        detail: 'Consent not yet given',
        href: '/onboarding/company',
        fixableByAgent: false,
      });
    }
  }

  for (const licenseType of requirements.requiresLicense ?? []) {
    checked++;
    const held = profile.licenses.some((l) =>
      l.license_type.toLowerCase().includes(licenseType.toLowerCase()),
    );
    if (!held) {
      gaps.push({
        key: `license_${licenseType}`,
        label: `${licenseType} licence required`,
        detail: 'Not on file',
        href: '/onboarding/licenses',
        fixableByAgent: false,
      });
    }
  }

  if (checked === 0) return { status: 'unknown', gaps: [], checked: 0 };
  return { status: gaps.length === 0 ? 'meets' : 'gaps', gaps, checked };
}

/**
 * Pre-drafted request to the vendor's insurance agent.
 *
 * §4.1 asks for a one-click "email my agent for a corrected COI". The value is
 * that it states the PM's exact required wording and limits, because a vague
 * request produces a second wrong certificate.
 */
export function draftAgentCoiRequest(input: {
  profile: VendorProfile;
  pmCompanyName: string;
  gaps: readonly FitGap[];
  requirements: PmRequirementsInput | null;
}): { to: string | null; subject: string; body: string } {
  const agent = input.profile.insurance.find((i) => i.agent_email);
  const relevant = input.gaps.filter((g) => g.fixableByAgent);

  const lines: string[] = [
    `Hi${agent?.agent_name ? ` ${agent.agent_name}` : ''},`,
    '',
    `We're applying to join ${input.pmCompanyName}'s approved vendor pool and they require a ` +
      `certificate of insurance that our current policy does not satisfy. Could you issue a ` +
      `revised COI with the following?`,
    '',
  ];

  for (const gap of relevant) {
    lines.push(`  • ${gap.label} — currently: ${gap.detail}`);
  }

  const wording = input.requirements?.additionalInsuredWording?.trim();
  if (wording) {
    lines.push('', 'Additional insured must read exactly:', `  "${wording}"`);
  }

  lines.push(
    '',
    `Certificate holder: ${input.pmCompanyName}`,
    '',
    'Thanks very much,',
    input.profile.primary_contact_name ?? input.profile.legal_name,
    input.profile.legal_name,
  );

  return {
    to: agent?.agent_email ?? null,
    subject: `Revised COI needed — ${input.profile.legal_name} / ${input.pmCompanyName}`,
    body: lines.join('\n'),
  };
}
