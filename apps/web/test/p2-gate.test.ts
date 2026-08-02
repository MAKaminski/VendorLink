import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalMailer, LocalObjectStore, sha256Hex } from '@vendorlink/core';
import {
  DirectoryRepository,
  emailMessages,
  pmCompanies,
  pmContacts,
  repositoriesFor,
  sendCounters,
  tenants,
  type TenantRepositories,
} from '@vendorlink/db';
import { createTestDatabase, seedTenant, type TestDatabase } from '@vendorlink/db/testing';
import { runEmailTask } from '../src/lib/run-email-task';

/**
 * The P2 gate.
 *
 *   1. One-click send works end to end against a fixture inbox.
 *   2. A bounce suppresses globally.
 *
 * Driven through `runEmailTask` — the same code path the Connect button uses —
 * against a real Postgres and a real serialized message, so the audit rows,
 * the send counter and the suppression are all exercised together.
 */

let testDb: TestDatabase;
let storeRoot: string;
let inboxDir: string;
let store: LocalObjectStore;
let mailer: LocalMailer;
let repos: TenantRepositories;
let directory: DirectoryRepository;
let tenantId: string;
let companyId: string;

const DOC_BODY = Buffer.from('%PDF-1.7\nvendor document\n');

beforeAll(async () => {
  process.env.VENDORLINK_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  testDb = await createTestDatabase();
  storeRoot = await mkdtemp(join(tmpdir(), 'vl-p2-store-'));
  inboxDir = await mkdtemp(join(tmpdir(), 'vl-p2-inbox-'));
  store = new LocalObjectStore({ root: storeRoot, signingKey: 'test-key' });
  mailer = new LocalMailer({ inboxDir });

  const tenant = await seedTenant(testDb.db, {
    name: 'Peachtree Grounds',
    legalName: 'Peachtree Grounds LLC',
  });
  tenantId = tenant.tenantId;
  repos = repositoriesFor(testDb.db, tenantId);
  directory = new DirectoryRepository(testDb.db);

  await testDb.db
    .update(tenants)
    .set({
      sendingDomain: 'peachtreegrounds.example',
      sendingDomainVerifiedAt: new Date(),
      sendingWarmupStartedOn: '2026-01-01',
    })
    .where(eq(tenants.id, tenantId));

  await repos.profile.update({
    primaryContactName: 'Dana Whitfield',
    primaryContactEmail: 'dana@peachtreegrounds.example',
    primaryContactPhone: '404-555-0142',
    addressLine1: '1180 Marietta St NW',
    city: 'Atlanta',
    state: 'GA',
    postal: '30318',
    responseTimeHours: 4,
  });
  await repos.profile.setTrades([{ tradeSlug: 'landscaping', isPrimary: true }]);
  await repos.profile.addServiceArea({ kind: 'state', states: ['GA'] });

  // Two current documents with real bytes in the store.
  for (const [id, kind, label] of [
    ['aaaaaaaa-0000-4000-8000-000000000001', 'W9', 'W-9 2026'],
    ['aaaaaaaa-0000-4000-8000-000000000002', 'COI', 'COI 2026'],
  ] as const) {
    const key = `tenants/${tenantId}/documents/${id}/${kind}.pdf`;
    await store.put({ key, body: DOC_BODY, contentType: 'application/pdf' });
    await repos.documents.insert({
      id,
      kind,
      label,
      r2Key: key,
      mime: 'application/pdf',
      bytes: DOC_BODY.byteLength,
      sha256: sha256Hex(DOC_BODY),
    });
  }

  const [company] = await testDb.db
    .insert(pmCompanies)
    .values({ name: 'Oakwood Residential', domain: 'oakwood-p2.example', hqState: 'GA' })
    .returning();
  companyId = company!.id;

  await directory.upsertContacts(companyId, [
    {
      pmCompanyId: companyId,
      email: 'vendors@oakwood-p2.example',
      kind: 'vendor_onboarding',
      score: 100,
      confidence: 1,
      rank: 1,
      mxValid: true,
      isRoleAccount: true,
      lastVerifiedAt: new Date(),
    },
  ]);
});

afterAll(async () => {
  await testDb?.close();
  await rm(storeRoot, { recursive: true, force: true });
  await rm(inboxDir, { recursive: true, force: true });
});

/**
 * Decode every base64 MIME part so assertions can be made on what the
 * recipient actually reads rather than on the transfer encoding.
 */
function decodeBodyParts(raw: string): string {
  return raw
    .split(/\r?\n\r?\n/)
    .map((chunk) => {
      const compact = chunk.replace(/\r?\n/g, '');
      if (!/^[A-Za-z0-9+/=]{40,}$/.test(compact)) return '';
      return Buffer.from(compact, 'base64').toString('utf8');
    })
    .join('\n');
}

async function connect(profileVersion: number) {
  const { run } = await repos.runs.createIdempotent({ pmCompanyId: companyId, profileVersion });
  const task = await repos.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
  const result = await runEmailTask(task.id, {
    db: testDb.db,
    repos,
    mailer,
    store,
    appBaseUrl: 'https://vendorlink.test',
  });
  return { run, task, result };
}

describe('gate 1: one-click send end to end', () => {
  it('sends the packet and reports success', async () => {
    const { result } = await connect(1000);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('vendors@oakwood-p2.example');
  });

  it('writes a real message to the fixture inbox with both attachments', async () => {
    const inbox = await mailer.readInbox();
    expect(inbox).toHaveLength(1);
    const raw = inbox[0]!.raw;

    expect(raw).toContain('To: vendors@oakwood-p2.example');
    expect(raw).toMatch(/Content-Disposition: attachment; filename="w-9[^"]*"/i);
    expect(raw).toMatch(/Content-Disposition: attachment; filename="coi[^"]*"/i);
    expect(raw).toContain('List-Unsubscribe:');
    // CAN-SPAM: the physical address must be in the readable body, which is
    // base64 transfer-encoded, so it has to be decoded to be asserted on.
    expect(decodeBodyParts(raw)).toContain('1180 Marietta St NW');
  });

  it('records the message row for delivery tracking', async () => {
    const rows = await testDb.db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toEmail).toBe('vendors@oakwood-p2.example');
    expect(rows[0]?.sentAt).toBeInstanceOf(Date);
    expect(rows[0]?.attachments).toHaveLength(2);
  });

  it('writes an audit trail before and after the send', async () => {
    const tasks = await repos.tasks.listByStatuses(['succeeded']);
    const events = await repos.events.listForTask(tasks[0]!.id);
    const types = events.map((e) => e.eventType);
    expect(types).toContain('email.started');
    expect(types).toContain('email.recipient_resolved');
    expect(types).toContain('email.sent');
    // Ordered, so the trace reads as a sequence.
    expect(types.indexOf('email.started')).toBeLessThan(types.indexOf('email.sent'));
  });

  it('marks the run succeeded', async () => {
    const runs = await repos.runs.listRecent({ limit: 1 });
    expect(runs[0]?.status).toBe('succeeded');
  });

  it('increments the daily send counter', async () => {
    const [counter] = await testDb.db
      .select()
      .from(sendCounters)
      .where(eq(sendCounters.tenantId, tenantId));
    expect(counter?.sent).toBe(1);
  });
});

describe('gate 2: a bounce suppresses globally', () => {
  it('suppresses the address for every tenant', async () => {
    await directory.recordSignal({
      email: 'vendors@oakwood-p2.example',
      pmCompanyId: companyId,
      signal: 'hard_bounce',
      sourceTenantId: tenantId,
      detail: '550 5.1.1 user unknown',
    });

    expect(await directory.isSuppressed('vendors@oakwood-p2.example')).toBe(true);

    const [contact] = await testDb.db
      .select()
      .from(pmContacts)
      .where(eq(pmContacts.email, 'vendors@oakwood-p2.example'));
    expect(contact?.hardBounced).toBe(true);
    expect(contact?.bounceCount).toBe(1);
  });

  it('blocks a later send to that address without producing a message', async () => {
    const before = (await mailer.readInbox()).length;
    const { result, task } = await connect(1001);

    expect(result.ok).toBe(false);
    expect((await mailer.readInbox()).length).toBe(before);

    const finished = await repos.tasks.findById(task.id);
    expect(finished?.status).toBe('failed');
    expect(finished?.failureClass).toBe('send_blocked_suppressed');
  });

  it('blocks a brand new tenant from sending to it too', async () => {
    // The compounding effect: a tenant that never sent anything inherits the
    // protection.
    const other = await seedTenant(testDb.db, { name: 'Another Vendor' });
    const otherRepos = repositoriesFor(testDb.db, other.tenantId);
    await testDb.db
      .update(tenants)
      .set({ sendingDomain: 'other.example', sendingDomainVerifiedAt: new Date() })
      .where(eq(tenants.id, other.tenantId));

    const best = await directory.bestContact(companyId);
    expect(best).toBeNull();

    const { run } = await otherRepos.runs.createIdempotent({
      pmCompanyId: companyId,
      profileVersion: 1,
    });
    const task = await otherRepos.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
    const before = (await mailer.readInbox()).length;

    const result = await runEmailTask(task.id, {
      db: testDb.db,
      repos: otherRepos,
      mailer,
      store,
      appBaseUrl: 'https://vendorlink.test',
    });

    expect(result.ok).toBe(false);
    expect((await mailer.readInbox()).length).toBe(before);
  });
});

describe('the warm-up governor holds', () => {
  it('refuses to send past the daily cap and leaves the task retryable', async () => {
    // Put the tenant on a brand-new domain (cap 25) and pretend it is spent.
    await testDb.db
      .update(tenants)
      .set({ sendingWarmupStartedOn: new Date().toISOString().slice(0, 10) })
      .where(eq(tenants.id, tenantId));
    await testDb.db
      .update(sendCounters)
      .set({ sent: 25 })
      .where(eq(sendCounters.tenantId, tenantId));

    // Point the run at a fresh, deliverable contact so the cap is the only gate.
    const [fresh] = await testDb.db
      .insert(pmCompanies)
      .values({ name: 'Southline', domain: 'southline-p2.example' })
      .returning();
    await directory.upsertContacts(fresh!.id, [
      {
        pmCompanyId: fresh!.id,
        email: 'vendors@southline-p2.example',
        kind: 'vendor_onboarding',
        score: 100,
        confidence: 1,
        rank: 1,
        mxValid: true,
        isRoleAccount: true,
        lastVerifiedAt: new Date(),
      },
    ]);

    const { run } = await repos.runs.createIdempotent({
      pmCompanyId: fresh!.id,
      profileVersion: 1,
    });
    const task = await repos.tasks.createTask({ runId: run.id, kind: 'EMAIL' });
    const before = (await mailer.readInbox()).length;

    const result = await runEmailTask(task.id, {
      db: testDb.db,
      repos,
      mailer,
      store,
      appBaseUrl: 'https://vendorlink.test',
    });

    expect(result.ok).toBe(false);
    expect((await mailer.readInbox()).length).toBe(before);

    // Rate-limited work stays queued with a retry time, rather than failing:
    // it is deferred, not rejected.
    const finished = await repos.tasks.findById(task.id);
    expect(finished?.status).toBe('queued');
    expect(finished?.failureClass).toBe('send_blocked_rate_limit');
    expect(finished?.nextRetryAt).toBeInstanceOf(Date);
  });
});
