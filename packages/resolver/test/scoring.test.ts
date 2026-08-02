import { describe, expect, it } from 'vitest';
import { apexDomain, scoreContact, SEND_THRESHOLD, type ScoreInput } from '../src/scoring';

const base: Omit<ScoreInput, 'email'> = {
  sourceUrl: 'https://oakwood.example/contact',
  pageH1: 'Contact Us',
  footerOnly: false,
  companyDomain: 'oakwood.example',
  mxValid: true,
};

const score = (email: string, over: Partial<ScoreInput> = {}) =>
  scoreContact({ ...base, email, ...over });

describe('tier assignment', () => {
  it('puts vendor inboxes in tier 1', () => {
    for (const local of [
      'vendors', 'vendor', 'vendorrelations', 'vendor-relations',
      'vendormanagement', 'vendoronboarding', 'newvendor',
      'vendorapplication', 'vendorcompliance',
    ]) {
      const result = score(`${local}@oakwood.example`);
      // 100 base + 10 same-domain, clamped to 100.
      expect(result.score, local).toBe(100);
      expect(result.kind, local).toBe('vendor_onboarding');
    }
  });

  it('puts supplier and contractor inboxes in tier 2', () => {
    expect(score('suppliers@oakwood.example').breakdown[0]?.delta).toBe(90);
    expect(score('contractors@oakwood.example').breakdown[0]?.delta).toBe(90);
    expect(score('subcontractors@oakwood.example').breakdown[0]?.delta).toBe(90);
  });

  it('puts procurement in tier 3 and maintenance in tier 4', () => {
    expect(score('procurement@oakwood.example').breakdown[0]?.delta).toBe(80);
    expect(score('maintenance@oakwood.example').breakdown[0]?.delta).toBe(70);
    expect(score('workorders@oakwood.example').breakdown[0]?.delta).toBe(70);
  });

  it('puts accounts payable in tier 5 and general inboxes in tier 7', () => {
    expect(score('ap@oakwood.example').breakdown[0]?.delta).toBe(55);
    expect(score('info@oakwood.example').breakdown[0]?.delta).toBe(35);
    expect(score('hello@oakwood.example').breakdown[0]?.delta).toBe(35);
  });

  it('scores a named human with a relevant title at tier 6', () => {
    const result = score('mwebb@oakwood.example', { title: 'Director of Vendor Relations' });
    expect(result.breakdown[0]?.delta).toBe(65);
  });

  it('does not promote a named human whose title is irrelevant', () => {
    const result = score('jsmith@oakwood.example', { title: 'Leasing Consultant' });
    expect(result.breakdown[0]?.delta).toBe(20);
  });
});

describe('tier 8 exclusions', () => {
  it('excludes wrong-department inboxes outright', () => {
    for (const local of [
      'sales', 'leasing', 'marketing', 'careers', 'hr', 'jobs',
      'press', 'legal', 'privacy', 'webmaster', 'noreply', 'no-reply',
    ]) {
      const result = score(`${local}@oakwood.example`);
      expect(result.excluded, local).toBe(true);
      expect(result.score, local).toBe(0);
    }
  });

  it('excludes an address that hard-bounced for any tenant', () => {
    // Cross-tenant learning: one tenant's bounce protects every other tenant.
    const result = score('vendors@oakwood.example', { signals: ['hard_bounce'] });
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(0);
  });
});

describe('modifiers', () => {
  it('adds 25 for a vendor-context page', () => {
    const plain = score('info@oakwood.example');
    const onVendorPage = score('info@oakwood.example', {
      sourceUrl: 'https://oakwood.example/become-a-vendor',
    });
    expect(onVendorPage.score - plain.score).toBe(25);
  });

  it('reads vendor context from the h1 as well as the URL', () => {
    const result = score('info@oakwood.example', { pageH1: 'Become a Vendor' });
    expect(result.breakdown.some((b) => b.delta === 25)).toBe(true);
  });

  // Matched on the reason rather than the delta: an unrecognized inbox also
  // has a base of 20, so a bare delta check cannot tell the two apart.
  const hasTradeBonus = (result: { breakdown: readonly { reason: string }[] }) =>
    result.breakdown.some((b) => /trade token/i.test(b.reason));

  it('adds 20 when a trade token matches the primary trade', () => {
    const result = score('hvac@oakwood.example', { trade: 'hvac' });
    expect(hasTradeBonus(result)).toBe(true);
    expect(result.breakdown.find((b) => /trade token/i.test(b.reason))?.delta).toBe(20);
  });

  it('does not add a trade bonus for a different trade', () => {
    expect(hasTradeBonus(score('hvac@oakwood.example', { trade: 'landscaping' }))).toBe(false);
  });

  it('adds 15 when a market token matches', () => {
    const result = score('atlantavendors@oakwood.example', { market: 'Atlanta' });
    expect(result.breakdown.some((b) => b.delta === 15)).toBe(true);
  });

  it('adds 10 for the company’s own domain and not for a third party', () => {
    expect(score('vendors@oakwood.example', { companyDomain: 'oakwood.example' })
      .breakdown.some((b) => b.delta === 10)).toBe(true);
    expect(score('vendors@someoneelse.example', { companyDomain: 'oakwood.example' })
      .breakdown.some((b) => b.delta === 10)).toBe(false);
  });

  it('treats a subdomain as the same apex domain', () => {
    expect(apexDomain('mail.oakwood.example')).toBe('oakwood.example');
    expect(apexDomain('www.oakwood.example')).toBe('oakwood.example');
    expect(apexDomain('oakwood.co.uk')).toBe('oakwood.co.uk');
  });

  it('subtracts 15 for a footer-only sighting', () => {
    const normal = score('info@oakwood.example');
    const footer = score('info@oakwood.example', { footerOnly: true });
    expect(normal.score - footer.score).toBe(15);
  });

  it('subtracts 25 for a free provider', () => {
    const result = score('vendors@gmail.com', { companyDomain: 'oakwood.example' });
    expect(result.breakdown.some((b) => b.delta === -25)).toBe(true);
  });

  it('subtracts 60 when MX lookup fails', () => {
    const result = score('vendors@oakwood.example', { mxValid: false });
    expect(result.breakdown.some((b) => b.delta === -60)).toBe(true);
    expect(result.score).toBeLessThan(SEND_THRESHOLD);
  });

  it('subtracts 40 when a prior reply said wrong department', () => {
    const result = score('maintenance@oakwood.example', { signals: ['wrong_department'] });
    expect(result.breakdown.some((b) => b.delta === -40)).toBe(true);
  });

  it('adds 40 when a prior reply confirmed the address', () => {
    const plain = score('info@oakwood.example');
    const confirmed = score('info@oakwood.example', { signals: ['confirmed'] });
    expect(confirmed.score).toBeGreaterThan(plain.score);
    expect(confirmed.breakdown.some((b) => b.delta === 40)).toBe(true);
  });
});

describe('clamping and ordering', () => {
  it('never returns a score outside 0-100', () => {
    const high = score('vendors@oakwood.example', {
      sourceUrl: 'https://oakwood.example/vendor-application',
      pageH1: 'Vendor Application',
      trade: 'hvac',
      signals: ['confirmed'],
    });
    expect(high.score).toBe(100);

    const low = score('unknown@elsewhere.test', {
      mxValid: false,
      footerOnly: true,
      companyDomain: 'oakwood.example',
      signals: ['wrong_department'],
    });
    expect(low.score).toBe(0);
  });

  it('ranks a vendor inbox above a general inbox on the same page', () => {
    const vendor = score('vendors@oakwood.example');
    const info = score('info@oakwood.example');
    expect(vendor.score).toBeGreaterThan(info.score);
  });

  it('ranks a general inbox on a vendor page above a bare general inbox', () => {
    const onVendorPage = score('info@oakwood.example', {
      sourceUrl: 'https://oakwood.example/vendors',
    });
    const bare = score('info@oakwood.example');
    expect(onVendorPage.score).toBeGreaterThan(bare.score);
  });

  it('records a breakdown entry for every contributing signal', () => {
    const result = score('hvac@oakwood.example', {
      sourceUrl: 'https://oakwood.example/vendors',
      trade: 'hvac',
      footerOnly: true,
    });
    const reasons = result.breakdown.map((b) => b.reason).join(' | ');
    expect(reasons).toMatch(/vendor/i);
    expect(reasons).toMatch(/trade token/i);
    expect(reasons).toMatch(/footer/i);
  });

  it('flags role accounts', () => {
    expect(score('vendors@oakwood.example').isRoleAccount).toBe(true);
    expect(score('mwebb@oakwood.example').isRoleAccount).toBe(false);
  });
});
