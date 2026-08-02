import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DisabledLlmClient, MapDnsResolver, MapHttpFetcher } from '@vendorlink/core';
import { resolveOnboardingContacts } from '@vendorlink/resolver';
import { DbContactStore, DirectoryRepository } from '../src/repositories/index';
import { pmCompanies } from '../src/schema/index';
import { createTestDatabase, seedTenant, type TestDatabase } from '../src/testing/harness';

/**
 * Engine #1 against the real database.
 *
 * The unit suite proves the pipeline logic with an in-memory store; this
 * proves the adapter — that a resolution actually persists, that the cache
 * path reads it back, and that a bounce recorded by one tenant changes what a
 * different tenant's resolution returns.
 */

let testDb: TestDatabase;
let store: DbContactStore;
let directory: DirectoryRepository;
let companyId: string;
let tenantAId: string;
let tenantBId: string;

const VENDOR_PAGE = `<html><head><title>Vendors</title></head><body>
  <h1>Vendor Information</h1>
  <p>Send your packet to vendors@oakwood.example.</p>
  <p>General: info@oakwood.example</p>
  </body></html>`;

const fetcher = () =>
  new MapHttpFetcher(
    new Map([
      [
        'https://oakwood.example',
        { body: '<html><head><title>Oakwood</title></head><body><h1>Oakwood</h1><nav><a href="/vendors">Vendors</a></nav></body></html>' },
      ],
      ['https://oakwood.example/robots.txt', { body: 'User-agent: *\nAllow: /\n' }],
      ['https://oakwood.example/vendors', { body: VENDOR_PAGE }],
    ]),
  );

const dns = MapDnsResolver.withMx(['oakwood.example']);

beforeAll(async () => {
  testDb = await createTestDatabase();
  store = new DbContactStore(testDb.db);
  directory = new DirectoryRepository(testDb.db);

  const [company] = await testDb.db
    .insert(pmCompanies)
    .values({ name: 'Oakwood Residential', domain: 'oakwood.example', hqState: 'GA' })
    .returning();
  companyId = company!.id;

  tenantAId = (await seedTenant(testDb.db, { name: 'Tenant A' })).tenantId;
  tenantBId = (await seedTenant(testDb.db, { name: 'Tenant B' })).tenantId;
});

afterAll(async () => {
  await testDb?.close();
});

async function resolve(cache: 'prefer' | 'bypass' = 'bypass') {
  return resolveOnboardingContacts(
    { pmCompanyId: companyId, website: 'https://oakwood.example', cache },
    { fetcher: fetcher(), dns, llm: new DisabledLlmClient(), store },
    { useLlm: false },
  );
}

describe('persisting a resolution', () => {
  it('writes ranked contacts to the directory', async () => {
    const result = await resolve();
    expect(result.contacts[0]?.email).toBe('vendors@oakwood.example');

    const stored = await directory.listContacts(companyId);
    expect(stored.map((c) => c.email)).toContain('vendors@oakwood.example');
    expect(stored[0]?.rank).toBe(1);
    expect(stored[0]?.score).toBeGreaterThan(60);
  });

  it('stores the score breakdown so the trace page can render it', async () => {
    const [top] = await directory.listContacts(companyId);
    expect(Array.isArray(top?.scoreBreakdown)).toBe(true);
    expect((top?.scoreBreakdown ?? []).length).toBeGreaterThan(0);
    expect((top?.scoreBreakdown ?? [])[0]).toHaveProperty('reason');
  });

  it('marks the company as resolved', async () => {
    const company = await directory.findById(companyId);
    expect(company?.crawlStatus).toBe('resolved');
    expect(company?.lastCrawledAt).toBeInstanceOf(Date);
  });

  it('re-resolving updates rather than duplicating', async () => {
    const before = (await directory.listContacts(companyId)).length;
    await resolve();
    expect((await directory.listContacts(companyId)).length).toBe(before);
  });

  it('serves the second call from cache without fetching', async () => {
    const f = fetcher();
    const result = await resolveOnboardingContacts(
      { pmCompanyId: companyId, website: 'https://oakwood.example', cache: 'prefer' },
      { fetcher: f, dns, llm: new DisabledLlmClient(), store },
      { useLlm: false },
    );
    expect(result.trace.shortCircuitedAt).toBe('S0_cache');
    expect(f.requested).toHaveLength(0);
  });
});

describe('cross-tenant learning', () => {
  it("suppresses an address globally after one tenant's hard bounce", async () => {
    // Tenant A sends and it bounces.
    await directory.recordSignal({
      email: 'vendors@oakwood.example',
      pmCompanyId: companyId,
      signal: 'hard_bounce',
      sourceTenantId: tenantAId,
      detail: '550 no such user',
    });

    expect(await directory.isSuppressed('vendors@oakwood.example')).toBe(true);

    // Tenant B, who has never sent anything, must not be offered it.
    const best = await directory.bestContact(companyId);
    expect(best?.email).not.toBe('vendors@oakwood.example');

    const suppressed = await store.getSuppressed(['vendors@oakwood.example']);
    expect(suppressed.has('vendors@oakwood.example')).toBe(true);
  });

  it('keeps the bounced address out of a fresh resolution for another tenant', async () => {
    const result = await resolve();
    expect(result.contacts.map((c) => c.email)).not.toContain('vendors@oakwood.example');
    const rejected = result.trace.candidates.find((c) => c.email === 'vendors@oakwood.example');
    expect(rejected?.rejected).toMatch(/suppressed/i);
  });

  it('keeps a bounced address out of the cache path too', async () => {
    const cached = await store.getCached(companyId);
    expect(cached?.contacts.map((c) => c.email)).not.toContain('vendors@oakwood.example');
  });

  it('records the signal with its originating tenant for audit', async () => {
    const signals = await store.getSignals(['vendors@oakwood.example']);
    expect(signals.get('vendors@oakwood.example')).toContain('hard_bounce');
    expect(tenantBId).toBeTruthy();
  });

  it('boosts an address confirmed by a reply', async () => {
    await directory.recordSignal({
      email: 'info@oakwood.example',
      pmCompanyId: companyId,
      signal: 'confirmed',
      sourceTenantId: tenantBId,
    });
    const signals = await store.getSignals(['info@oakwood.example']);
    expect(signals.get('info@oakwood.example')).toContain('confirmed');

    const result = await resolve();
    const info = result.contacts.find((c) => c.email === 'info@oakwood.example');
    expect(info?.breakdown.some((b) => /confirmed/i.test(b.reason))).toBe(true);
  });
});
