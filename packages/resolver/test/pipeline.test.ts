import { describe, expect, it, vi } from 'vitest';
import { DisabledLlmClient, MapDnsResolver, MapHttpFetcher, StubLlmClient } from '@vendorlink/core';
import { chooseOutcome, resolveOnboardingContacts } from '../src/pipeline';
import { isAllowed, parseRobots } from '../src/discovery';
import type { ContactStore, RankedContact } from '../src/types';

const dns = MapDnsResolver.withMx(['oakwood.example']);

function pages(entries: Record<string, string>) {
  return new MapHttpFetcher(new Map(Object.entries(entries).map(([k, v]) => [k, { body: v }])));
}

const VENDOR_PAGE = `<html><head><title>Vendors</title></head><body>
  <h1>Vendor Information</h1>
  <p>Email vendors@oakwood.example with your packet.</p></body></html>`;

const HOME_WITH_LINK = `<html><head><title>Oakwood</title></head><body>
  <h1>Oakwood</h1><nav><a href="/vendors">Vendors</a></nav></body></html>`;

const BASE_PAGES = {
  'https://oakwood.example': HOME_WITH_LINK,
  'https://oakwood.example/robots.txt': 'User-agent: *\nAllow: /\n',
  'https://oakwood.example/vendors': VENDOR_PAGE,
};

describe('robots.txt', () => {
  it('parses the wildcard group', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\n');
    expect(rules.disallow).toEqual(['/private']);
    expect(rules.allow).toEqual(['/private/ok']);
  });

  it('collects sitemap declarations', () => {
    const rules = parseRobots('Sitemap: https://x.example/sitemap.xml\nUser-agent: *\n');
    expect(rules.sitemaps).toEqual(['https://x.example/sitemap.xml']);
  });

  it('ignores directives in a group for another agent', () => {
    const rules = parseRobots('User-agent: googlebot\nDisallow: /\n');
    expect(rules.disallow).toEqual([]);
  });

  it('ignores comments', () => {
    const rules = parseRobots('User-agent: *\n# Disallow: /nope\nDisallow: /yes\n');
    expect(rules.disallow).toEqual(['/yes']);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/vendors\n');
    expect(isAllowed(rules, '/private/vendors')).toBe(true);
    expect(isAllowed(rules, '/private/other')).toBe(false);
  });

  it('allows anything not covered by a rule', () => {
    expect(isAllowed(parseRobots('User-agent: *\nDisallow: /admin\n'), '/vendors')).toBe(true);
  });
});

describe('discovery behaviour', () => {
  it('honours a robots.txt disallow and records the skip in the trace', async () => {
    const fetcher = pages({
      ...BASE_PAGES,
      'https://oakwood.example/robots.txt': 'User-agent: *\nDisallow: /vendors\n',
    });

    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      { fetcher, dns, llm: new DisabledLlmClient() },
      { useLlm: false },
    );

    const skipped = result.trace.fetches.filter((f) => f.skippedByRobots);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.some((f) => f.url.endsWith('/vendors'))).toBe(true);
    expect(result.trace.notes.join(' ')).toMatch(/robots\.txt/);
    // And we did not learn the address that was behind the disallowed page.
    expect(result.contacts.map((c) => c.email)).not.toContain('vendors@oakwood.example');
  });

  it('never exceeds the fetch budget', async () => {
    const many: Record<string, string> = {
      'https://oakwood.example': HOME_WITH_LINK,
      'https://oakwood.example/robots.txt': 'User-agent: *\nAllow: /\n',
    };
    // Every known path exists but none carries an address, so nothing
    // short-circuits and the crawler runs until the budget stops it.
    for (const path of ['/vendors', '/vendor', '/suppliers', '/contractors', '/contact']) {
      many[`https://oakwood.example${path}`] = '<html><body><h1>Nothing here</h1></body></html>';
    }

    const fetcher = pages(many);
    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      { fetcher, dns, llm: new DisabledLlmClient() },
      { useLlm: false, fetchBudget: 4 },
    );

    expect(result.trace.fetchBudgetUsed).toBeLessThanOrEqual(4);
    expect(result.trace.fetchBudgetLimit).toBe(4);
  });

  it('short-circuits once a tier-1 inbox is found', async () => {
    const fetcher = pages(BASE_PAGES);
    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      { fetcher, dns, llm: new DisabledLlmClient() },
      { useLlm: false },
    );
    // Home + /vendors is enough; it must not walk the whole known-path list.
    expect(result.trace.fetchBudgetUsed).toBeLessThan(5);
    expect(result.contacts[0]?.email).toBe('vendors@oakwood.example');
  });

  it('records every fetch attempt including failures', async () => {
    const fetcher = pages(BASE_PAGES);
    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      { fetcher, dns, llm: new DisabledLlmClient() },
      { useLlm: false },
    );
    expect(result.trace.fetches.length).toBeGreaterThan(0);
    for (const fetch of result.trace.fetches) {
      expect(fetch).toHaveProperty('url');
      expect(fetch).toHaveProperty('status');
    }
  });
});

describe('S0 cache', () => {
  const cachedContact: RankedContact = {
    email: 'cached@oakwood.example',
    kind: 'vendor_onboarding',
    personName: null,
    title: null,
    score: 95,
    confidence: 0.95,
    rank: 1,
    sourceUrl: 'https://oakwood.example/vendors',
    discoveryMethod: 'mailto',
    mxValid: true,
    isRoleAccount: true,
    breakdown: [],
    evidenceQuote: null,
  };

  function storeWith(lastVerifiedAt: Date | null): ContactStore {
    return {
      getCached: async () => ({ contacts: [cachedContact], lastVerifiedAt }),
      getSignals: async () => new Map(),
      getSuppressed: async () => new Set(),
      persist: async () => undefined,
    };
  }

  it('serves a fresh cache without fetching anything', async () => {
    const fetcher = pages(BASE_PAGES);
    const spy = vi.spyOn(fetcher, 'fetch');

    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example' },
      { fetcher, dns, llm: new DisabledLlmClient(), store: storeWith(new Date()) },
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.contacts[0]?.email).toBe('cached@oakwood.example');
    expect(result.trace.shortCircuitedAt).toBe('S0_cache');
  });

  it('re-resolves when the cache is older than 45 days', async () => {
    const stale = new Date(Date.now() - 46 * 86_400_000);
    const fetcher = pages(BASE_PAGES);

    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example' },
      { fetcher, dns, llm: new DisabledLlmClient(), store: storeWith(stale) },
      { useLlm: false },
    );

    expect(result.trace.shortCircuitedAt).toBeNull();
    expect(result.contacts[0]?.email).toBe('vendors@oakwood.example');
  });

  it('bypasses a fresh cache when asked to', async () => {
    const fetcher = pages(BASE_PAGES);
    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      { fetcher, dns, llm: new DisabledLlmClient(), store: storeWith(new Date()) },
      { useLlm: false },
    );
    expect(result.trace.shortCircuitedAt).toBeNull();
  });

  it('persists the result for the next caller', async () => {
    const persist = vi.fn(async () => undefined);
    const fetcher = pages(BASE_PAGES);
    await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      {
        fetcher,
        dns,
        llm: new DisabledLlmClient(),
        store: { ...storeWith(null), persist },
      },
      { useLlm: false },
    );
    expect(persist).toHaveBeenCalledOnce();
  });
});

describe('cross-tenant signals', () => {
  const store = (signals: Map<string, string[]>, suppressed = new Set<string>()): ContactStore => ({
    getCached: async () => null,
    getSignals: async () => signals,
    getSuppressed: async () => suppressed,
    persist: async () => undefined,
  });

  it('drops an address suppressed by another tenant’s bounce', async () => {
    const fetcher = pages(BASE_PAGES);
    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      {
        fetcher,
        dns,
        llm: new DisabledLlmClient(),
        store: store(new Map(), new Set(['vendors@oakwood.example'])),
      },
      { useLlm: false },
    );

    expect(result.contacts.map((c) => c.email)).not.toContain('vendors@oakwood.example');
    // And the operator can see why it disappeared.
    const rejected = result.trace.candidates.find((c) => c.email === 'vendors@oakwood.example');
    expect(rejected?.rejected).toMatch(/suppressed/);
  });

  it('excludes an address that hard-bounced for another tenant', async () => {
    const fetcher = pages(BASE_PAGES);
    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      {
        fetcher,
        dns,
        llm: new DisabledLlmClient(),
        store: store(new Map([['vendors@oakwood.example', ['hard_bounce']]])),
      },
      { useLlm: false },
    );
    expect(result.contacts.map((c) => c.email)).not.toContain('vendors@oakwood.example');
  });

  it('boosts an address confirmed by another tenant’s reply', async () => {
    const html = `<html><head><title>Contact</title></head><body>
      <h1>Contact</h1><p>office@oakwood.example</p></body></html>`;
    const fetcher = pages({
      'https://oakwood.example': html,
      'https://oakwood.example/robots.txt': 'User-agent: *\nAllow: /\n',
    });

    const withSignal = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      {
        fetcher,
        dns,
        llm: new DisabledLlmClient(),
        store: store(new Map([['office@oakwood.example', ['confirmed']]])),
      },
      { useLlm: false },
    );

    const without = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      { fetcher, dns, llm: new DisabledLlmClient() },
      { useLlm: false },
    );

    expect(withSignal.contacts[0]?.score).toBeGreaterThan(without.contacts[0]?.score ?? 0);
  });
});

describe('S4 integration', () => {
  it('does not call the model when a tier-1 inbox was already found', async () => {
    const llm = new StubLlmClient(() => ({ selections: [] }));
    const fetcher = pages(BASE_PAGES);

    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      { fetcher, dns, llm },
      { useLlm: true },
    );

    expect(llm.calls).toHaveLength(0);
    expect(result.trace.llmCalls).toBe(0);
    expect(result.trace.notes.join(' ')).toMatch(/S4 skipped/);
  });

  it('calls the model when the deterministic rubric is undecided', async () => {
    const ambiguous = `<html><head><title>Contact</title></head><body>
      <h1>Contact</h1><p>office@oakwood.example</p><p>admin@oakwood.example</p></body></html>`;
    const llm = new StubLlmClient(() => ({
      selections: [
        {
          email: 'office@oakwood.example',
          kind: 'vendor_onboarding',
          evidence_quote: 'office@oakwood.example',
          confidence: 0.7,
        },
      ],
    }));

    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      {
        fetcher: pages({
          'https://oakwood.example': ambiguous,
          'https://oakwood.example/robots.txt': 'User-agent: *\nAllow: /\n',
        }),
        dns,
        llm,
      },
      { useLlm: true },
    );

    expect(result.trace.llmCalls).toBe(1);
    expect(result.contacts[0]?.discoveryMethod).toBe('llm_interpreted');
  });

  it('survives a model failure and still returns the deterministic answer', async () => {
    const ambiguous = `<html><head><title>Contact</title></head><body>
      <h1>Contact</h1><p>office@oakwood.example</p></body></html>`;
    const llm = new StubLlmClient(() => {
      throw new Error('model unavailable');
    });

    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      {
        fetcher: pages({
          'https://oakwood.example': ambiguous,
          'https://oakwood.example/robots.txt': 'User-agent: *\nAllow: /\n',
        }),
        dns,
        llm,
      },
      { useLlm: true },
    );

    expect(result.contacts[0]?.email).toBe('office@oakwood.example');
    expect(result.trace.notes.join(' ')).toMatch(/S4 interpretation unavailable/);
  });
});

describe('output shape', () => {
  it('always returns a ranked list, never a single address', async () => {
    const multi = `<html><head><title>Contact</title></head><body>
      <h1>Contact</h1>
      <p>vendors@oakwood.example</p><p>procurement@oakwood.example</p>
      <p>maintenance@oakwood.example</p></body></html>`;

    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      {
        fetcher: pages({
          'https://oakwood.example': multi,
          'https://oakwood.example/robots.txt': 'User-agent: *\nAllow: /\n',
        }),
        dns,
        llm: new DisabledLlmClient(),
      },
      { useLlm: false },
    );

    expect(result.contacts.length).toBeGreaterThanOrEqual(3);
    expect(result.contacts.map((c) => c.rank)).toEqual([1, 2, 3]);
    // Ranks must be strictly descending by score.
    for (let i = 1; i < result.contacts.length; i++) {
      expect(result.contacts[i - 1]!.score).toBeGreaterThanOrEqual(result.contacts[i]!.score);
    }
  });

  it('records the score breakdown for every candidate in the trace', async () => {
    const result = await resolveOnboardingContacts(
      { pmCompanyId: 'c1', website: 'https://oakwood.example', cache: 'bypass' },
      { fetcher: pages(BASE_PAGES), dns, llm: new DisabledLlmClient() },
      { useLlm: false },
    );
    const candidate = result.trace.candidates.find((c) => c.email === 'vendors@oakwood.example');
    expect(candidate?.breakdown.length).toBeGreaterThan(0);
    expect(candidate?.breakdown[0]?.reason).toBeTruthy();
  });
});

describe('fallback ladder', () => {
  const contact = (score: number): RankedContact => ({
    email: 'x@oakwood.example',
    kind: 'vendor_onboarding',
    personName: null,
    title: null,
    score,
    confidence: score / 100,
    rank: 1,
    sourceUrl: null,
    discoveryMethod: 'mailto',
    mxValid: true,
    isRoleAccount: true,
    breakdown: [],
    evidenceQuote: null,
  });

  const emptyTrace = {
    pmCompanyId: 'c1',
    website: 'https://oakwood.example',
    startedAt: '',
    finishedAt: '',
    stagesRun: [],
    fetches: [],
    candidates: [],
    fetchBudgetUsed: 0,
    fetchBudgetLimit: 25,
    llmCalls: 0,
    shortCircuitedAt: null,
    notes: [],
  };

  it('sends at or above 60', () => {
    expect(
      chooseOutcome({ contacts: [contact(60)], channels: [], requirements: null, trace: emptyTrace })
        .kind,
    ).toBe('send');
  });

  it('sends with a low-confidence flag between 35 and 59', () => {
    expect(
      chooseOutcome({ contacts: [contact(45)], channels: [], requirements: null, trace: emptyTrace })
        .kind,
    ).toBe('send_low_confidence');
  });

  it('prefers a form over a contact below 35', () => {
    const outcome = chooseOutcome({
      contacts: [contact(20)],
      channels: [
        {
          kind: 'WEB_FORM',
          url: 'https://oakwood.example/apply',
          platformSlug: 'custom',
          requiresAccount: false,
          requiresPayment: false,
          feeCents: null,
          captchaKind: 'none',
          notes: null,
        },
      ],
      requirements: null,
      trace: emptyTrace,
    });
    expect(outcome.kind).toBe('route_to_form');
  });

  it('falls through to a portal when there is no form', () => {
    const outcome = chooseOutcome({
      contacts: [],
      channels: [
        {
          kind: 'PORTAL',
          url: 'https://app.netvendor.com/register',
          platformSlug: 'netvendor',
          requiresAccount: true,
          requiresPayment: true,
          feeCents: 9900,
          captchaKind: 'unknown',
          notes: null,
        },
      ],
      requirements: null,
      trace: emptyTrace,
    });
    expect(outcome.kind).toBe('route_to_portal');
  });

  it('parks with the trace when there is nothing at all', () => {
    const outcome = chooseOutcome({
      contacts: [],
      channels: [],
      requirements: null,
      trace: emptyTrace,
    });
    expect(outcome.kind).toBe('needs_attention');
    if (outcome.kind === 'needs_attention') {
      expect(outcome.trace).toBe(emptyTrace);
    }
  });
});
