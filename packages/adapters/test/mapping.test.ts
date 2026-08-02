import { describe, expect, it } from 'vitest';
import { isSecretPath, matchDeterministic, MAPPING_RULES } from '../src/mapping-rules';
import { redactionMarkerFor, resolveFieldValue } from '../src/resolve-value';
import type { FormField } from '../src/types';
import { completeProfile } from './fixtures/profile';

function field(over: Partial<FormField> = {}): FormField {
  return {
    selector: '#f',
    label: '',
    labelSource: 'label_for',
    name: null,
    id: null,
    type: 'text',
    required: false,
    options: [],
    maxLength: null,
    mapsTo: null,
    mapConfidence: 0,
    mappedBy: null,
    notes: null,
    ...over,
  };
}

describe('deterministic mapping', () => {
  const cases: Array<[label: string, path: string]> = [
    ['Company Name', 'profile.legal_name'],
    ['Business Name', 'profile.legal_name'],
    ['Legal Business Name', 'profile.legal_name'],
    ['Firm Name', 'profile.legal_name'],
    ['DBA', 'profile.dba'],
    ['Doing Business As', 'profile.dba'],
    ['Federal Tax ID', 'profile.ein'],
    ['EIN', 'profile.ein'],
    ['TIN', 'profile.ein'],
    ['Tax ID Number', 'profile.ein'],
    ['Entity Type', 'profile.entity_type'],
    ['Website', 'profile.website'],
    ['Year Established', 'profile.year_founded'],
    ['Number of Employees', 'profile.employee_count'],

    ['Contact Person', 'profile.primary_contact_name'],
    ['Contact Name', 'profile.primary_contact_name'],
    ['Job Title', 'profile.primary_contact_title'],
    ['Email Address', 'profile.primary_contact_email'],
    ['Business Email', 'profile.primary_contact_email'],
    ['Dispatch Email', 'profile.dispatch_email'],
    ['Business Phone', 'profile.primary_contact_phone'],
    ['Telephone', 'profile.primary_contact_phone'],
    ['After Hours Phone', 'profile.after_hours_phone'],
    ['Emergency Contact Number', 'profile.after_hours_phone'],

    ['Street Address', 'profile.address_line1'],
    ['Address Line 2', 'profile.address_line2'],
    ['Suite', 'profile.address_line2'],
    ['City', 'profile.city'],
    ['State', 'profile.state'],
    ['Zip Code', 'profile.postal'],
    ['County', 'profile.county'],

    ['Trade', 'profile.trades'],
    ['Services Provided', 'profile.trades'],
    ['Scope of Work', 'profile.trades'],
    ['Service Area', 'profile.service_area_summary'],
    ['Areas Served', 'profile.service_area_summary'],

    ['License Number', 'profile.license_number'],
    ['Contractor License Number', 'profile.license_number'],
    ['License Expiration', 'profile.license_expires_on'],

    ['General Liability Each Occurrence', 'profile.gl_each_occurrence'],
    ['GL Aggregate', 'profile.gl_aggregate'],
    ['Auto Liability Limit', 'profile.auto_limit'],
    ['Umbrella Coverage', 'profile.umbrella_limit'],
    ["Workers' Compensation", 'profile.has_workers_comp'],
    ['Insurance Carrier', 'profile.insurance_carrier'],
    ['Policy Number', 'profile.insurance_policy_number'],
    ['Agent Email', 'profile.agent_email'],
    ['Additional Insured', 'profile.additional_insured_text'],
    ['Waiver of Subrogation', 'profile.waiver_of_subrogation'],

    ['Hourly Rate', 'profile.hourly_rate'],
    ['Trip Charge', 'profile.trip_fee'],
    ['Dispatch Fee', 'profile.dispatch_fee'],
    ['Minimum Invoice', 'profile.minimum_invoice'],
    ['Payment Terms', 'profile.payment_terms'],
    ['Warranty', 'profile.warranty_terms'],

    ['Response Time', 'profile.response_time_hours'],
    ['Background Check', 'profile.background_check_consent'],

    ['W-9', 'document.W9'],
    ['W9 Form', 'document.W9'],
    ['Certificate of Insurance', 'document.COI'],
    ['COI', 'document.COI'],
    ['Insurance Certificate', 'document.COI'],
    ['Price Book', 'document.PRICEBOOK'],
    ['Rate Sheet', 'document.PRICEBOOK'],
    ['Capability Statement', 'document.CAPABILITY_STATEMENT'],
    ['Safety Manual', 'document.SAFETY_MANUAL'],
    ['References', 'document.REFERENCES'],

    ['Describe your services', 'generated.services_description'],
    ['Why do you want to work with us?', 'generated.why_work_with_us'],
  ];

  for (const [label, path] of cases) {
    it(`maps "${label}" to ${path}`, () => {
      expect(matchDeterministic(label)?.path).toBe(path);
    });
  }

  it('returns confidence 1.0 or nothing at all', () => {
    // A partial deterministic match is a contradiction; uncertainty belongs to
    // the LLM stage where it can be scored and refused.
    const match = matchDeterministic('Company Name');
    expect(match?.confidence).toBe(1);
    expect(matchDeterministic('Widget flange code')).toBeNull();
  });

  it('leaves genuinely unknown labels unmapped', () => {
    for (const label of ['Sprocket ID', 'Preferred badge colour', '', '   ']) {
      expect(matchDeterministic(label), label).toBeNull();
    }
  });

  it('never maps an unqualified ID field to the EIN', () => {
    // Regression: every qualifier in the EIN pattern was optional, so a bare
    // "ID" matched. That would have typed the vendor's EIN — a secret — into
    // an unrelated field on someone else's form.
    for (const label of [
      'Sprocket ID', 'ID', 'Property ID', 'Unit ID', 'Reference ID',
      'Employee ID Badge', 'Customer Id',
    ]) {
      expect(matchDeterministic(label)?.path, label).not.toBe('profile.ein');
    }
  });

  it('still maps the genuine tax-ID phrasings', () => {
    for (const label of [
      'EIN', 'TIN', 'Federal Tax ID', 'Tax ID', 'Taxpayer ID',
      'Employer Identification Number', 'Federal ID Number',
    ]) {
      expect(matchDeterministic(label)?.path, label).toBe('profile.ein');
    }
  });
});

describe('rule ordering', () => {
  it('does not let a loose rule swallow a specific one', () => {
    // "After Hours Phone" must not fall into the generic /phone/ rule.
    expect(matchDeterministic('After Hours Phone')?.path).toBe('profile.after_hours_phone');
    expect(matchDeterministic('Agent Phone')?.path).toBe('profile.agent_phone');
  });

  it('distinguishes GL each-occurrence from aggregate', () => {
    expect(matchDeterministic('General Liability Each Occurrence')?.path).toBe(
      'profile.gl_each_occurrence',
    );
    expect(matchDeterministic('General Liability Aggregate')?.path).toBe('profile.gl_aggregate');
  });

  it('does not map an insurance carrier name to a limit', () => {
    expect(matchDeterministic('General Liability Carrier')?.path).not.toBe(
      'profile.gl_each_occurrence',
    );
  });

  it('does not map "License State" to the business address state', () => {
    expect(matchDeterministic('License State')?.path).toBe('profile.license_state');
    expect(matchDeterministic('State')?.path).toBe('profile.state');
  });

  it('does not map a contact email label to the company name', () => {
    expect(matchDeterministic('Contact Email')?.path).toBe('profile.primary_contact_email');
  });

  it('does not map "Counties Served" to the business county', () => {
    expect(matchDeterministic('Counties Served')?.path).toBe('profile.service_area_summary');
  });
});

describe('secret handling', () => {
  it('marks EIN and bank details as secret', () => {
    expect(isSecretPath('profile.ein')).toBe(true);
    expect(isSecretPath('profile.bank_details')).toBe(true);
    expect(isSecretPath('profile.remit_to_address')).toBe(true);
  });

  it('does not mark ordinary fields secret', () => {
    expect(isSecretPath('profile.legal_name')).toBe(false);
  });

  it('produces a redaction marker that names the path but not the value', () => {
    const marker = redactionMarkerFor('profile.ein');
    expect(marker).toContain('redacted');
    expect(marker).toContain('profile.ein');
    expect(marker).not.toMatch(/\d{2}-\d{7}/);
  });
});

describe('value resolution', () => {
  const context = { profile: completeProfile() };

  it('fills a plain text field', () => {
    const result = resolveFieldValue(
      field({ mapsTo: 'profile.legal_name' }),
      null,
      context,
    );
    expect(result?.value).toBe('Peachtree Grounds & Landscape LLC');
  });

  it('formats a phone number', () => {
    const result = resolveFieldValue(
      field({ mapsTo: 'profile.primary_contact_phone', type: 'tel' }),
      { transform: 'phone' },
      context,
    );
    expect(result?.value).toBe('404-555-0142');
  });

  it('strips punctuation for a 10-character-limited phone field', () => {
    const result = resolveFieldValue(
      field({ mapsTo: 'profile.primary_contact_phone', maxLength: 10 }),
      { transform: 'phone' },
      context,
    );
    expect(result?.value).toBe('4045550142');
  });

  it('renders currency with a symbol for a text field', () => {
    const result = resolveFieldValue(
      field({ mapsTo: 'profile.hourly_rate' }),
      { transform: 'currency_dollars' },
      context,
    );
    expect(result?.value).toBe('85.00');
  });

  it('renders currency without a symbol for a number field', () => {
    // A number input rejects "$85.00" outright.
    const result = resolveFieldValue(
      field({ mapsTo: 'profile.hourly_rate', type: 'number' }),
      { transform: 'currency_dollars' },
      context,
    );
    expect(result?.value).toBe('85.00');
  });

  it('renders a date in US format for a text field and ISO for a date input', () => {
    expect(
      resolveFieldValue(
        field({ mapsTo: 'profile.insurance_expires_on' }),
        { transform: 'date_us' },
        context,
      )?.value,
    ).toBe('01/01/2027');
    expect(
      resolveFieldValue(
        field({ mapsTo: 'profile.insurance_expires_on', type: 'date' }),
        { transform: 'date_us' },
        context,
      )?.value,
    ).toBe('2027-01-01');
  });

  it('selects the matching option from a state dropdown', () => {
    const result = resolveFieldValue(
      field({
        mapsTo: 'profile.state',
        type: 'select',
        options: [
          { value: 'FL', label: 'Florida' },
          { value: 'GA', label: 'Georgia' },
        ],
      }),
      { transform: 'state_code' },
      context,
    );
    expect(result?.value).toBe('GA');
  });

  it("matches a trade against the form's own vocabulary", () => {
    const result = resolveFieldValue(
      field({
        mapsTo: 'profile.trades',
        type: 'select',
        options: [
          { value: 'hvac', label: 'Heating & Air Conditioning' },
          { value: 'land', label: 'Landscaping / Grounds' },
          { value: 'plumb', label: 'Plumbing' },
        ],
      }),
      { transform: 'trade_options' },
      context,
    );
    expect(result?.value).toBe('land');
  });

  it('returns null when no option matches, rather than picking one', () => {
    const result = resolveFieldValue(
      field({
        mapsTo: 'profile.trades',
        type: 'select',
        options: [{ value: 'elev', label: 'Elevator Maintenance' }],
      }),
      { transform: 'trade_options' },
      context,
    );
    expect(result).toBeNull();
  });

  it('renders a boolean as Yes/No', () => {
    const result = resolveFieldValue(
      field({ mapsTo: 'profile.has_workers_comp' }),
      { transform: 'boolean_yes_no' },
      context,
    );
    expect(result?.value).toBe('Yes');
  });

  it('resolves a checkbox to true/false', () => {
    const result = resolveFieldValue(
      field({ mapsTo: 'profile.accepts_ach', type: 'checkbox' }),
      null,
      context,
    );
    expect(result?.value).toBe('true');
  });

  it('flags a secret value so the audit row can redact it', () => {
    const result = resolveFieldValue(field({ mapsTo: 'profile.ein' }), null, context);
    expect(result?.secret).toBe(true);
    expect(result?.value).toBe('58-1234567');
  });

  it('returns null for a path the profile has nothing for', () => {
    const empty = { profile: completeProfile({ duns: null }) };
    expect(resolveFieldValue(field({ mapsTo: 'profile.duns' }), null, empty)).toBeNull();
  });

  it('truncates a generated answer to the field maxlength', () => {
    const result = resolveFieldValue(
      field({ mapsTo: 'generated.services_description', type: 'textarea', maxLength: 30 }),
      null,
      {
        profile: completeProfile(),
        generated: new Map([
          ['services_description', 'A very long description of every service we offer statewide'],
        ]),
      },
    );
    expect(result?.value.length).toBeLessThanOrEqual(30);
  });

  it('returns null for a generated field with no cached answer', () => {
    expect(
      resolveFieldValue(field({ mapsTo: 'generated.why_work_with_us' }), null, context),
    ).toBeNull();
  });
});

describe('rules table integrity', () => {
  it('has a usable number of rules', () => {
    expect(MAPPING_RULES.length).toBeGreaterThan(60);
  });

  it('gives every rule a canonical path prefix', () => {
    for (const rule of MAPPING_RULES) {
      expect(rule.path, rule.path).toMatch(/^(profile|document|generated)\./);
    }
  });

  it('uses case-insensitive patterns throughout', () => {
    // Form labels are written however the PM felt that day.
    for (const rule of MAPPING_RULES) {
      expect(rule.pattern.flags, String(rule.pattern)).toContain('i');
    }
  });
});
