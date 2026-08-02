import type { VendorProfile } from '../../src/profile';

/**
 * Builder for a complete, valid profile that tests then subtract from.
 *
 * Test fixture only — never imported by `src/`. Building "complete" and
 * removing pieces makes each test state exactly which field it is about.
 */
export function completeProfile(overrides: Partial<VendorProfile> = {}): VendorProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    tenant_id: '00000000-0000-4000-8000-00000000000a',
    legal_name: 'Peachtree Grounds & Landscape LLC',
    dba: 'Peachtree Grounds',
    entity_type: 'llc',
    ein: '58-1234567',
    ein_last4: '4567',
    duns: null,
    website: 'https://peachtreegrounds.example',
    year_founded: 2011,
    employee_count: 24,

    primary_contact_name: 'Dana Whitfield',
    primary_contact_title: 'Owner',
    primary_contact_email: 'dana@peachtreegrounds.example',
    primary_contact_phone: '404-555-0142',
    after_hours_phone: '404-555-0199',
    dispatch_email: 'dispatch@peachtreegrounds.example',

    address_line1: '1180 Marietta St NW',
    address_line2: 'Suite 210',
    city: 'Atlanta',
    state: 'GA',
    postal: '30318',
    county: 'Fulton',

    hours_of_operation: {
      mon: { open: '07:00', close: '17:00', closed: false },
      tue: { open: '07:00', close: '17:00', closed: false },
      wed: { open: '07:00', close: '17:00', closed: false },
      thu: { open: '07:00', close: '17:00', closed: false },
      fri: { open: '07:00', close: '17:00', closed: false },
    },
    offers_after_hours: true,
    after_hours_fee_cents: 15_000,

    hourly_rate_cents: 8_500,
    dispatch_fee_cents: 7_500,
    trip_fee_cents: 6_500,
    minimum_invoice_cents: 15_000,

    warranty_terms: '90 days on labor, manufacturer warranty on parts.',
    payment_terms: 'Net 30',
    accepts_ach: true,
    remit_to: {
      payee_name: 'Peachtree Grounds & Landscape LLC',
      address_line1: '1180 Marietta St NW',
      address_line2: 'Suite 210',
      city: 'Atlanta',
      state: 'GA',
      postal: '30318',
    },

    w9_signed_date: '2026-01-15',
    background_check_consent: true,
    response_time_hours: 4,
    capability_statement:
      'Full-service commercial grounds maintenance across metro Atlanta: mowing, ' +
      'irrigation, seasonal color, tree care and storm cleanup for multifamily portfolios.',

    completeness_score: 0,

    trades: [
      { trade_slug: 'landscaping', is_primary: true, naics_code: '561730' },
      { trade_slug: 'snow', is_primary: false },
    ],
    service_areas: [
      {
        kind: 'radius',
        center_lat: 33.749,
        center_lng: -84.388,
        radius_miles: 45,
        zips: [],
        counties: [],
        states: [],
      },
    ],
    licenses: [
      {
        license_type: 'Landscape Contractor',
        license_number: 'GA-LC-88421',
        issuing_state: 'GA',
        issuing_authority: 'Georgia Secretary of State',
        issued_on: '2019-03-01',
        expires_on: '2027-03-01',
      },
    ],
    insurance: [
      {
        policy_type: 'GL',
        carrier: 'Cincinnati Insurance',
        policy_number: 'GL-4482119',
        each_occurrence_cents: 100_000_000,
        aggregate_cents: 200_000_000,
        effective_on: '2026-01-01',
        expires_on: '2027-01-01',
        waiver_of_subrogation: true,
        primary_and_noncontributory: true,
        agent_name: 'Kim Alvarez',
        agent_email: 'kalvarez@brokerage.example',
        agent_phone: '404-555-0110',
      },
      {
        policy_type: 'WC',
        carrier: 'Cincinnati Insurance',
        policy_number: 'WC-4482120',
        each_occurrence_cents: 100_000_000,
        aggregate_cents: 100_000_000,
        effective_on: '2026-01-01',
        expires_on: '2027-01-01',
        waiver_of_subrogation: true,
        primary_and_noncontributory: false,
      },
    ],
    documents: [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        kind: 'W9',
        label: 'W-9 (signed 2026)',
        r2_key: 'tenants/t/documents/d1/w9.pdf',
        mime: 'application/pdf',
        bytes: 84_211,
        sha256: 'a'.repeat(64),
        page_count: 1,
        is_current: true,
      },
      {
        id: '00000000-0000-4000-8000-0000000000d2',
        kind: 'COI',
        label: 'COI 2026',
        r2_key: 'tenants/t/documents/d2/coi.pdf',
        mime: 'application/pdf',
        bytes: 121_004,
        sha256: 'b'.repeat(64),
        page_count: 2,
        expires_on: '2027-01-01',
        is_current: true,
      },
    ],
    ...overrides,
  };
}
