/**
 * The send gate.
 *
 * Every check in §5.5 that stands between this product and a spam cannon runs
 * here, in one place, before a message is handed to a provider. It is a pure
 * function over already-fetched state so it can be exhaustively tested, and it
 * returns *why* it blocked so the UI and the task's failure_class agree.
 *
 * Order matters. Suppression and verification are checked before the rate
 * limit, because "you may never mail this address" is a different answer from
 * "not today".
 */

export type SendBlockReason =
  | 'domain_not_verified'
  | 'tenant_frozen'
  | 'recipient_suppressed'
  | 'recipient_hard_bounced'
  | 'daily_cap_reached'
  | 'no_recipient';

export interface SendGateInput {
  /** Tenant's verified sending domain, or null if not yet verified. */
  readonly sendingDomainVerified: boolean;
  /** Set when a complaint froze the tenant pending review. */
  readonly sendingFrozenAt: Date | null;
  readonly recipient: string | null;
  readonly recipientSuppressed: boolean;
  readonly recipientHardBounced: boolean;
  /** Messages already sent by this tenant today. */
  readonly sentToday: number;
  /** When the tenant's domain first became eligible to send. */
  readonly warmupStartedOn: Date | null;
  readonly now: Date;
}

export type SendGateResult =
  | { allowed: true; dailyCap: number; remainingToday: number }
  | { allowed: false; reason: SendBlockReason; detail: string; retryAfter?: Date };

/**
 * §5.5's warm-up ramp: 25/day in week 1, 75/day in week 2, 200/day after.
 *
 * Enforced here rather than in the UI because the governor has to hold for
 * Batch Connect and for worker retries, neither of which goes through a form.
 */
export function dailyCapFor(warmupStartedOn: Date | null, now: Date): number {
  if (!warmupStartedOn) return 25;
  const days = Math.floor((now.getTime() - warmupStartedOn.getTime()) / 86_400_000);
  if (days < 7) return 25;
  if (days < 14) return 75;
  return 200;
}

/** Start of the next UTC day — when a rate-limited send becomes possible. */
function nextUtcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

export function evaluateSendGate(input: SendGateInput): SendGateResult {
  if (!input.recipient) {
    return {
      allowed: false,
      reason: 'no_recipient',
      detail: 'No deliverable contact was resolved for this company.',
    };
  }

  // A complaint freezes the tenant entirely — that is a trust problem, not a
  // per-recipient one, so it outranks everything except having no recipient.
  if (input.sendingFrozenAt) {
    return {
      allowed: false,
      reason: 'tenant_frozen',
      detail:
        'Sending is frozen for this workspace after a spam complaint. ' +
        'Contact support to have it reviewed.',
    };
  }

  if (!input.sendingDomainVerified) {
    return {
      allowed: false,
      reason: 'domain_not_verified',
      detail:
        'Your sending domain is not verified yet. Add the SPF, DKIM and DMARC ' +
        'records shown in Settings, then try again.',
    };
  }

  if (input.recipientHardBounced) {
    return {
      allowed: false,
      reason: 'recipient_hard_bounced',
      detail: `${input.recipient} previously hard-bounced and has been suppressed globally.`,
    };
  }

  if (input.recipientSuppressed) {
    return {
      allowed: false,
      reason: 'recipient_suppressed',
      detail: `${input.recipient} is on the global suppression list.`,
    };
  }

  const dailyCap = dailyCapFor(input.warmupStartedOn, input.now);
  if (input.sentToday >= dailyCap) {
    return {
      allowed: false,
      reason: 'daily_cap_reached',
      detail:
        `You have sent ${input.sentToday} of ${dailyCap} messages allowed today. ` +
        'New sending domains ramp up over two weeks to protect deliverability.',
      retryAfter: nextUtcMidnight(input.now),
    };
  }

  return { allowed: true, dailyCap, remainingToday: dailyCap - input.sentToday };
}

/** Maps a block reason onto the task's `failure_class`. */
export function failureClassFor(reason: SendBlockReason): string {
  switch (reason) {
    case 'domain_not_verified':
    case 'tenant_frozen':
      return 'send_blocked_unverified_domain';
    case 'daily_cap_reached':
      return 'send_blocked_rate_limit';
    case 'recipient_suppressed':
    case 'recipient_hard_bounced':
      return 'send_blocked_suppressed';
    case 'no_recipient':
      return 'no_contact_found';
  }
}
