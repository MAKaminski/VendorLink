import { describe, expect, it } from 'vitest';
import {
  COMPLETENESS_NAG_THRESHOLD,
  computeCompleteness,
  shouldNag,
} from '../src/completeness';
import { vendorProfileSchema } from '../src/profile';
import { completeProfile } from './fixtures/profile';

describe('completeness', () => {
  it('scores a fully populated profile at 100', () => {
    expect(computeCompleteness(completeProfile()).score).toBe(100);
  });

  it('reports an empty profile as 0 with everything missing', () => {
    const empty = completeProfile({
      legal_name: '',
      entity_type: null,
      ein: null,
      ein_last4: null,
      address_line1: null,
      city: null,
      state: null,
      postal: null,
      primary_contact_name: null,
      primary_contact_email: null,
      primary_contact_phone: null,
      website: null,
      hours_of_operation: null,
      offers_after_hours: true,
      after_hours_phone: null,
      hourly_rate_cents: null,
      payment_terms: null,
      capability_statement: null,
      trades: [],
      service_areas: [],
      licenses: [],
      insurance: [],
      documents: [],
    });
    const result = computeCompleteness(empty);
    expect(result.score).toBe(0);
    expect(result.satisfied).toHaveLength(0);
    expect(result.missing.length).toBeGreaterThan(10);
  });

  it('keeps a profile missing its W-9 below the nag threshold', () => {
    // The weighting exists for this reason: documents are what PM applications
    // hard-require, so their absence has to be visible in the number.
    const noW9 = completeProfile({
      documents: completeProfile().documents.filter((d) => d.kind !== 'W9'),
    });
    const result = computeCompleteness(noW9);
    expect(result.score).toBeLessThan(COMPLETENESS_NAG_THRESHOLD);
    expect(shouldNag(result.score)).toBe(true);
  });

  it('keeps a profile missing its COI below the nag threshold', () => {
    const noCoi = completeProfile({
      documents: completeProfile().documents.filter((d) => d.kind !== 'COI'),
    });
    expect(computeCompleteness(noCoi).score).toBeLessThan(COMPLETENESS_NAG_THRESHOLD);
  });

  it('names the missing item and where to fix it', () => {
    const noCoi = completeProfile({
      documents: completeProfile().documents.filter((d) => d.kind !== 'COI'),
    });
    const missing = computeCompleteness(noCoi).missing.find((m) => m.key === 'doc_coi');
    expect(missing).toBeDefined();
    expect(missing?.label).toMatch(/certificate of insurance/i);
    expect(missing?.href).toBe('/onboarding/documents');
  });

  it('flags blocking gaps separately from cosmetic ones', () => {
    const result = computeCompleteness(
      completeProfile({ website: null, capability_statement: null, licenses: [] }),
    );
    // None of those three block a submission, so nothing should be a blocker.
    expect(result.blockers).toHaveLength(0);
    expect(result.missing.map((m) => m.key).sort()).toEqual(
      ['capability_statement', 'licenses', 'website'].sort(),
    );
  });

  it('treats a superseded document as not counting', () => {
    const stale = completeProfile({
      documents: completeProfile().documents.map((d) =>
        d.kind === 'COI' ? { ...d, is_current: false } : d,
      ),
    });
    expect(computeCompleteness(stale).blockers.map((b) => b.key)).toContain('doc_coi');
  });

  it('requires a primary trade, not just any trade', () => {
    const noPrimary = completeProfile({
      trades: [{ trade_slug: 'landscaping', is_primary: false }],
    });
    expect(computeCompleteness(noPrimary).blockers.map((b) => b.key)).toContain('trades');
  });

  it('requires GL limits, not merely a GL policy row', () => {
    const noLimits = completeProfile({
      insurance: [
        {
          policy_type: 'GL',
          carrier: 'Some Carrier',
          policy_number: 'X-1',
          each_occurrence_cents: null,
          aggregate_cents: null,
          waiver_of_subrogation: false,
          primary_and_noncontributory: false,
        },
      ],
    });
    expect(computeCompleteness(noLimits).blockers.map((b) => b.key)).toContain('insurance_gl');
  });

  it('only demands an after-hours phone when after-hours is offered', () => {
    const noAfterHours = completeProfile({ offers_after_hours: false, after_hours_phone: null });
    expect(computeCompleteness(noAfterHours).missing.map((m) => m.key)).not.toContain('after_hours');
  });

  it('never returns a score outside 0-100', () => {
    for (const profile of [completeProfile(), completeProfile({ documents: [], trades: [] })]) {
      const { score } = computeCompleteness(profile);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe('profile schema', () => {
  it('accepts the reference profile', () => {
    expect(() => vendorProfileSchema.parse(completeProfile())).not.toThrow();
  });

  it('rejects a malformed EIN', () => {
    const result = vendorProfileSchema.safeParse(completeProfile({ ein: '123' }));
    expect(result.success).toBe(false);
  });

  it('rejects a non-email primary contact address', () => {
    const result = vendorProfileSchema.safeParse(
      completeProfile({ primary_contact_email: 'not-an-email' }),
    );
    expect(result.success).toBe(false);
  });
});
