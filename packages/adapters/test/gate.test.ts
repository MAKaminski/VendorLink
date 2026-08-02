import { describe, expect, it } from 'vitest';
import { CONFIDENCE_THRESHOLD, evaluateGate, type GateInput } from '../src/gate';
import { DEFAULT_STANCE, isUnattendedAllowed, stanceFor, TOS_ENTRIES } from '../src/tos-policy';
import type { FormField } from '../src/types';

function field(over: Partial<FormField> = {}): FormField {
  return {
    selector: '#company',
    label: 'Company name',
    labelSource: 'label_for',
    name: 'company',
    id: 'company',
    type: 'text',
    required: true,
    options: [],
    maxLength: null,
    mapsTo: 'profile.legal_name',
    mapConfidence: 1,
    mappedBy: 'deterministic',
    notes: null,
    ...over,
  };
}

const base: GateInput = {
  fields: [field()],
  captchaKind: 'none',
  platformSlug: 'custom',
  requiresAccount: false,
  requiresPayment: false,
  requireFirstSubmissionApproval: false,
  schemaSuccessCount: 10,
};

const gate = (over: Partial<GateInput> = {}) => evaluateGate({ ...base, ...over });

describe('CAPTCHA is a bright line', () => {
  it('never proceeds through any CAPTCHA kind', () => {
    for (const kind of ['recaptcha_v2', 'recaptcha_v3', 'hcaptcha', 'turnstile'] as const) {
      const result = gate({ captchaKind: kind });
      expect(result.proceed, kind).toBe(false);
      expect(result.reason, kind).toBe('captcha_required');
    }
  });

  it('says plainly that we do not solve CAPTCHAs', () => {
    expect(gate({ captchaKind: 'recaptcha_v2' }).detail).toMatch(/never solve/i);
  });

  it('checks CAPTCHA before anything else', () => {
    // A form with both a CAPTCHA and unmapped required fields must report the
    // CAPTCHA: it is the reason no amount of mapping work would help.
    const result = gate({
      captchaKind: 'hcaptcha',
      fields: [field({ mapsTo: null, mapConfidence: 0 })],
    });
    expect(result.reason).toBe('captcha_required');
  });

  it('proceeds when no CAPTCHA is present', () => {
    expect(gate({ captchaKind: 'none' }).proceed).toBe(true);
  });

  it('treats an unknown CAPTCHA state as absent rather than blocking', () => {
    // 'unknown' means discovery could not tell; the worker sees the live DOM
    // and re-checks, so blocking here would park every unresolved form.
    expect(gate({ captchaKind: 'unknown' }).proceed).toBe(true);
  });
});

describe('terms of service', () => {
  it('refuses unattended submission to every credentialing platform', () => {
    for (const platform of [
      'netvendor', 'realpage', 'yardi_vendorcafe', 'yardi_vendorshield', 'entrata', 'mri',
    ] as const) {
      const result = gate({ platformSlug: platform });
      expect(result.proceed, platform).toBe(false);
      expect(result.reason, platform).toBe('tos_restricted');
    }
  });

  it('allows the reviewed form builders', () => {
    for (const platform of [
      'custom', 'gravity_forms', 'wpforms', 'jotform', 'typeform',
      'hubspot_form', 'formstack', 'wufoo', 'cognito_forms',
    ] as const) {
      expect(gate({ platformSlug: platform }).proceed, platform).toBe(true);
    }
  });

  it('defaults an unknown platform to the assisted lane', () => {
    // Failing open would mean the first unrecognized credentialing platform
    // gets automated attempts against terms nobody has read.
    expect(DEFAULT_STANCE).toBe('assisted_only');
    expect(isUnattendedAllowed(null)).toBe(false);
    expect(gate({ platformSlug: null }).reason).toBe('tos_restricted');
  });

  it('explains why, naming the review date', () => {
    expect(gate({ platformSlug: 'netvendor' }).detail).toMatch(/Terms reviewed 2026-\d{2}-\d{2}/);
  });

  it('gives every allow_unattended entry a reviewed terms record', () => {
    // §6.5: an adapter cannot ship supportsUnattended without a reviewed entry.
    for (const entry of TOS_ENTRIES) {
      if (entry.stance !== 'allow_unattended') continue;
      expect(entry.reviewedOn, entry.platform).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.rationale.length, entry.platform).toBeGreaterThan(20);
    }
  });

  it('records a stance for every platform it lists', () => {
    for (const entry of TOS_ENTRIES) {
      expect(stanceFor(entry.platform)).toBe(entry.stance);
    }
  });
});

describe('account and payment walls', () => {
  it('refuses to create an account', () => {
    const result = gate({ requiresAccount: true });
    expect(result.reason).toBe('account_required');
    expect(result.detail).toMatch(/do not create accounts/i);
  });

  it('refuses to incur a fee without confirmation', () => {
    const result = gate({ requiresPayment: true });
    expect(result.reason).toBe('payment_required');
    expect(result.detail).toMatch(/will not incur a charge/i);
  });
});

describe('required-field coverage', () => {
  it('forces confidence to zero when a required field is unmapped', () => {
    // Never guess at a required field: a wrong value puts bad data in a PM's
    // vendor record under the vendor's own name.
    const result = gate({
      fields: [field(), field({ selector: '#weird', label: 'Widget code', mapsTo: null, mapConfidence: 0 })],
    });
    expect(result.confidence).toBe(0);
    expect(result.reason).toBe('unmapped_required_field');
    expect(result.unmappedRequired).toEqual(['Widget code']);
  });

  it('names every unmapped required field so the operator can fix them', () => {
    const result = gate({
      fields: [
        field({ selector: '#a', label: 'Field A', mapsTo: null, mapConfidence: 0 }),
        field({ selector: '#b', label: 'Field B', mapsTo: null, mapConfidence: 0 }),
      ],
    });
    expect(result.unmappedRequired).toEqual(['Field A', 'Field B']);
    expect(result.detail).toContain('Field A, Field B');
  });

  it('tolerates an unmapped optional field', () => {
    const result = gate({
      fields: [field(), field({ selector: '#opt', required: false, mapsTo: null, mapConfidence: 0 })],
    });
    expect(result.proceed).toBe(true);
  });

  it('ignores hidden fields entirely', () => {
    const result = gate({
      fields: [field(), field({ selector: '#csrf', type: 'hidden', mapsTo: null, mapConfidence: 0 })],
    });
    expect(result.proceed).toBe(true);
  });
});

describe('confidence is the minimum, not the average', () => {
  it('takes the weakest required field', () => {
    // Averaging would hide the one field that is about to be filled wrongly.
    const result = gate({
      fields: [
        field({ selector: '#a', mapConfidence: 1 }),
        field({ selector: '#b', mapConfidence: 1 }),
        field({ selector: '#c', label: 'Odd one', mapConfidence: 0.4, mappedBy: 'llm' }),
      ],
    });
    expect(result.confidence).toBe(0.4);
    expect(result.proceed).toBe(false);
    expect(result.reason).toBe('low_confidence_mapping');
    expect(result.detail).toContain('Odd one');
  });

  it('proceeds exactly at the threshold', () => {
    const result = gate({ fields: [field({ mapConfidence: CONFIDENCE_THRESHOLD })] });
    expect(result.proceed).toBe(true);
  });

  it('blocks just below the threshold', () => {
    const result = gate({ fields: [field({ mapConfidence: CONFIDENCE_THRESHOLD - 0.01 })] });
    expect(result.proceed).toBe(false);
  });

  it('treats a form with no required fields as fully confident', () => {
    const result = gate({ fields: [field({ required: false, mapConfidence: 0.1 })] });
    expect(result.confidence).toBe(1);
    expect(result.proceed).toBe(true);
  });
});

describe('first-submission approval', () => {
  it('holds the first submission when the tenant asked for review', () => {
    const result = gate({ requireFirstSubmissionApproval: true, schemaSuccessCount: 0 });
    expect(result.proceed).toBe(false);
    expect(result.reason).toBe('first_submission_approval');
  });

  it('does not hold once the schema has succeeded before', () => {
    expect(
      gate({ requireFirstSubmissionApproval: true, schemaSuccessCount: 6 }).proceed,
    ).toBe(true);
  });

  it('does not hold when the tenant has not opted in', () => {
    expect(
      gate({ requireFirstSubmissionApproval: false, schemaSuccessCount: 0 }).proceed,
    ).toBe(true);
  });
});
