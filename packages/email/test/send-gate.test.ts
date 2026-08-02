import { describe, expect, it } from 'vitest';
import { dailyCapFor, evaluateSendGate, failureClassFor, type SendGateInput } from '../src/send-gate';

/**
 * The send gate is the difference between this product and a spam cannon, so
 * every rung is asserted explicitly — including the order they fire in.
 */

const NOW = new Date('2026-08-02T12:00:00Z');

const base: SendGateInput = {
  sendingDomainVerified: true,
  sendingFrozenAt: null,
  recipient: 'vendors@oakwood.example',
  recipientSuppressed: false,
  recipientHardBounced: false,
  sentToday: 0,
  warmupStartedOn: new Date('2026-01-01T00:00:00Z'),
  now: NOW,
};

const gate = (over: Partial<SendGateInput> = {}) => evaluateSendGate({ ...base, ...over });

describe('warm-up ramp', () => {
  it('caps a brand new domain at 25/day for the first week', () => {
    expect(dailyCapFor(new Date('2026-08-01T00:00:00Z'), NOW)).toBe(25);
    expect(dailyCapFor(new Date('2026-07-27T00:00:00Z'), NOW)).toBe(25);
  });

  it('raises to 75/day in week two', () => {
    expect(dailyCapFor(new Date('2026-07-25T00:00:00Z'), NOW)).toBe(75);
  });

  it('reaches 200/day after two weeks', () => {
    expect(dailyCapFor(new Date('2026-07-01T00:00:00Z'), NOW)).toBe(200);
  });

  it('treats an unknown warm-up start as brand new', () => {
    // Failing open here would let an unwarmed domain send 200 on day one.
    expect(dailyCapFor(null, NOW)).toBe(25);
  });
});

describe('gate outcomes', () => {
  it('allows a healthy send and reports the remaining budget', () => {
    const result = gate({ sentToday: 10 });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.dailyCap).toBe(200);
      expect(result.remainingToday).toBe(190);
    }
  });

  it('blocks when there is no recipient', () => {
    const result = gate({ recipient: null });
    expect(result).toMatchObject({ allowed: false, reason: 'no_recipient' });
  });

  it('blocks when the sending domain is unverified', () => {
    expect(gate({ sendingDomainVerified: false })).toMatchObject({
      allowed: false,
      reason: 'domain_not_verified',
    });
  });

  it('blocks a frozen tenant', () => {
    expect(gate({ sendingFrozenAt: NOW })).toMatchObject({
      allowed: false,
      reason: 'tenant_frozen',
    });
  });

  it('blocks a suppressed recipient', () => {
    expect(gate({ recipientSuppressed: true })).toMatchObject({
      allowed: false,
      reason: 'recipient_suppressed',
    });
  });

  it('blocks a hard-bounced recipient', () => {
    expect(gate({ recipientHardBounced: true })).toMatchObject({
      allowed: false,
      reason: 'recipient_hard_bounced',
    });
  });

  it('blocks at the daily cap and says when to retry', () => {
    const result = gate({ sentToday: 200 });
    expect(result).toMatchObject({ allowed: false, reason: 'daily_cap_reached' });
    if (!result.allowed) {
      expect(result.retryAfter?.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    }
  });

  it('allows the very last message under the cap', () => {
    expect(gate({ sentToday: 199 }).allowed).toBe(true);
  });
});

describe('precedence', () => {
  it('reports a freeze ahead of an unverified domain', () => {
    // A frozen tenant must not be told "just verify your domain" — that would
    // send them off to fix the wrong thing.
    expect(gate({ sendingFrozenAt: NOW, sendingDomainVerified: false })).toMatchObject({
      reason: 'tenant_frozen',
    });
  });

  it('reports suppression ahead of the rate limit', () => {
    // "Never" and "not today" are different answers; the permanent one wins.
    expect(gate({ recipientSuppressed: true, sentToday: 999 })).toMatchObject({
      reason: 'recipient_suppressed',
    });
  });

  it('reports a missing recipient ahead of everything else', () => {
    expect(
      gate({
        recipient: null,
        sendingFrozenAt: NOW,
        sendingDomainVerified: false,
        sentToday: 999,
      }),
    ).toMatchObject({ reason: 'no_recipient' });
  });

  it('reports a hard bounce ahead of generic suppression', () => {
    expect(gate({ recipientHardBounced: true, recipientSuppressed: true })).toMatchObject({
      reason: 'recipient_hard_bounced',
    });
  });
});

describe('failure classes', () => {
  it('maps every block reason to a task failure class', () => {
    const reasons = [
      'domain_not_verified', 'tenant_frozen', 'recipient_suppressed',
      'recipient_hard_bounced', 'daily_cap_reached', 'no_recipient',
    ] as const;
    for (const reason of reasons) {
      expect(failureClassFor(reason), reason).toBeTruthy();
    }
  });

  it('distinguishes a rate limit from a suppression', () => {
    expect(failureClassFor('daily_cap_reached')).toBe('send_blocked_rate_limit');
    expect(failureClassFor('recipient_suppressed')).toBe('send_blocked_suppressed');
  });
});
