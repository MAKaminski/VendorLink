import type { PlatformSlug } from '@vendorlink/core/domain';

/**
 * Terms-of-service policy.
 *
 * §6.5 makes this a bright line rather than a preference: we never create an
 * account on a platform whose terms prohibit automated registration, and an
 * adapter cannot ship `supportsUnattended: true` without a reviewed entry
 * here. That constraint is enforced at the type level in `registry.ts`, so
 * "someone forgot" is not a possible failure.
 *
 * Every entry names the reviewed document and the date it was read, because a
 * policy nobody re-reads is worse than no policy — it produces confident
 * statements about terms that may have changed underneath us.
 *
 * REVIEW CADENCE: quarterly. Next review due 2026-11-02.
 */

export type TosStance =
  | 'allow_unattended'
  | 'assisted_only'
  | 'deny';

export interface TosEntry {
  readonly platform: PlatformSlug;
  readonly stance: TosStance;
  /** Where the reviewed terms live. */
  readonly termsUrl: string | null;
  /** ISO date the terms were last read by a human. */
  readonly reviewedOn: string | null;
  readonly rationale: string;
}

/**
 * IMPORTANT — the default is `assisted_only`, not `allow_unattended`.
 *
 * An unreviewed platform is one we know nothing about, and the safe reading of
 * "unknown" is "put a human in front of it". Failing open here would mean the
 * first unrecognized credentialing platform gets automated registration
 * attempts against terms nobody has read.
 */
export const DEFAULT_STANCE: TosStance = 'assisted_only';

const ENTRIES: readonly TosEntry[] = [
  // ---- generic form builders --------------------------------------------
  // These host forms on behalf of the PM company. Submitting one is the
  // vendor's own action on their own behalf — the same thing they would do by
  // hand — and none of them gate submission behind account creation.
  {
    platform: 'custom',
    stance: 'allow_unattended',
    termsUrl: null,
    reviewedOn: '2026-08-02',
    rationale:
      'A form on the PM company’s own site. Submitting it is the vendor’s own action, ' +
      'performed on their behalf and at their explicit instruction. No account is created.',
  },
  {
    platform: 'gravity_forms',
    stance: 'allow_unattended',
    termsUrl: 'https://www.gravityforms.com/terms-of-service/',
    reviewedOn: '2026-08-02',
    rationale: 'Self-hosted WordPress plugin; terms bind the site owner, not form submitters.',
  },
  {
    platform: 'wpforms',
    stance: 'allow_unattended',
    termsUrl: 'https://wpforms.com/terms/',
    reviewedOn: '2026-08-02',
    rationale: 'Self-hosted WordPress plugin; terms bind the site owner, not form submitters.',
  },
  {
    platform: 'jotform',
    stance: 'allow_unattended',
    termsUrl: 'https://www.jotform.com/terms/',
    reviewedOn: '2026-08-02',
    rationale: 'Public form submission requires no account and no acceptance of platform terms.',
  },
  {
    platform: 'formstack',
    stance: 'allow_unattended',
    termsUrl: 'https://www.formstack.com/legal/terms-of-service',
    reviewedOn: '2026-08-02',
    rationale: 'Public form submission requires no account.',
  },
  {
    platform: 'wufoo',
    stance: 'allow_unattended',
    termsUrl: 'https://www.wufoo.com/legal/terms-of-service/',
    reviewedOn: '2026-08-02',
    rationale: 'Public form submission requires no account.',
  },
  {
    platform: 'cognito_forms',
    stance: 'allow_unattended',
    termsUrl: 'https://www.cognitoforms.com/terms-of-service',
    reviewedOn: '2026-08-02',
    rationale: 'Public form submission requires no account.',
  },
  {
    platform: 'hubspot_form',
    stance: 'allow_unattended',
    termsUrl: 'https://legal.hubspot.com/terms-of-service',
    reviewedOn: '2026-08-02',
    rationale: 'Embedded lead form; submission requires no account.',
  },
  {
    platform: 'typeform',
    stance: 'allow_unattended',
    termsUrl: 'https://admin.typeform.com/to/dwk6gt/',
    reviewedOn: '2026-08-02',
    rationale:
      'Public response submission requires no account. Typeform’s multi-step UI is handled ' +
      'by the adapter rather than by any circumvention of the platform.',
  },

  // ---- property management systems ---------------------------------------
  {
    platform: 'appfolio',
    stance: 'assisted_only',
    termsUrl: 'https://www.appfolio.com/terms-of-service',
    reviewedOn: '2026-08-02',
    rationale:
      'Vendor onboarding varies per PM tenant and some flows require an account. Pending a ' +
      'per-flow review, route to the assisted lane rather than assume the unauthenticated path.',
  },
  {
    platform: 'buildium',
    stance: 'assisted_only',
    termsUrl: 'https://www.buildium.com/terms-of-service/',
    reviewedOn: '2026-08-02',
    rationale: 'As AppFolio: onboarding flow varies per PM tenant.',
  },
  {
    platform: 'propertyware',
    stance: 'assisted_only',
    termsUrl: 'https://www.propertyware.com/terms-of-use/',
    reviewedOn: '2026-08-02',
    rationale: 'As AppFolio: onboarding flow varies per PM tenant.',
  },

  // ---- credentialing platforms -------------------------------------------
  // All deny unattended: registration requires an account, most charge a fee,
  // and their terms restrict automated access. §6 flags this explicitly as the
  // place where "auto-submit only" would silently fail against the highest
  // value targets.
  {
    platform: 'netvendor',
    stance: 'deny',
    termsUrl: 'https://www.netvendor.com/terms-of-use/',
    reviewedOn: '2026-08-02',
    rationale:
      'Registration requires an account and a paid vendor fee. Terms restrict automated ' +
      'access. Assisted lane only, with the fee disclosed before the operator proceeds.',
  },
  {
    platform: 'realpage',
    stance: 'deny',
    termsUrl: 'https://www.realpage.com/legal/terms-of-use/',
    reviewedOn: '2026-08-02',
    rationale: 'Vendor Credentialing requires an account and a paid fee; terms restrict automation.',
  },
  {
    platform: 'yardi_vendorcafe',
    stance: 'deny',
    termsUrl: 'https://www.yardi.com/legal/terms-of-use/',
    reviewedOn: '2026-08-02',
    rationale: 'Requires an account; terms restrict automated access.',
  },
  {
    platform: 'yardi_vendorshield',
    stance: 'deny',
    termsUrl: 'https://www.yardi.com/legal/terms-of-use/',
    reviewedOn: '2026-08-02',
    rationale: 'Requires an account and a paid fee; terms restrict automated access.',
  },
  {
    platform: 'entrata',
    stance: 'deny',
    termsUrl: 'https://www.entrata.com/terms-of-use',
    reviewedOn: '2026-08-02',
    rationale: 'Requires an account; terms restrict automated access.',
  },
  {
    platform: 'mri',
    stance: 'deny',
    termsUrl: 'https://www.mrisoftware.com/terms-of-use/',
    reviewedOn: '2026-08-02',
    rationale: 'Requires an account; terms restrict automated access.',
  },
];

const BY_PLATFORM = new Map<PlatformSlug, TosEntry>(ENTRIES.map((e) => [e.platform, e]));

export function tosEntryFor(platform: PlatformSlug | null): TosEntry | null {
  return platform ? (BY_PLATFORM.get(platform) ?? null) : null;
}

export function stanceFor(platform: PlatformSlug | null): TosStance {
  return tosEntryFor(platform)?.stance ?? DEFAULT_STANCE;
}

/** Platforms an adapter is permitted to submit to without a human present. */
export type UnattendedPlatform = Extract<
  (typeof ENTRIES)[number],
  { stance: 'allow_unattended' }
>['platform'];

export function isUnattendedAllowed(platform: PlatformSlug | null): boolean {
  return stanceFor(platform) === 'allow_unattended';
}

/** Operator-facing explanation for why a run was routed to the assisted lane. */
export function assistedLaneReason(platform: PlatformSlug | null): string {
  const entry = tosEntryFor(platform);
  if (!entry) {
    return (
      `We have not reviewed the terms for this platform, so this submission needs a human. ` +
      `Nothing was submitted automatically.`
    );
  }
  return `${entry.rationale} (Terms reviewed ${entry.reviewedOn ?? 'not yet'}.)`;
}

export const TOS_ENTRIES = ENTRIES;
