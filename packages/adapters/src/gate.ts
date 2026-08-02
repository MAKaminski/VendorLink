import type { CaptchaKind, PlatformSlug } from '@vendorlink/core/domain';
import { assistedLaneReason, stanceFor } from './tos-policy';
import type { FormField, GateDecision } from './types';

/**
 * The confidence gate (§6.3 step 7, §6.1 step 5).
 *
 * This is the one honest flag from §6 made mechanical: full auto-submit is the
 * default lane, and everything that cannot be done unattended — a CAPTCHA, a
 * paywall, restricted terms, an unmapped required field — diverts to the
 * assisted lane instead of failing silently or guessing.
 *
 * Two properties matter more than the threshold itself:
 *   - A CAPTCHA is never solved, programmatically or via a service. Bright
 *     line, checked before anything else.
 *   - An unmapped *required* field forces confidence to 0. We never guess at a
 *     required field, because a wrong value is worse than no submission: it
 *     puts bad data in a PM's vendor record under the vendor's name.
 */

export const CONFIDENCE_THRESHOLD = 0.85;

export interface GateInput {
  readonly fields: readonly FormField[];
  readonly captchaKind: CaptchaKind;
  readonly platformSlug: PlatformSlug | null;
  readonly requiresAccount: boolean;
  readonly requiresPayment: boolean;
  /** Tenant setting: hold the first-ever submission to a new schema. */
  readonly requireFirstSubmissionApproval: boolean;
  /** How many times this schema has already submitted successfully. */
  readonly schemaSuccessCount: number;
  readonly threshold?: number;
}

export function evaluateGate(input: GateInput): GateDecision {
  const threshold = input.threshold ?? CONFIDENCE_THRESHOLD;

  // 1. CAPTCHA. Never solved. Not by us, not by a third-party service.
  if (input.captchaKind !== 'none' && input.captchaKind !== 'unknown') {
    return {
      confidence: 0,
      proceed: false,
      reason: 'captcha_required',
      detail:
        `This form is protected by ${input.captchaKind.replace(/_/g, ' ')}. We never solve ` +
        'CAPTCHAs automatically — the form is filled and waiting for you to complete it.',
      unmappedRequired: [],
    };
  }

  // 2. Terms of service. An unreviewed platform defaults to assisted.
  const stance = stanceFor(input.platformSlug);
  if (stance !== 'allow_unattended') {
    return {
      confidence: 0,
      proceed: false,
      reason: 'tos_restricted',
      detail: assistedLaneReason(input.platformSlug),
      unmappedRequired: [],
    };
  }

  // 3. Account and payment walls.
  if (input.requiresAccount) {
    return {
      confidence: 0,
      proceed: false,
      reason: 'account_required',
      detail:
        'This portal requires an account before an application can be submitted. ' +
        'We do not create accounts automatically.',
      unmappedRequired: [],
    };
  }
  if (input.requiresPayment) {
    return {
      confidence: 0,
      proceed: false,
      reason: 'payment_required',
      detail:
        'This portal charges a vendor fee. We will not incur a charge on your behalf ' +
        'without you confirming it.',
      unmappedRequired: [],
    };
  }

  // 4. Required-field coverage.
  const required = input.fields.filter((f) => f.required && f.type !== 'hidden');
  const unmappedRequired = required
    .filter((f) => !f.mapsTo || f.mapConfidence <= 0)
    .map((f) => f.label || f.name || f.selector);

  if (unmappedRequired.length > 0) {
    return {
      confidence: 0,
      proceed: false,
      reason: 'unmapped_required_field',
      detail:
        `We could not work out what to put in ${unmappedRequired.length} required ` +
        `${unmappedRequired.length === 1 ? 'field' : 'fields'}: ${unmappedRequired.join(', ')}. ` +
        'Rather than guess, the form is filled and waiting for you.',
      unmappedRequired,
    };
  }

  // 5. Confidence = the weakest required field. A form is only as fillable as
  // its worst mandatory field, so averaging would hide exactly the case that
  // matters.
  const confidence =
    required.length === 0 ? 1 : Math.min(...required.map((f) => f.mapConfidence));

  if (confidence < threshold) {
    const weakest = required.reduce((worst, f) =>
      f.mapConfidence < worst.mapConfidence ? f : worst,
    );
    return {
      confidence,
      proceed: false,
      reason: 'low_confidence_mapping',
      detail:
        `Confidence is ${confidence.toFixed(2)}, below the ${threshold} threshold. ` +
        `The least certain required field is "${weakest.label || weakest.selector}".`,
      unmappedRequired: [],
    };
  }

  // 6. First submission to an unproven schema, if the tenant asked for review.
  if (input.requireFirstSubmissionApproval && input.schemaSuccessCount === 0) {
    return {
      confidence,
      proceed: false,
      reason: 'first_submission_approval',
      detail:
        'This is the first submission to this form and your workspace requires a review ' +
        'before the first send to a new form.',
      unmappedRequired: [],
    };
  }

  return {
    confidence,
    proceed: true,
    reason: null,
    detail: `All ${required.length} required fields mapped at ${confidence.toFixed(2)} confidence.`,
    unmappedRequired: [],
  };
}
